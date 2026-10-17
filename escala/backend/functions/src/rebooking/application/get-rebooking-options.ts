import { ancillaryOutcomes } from '../../ancillaries/domain/transfer-rules';
import { loadSegmentFlights } from '../../bookings/application/lookup-booking';
import { normalizeIata, normalizePnr } from '../../bookings/domain/normalize';
import { arrivalMinutes, findItineraries, flightKey, type Itinerary } from '../../operations/domain/alternatives';
import { simulateFailure } from '../../operations/domain/failure';
import { computeFacts } from '../../operations/domain/impact';
import { classifyDisruption, isSeatHolder, priceChange, voluntaryBlockedBy } from '../../policy-rules/domain/rules';
import { err, ok, type Result } from '../../shared/result';
import { sha1Hex } from '../../shared/ids';
import { addDays } from '../../shared/time';
import type { Deps } from '../../shared/uow';
import type { Flight } from '../../shared/types';
import { resolveDeadline } from '../domain/dates';
import type { LegView, QuoteRecord } from '../domain/types';

export interface OptionsInput {
  deadline?: string;
  target_date?: string;
  destination?: string;
}

export const legView = (f: Flight): LegView => ({
  flight_number: f.flight_number,
  date: f.date,
  origin: f.origin,
  destination: f.destination,
  dep: f.dep,
  arr: f.arr,
});

export async function getRebookingOptions(deps: Deps, pnrRaw: string, input: OptionsInput): Promise<Result<Record<string, unknown>>> {
  const { repos, clock, config } = deps;
  const today = clock.simulatedToday();
  const booking = await repos.bookings.findByPnr(normalizePnr(pnrRaw));
  if (!booking) return err('BOOKING_NOT_FOUND');

  const failure = await simulateFailure(booking.failure_mode, 'getRebookingOptions', deps.delay, config);
  if (!failure.ok) return failure;

  const flights = await loadSegmentFlights(repos, booking);
  if (!flights) return err('UPSTREAM_ERROR', { reason: 'segment flight missing' });
  const finalDestination = flights[flights.length - 1].destination;
  if (input.destination && normalizeIata(input.destination) !== finalDestination) return err('DESTINATION_CHANGE_NOT_SUPPORTED');

  let target: string | undefined;
  if (input.target_date !== undefined) {
    const t = resolveDeadline(input.target_date, today);
    if (!t.ok) return t;
    target = t.value;
  }
  let explicitDeadline: string | undefined;
  if (input.deadline !== undefined) {
    const d = resolveDeadline(input.deadline, today);
    if (!d.ok) return d;
    explicitDeadline = d.value;
  }

  const cls = classifyDisruption(computeFacts(flights), config);
  const changeType = cls.change_type;
  const partySize = booking.passengers.filter(isSeatHolder).length;
  const base = { status: 'ok', change_type: changeType, disruption_type: cls.disruption_type, party_size: partySize };

  let replaceFrom: number;
  let deadlineDate: string;
  if (changeType === 'involuntary') {
    replaceFrom = cls.impacted_from as number;
    deadlineDate = explicitDeadline ?? target ?? addDays(flights[replaceFrom].date, 1);
  } else {
    if (!target) {
      return ok({
        ...base,
        no_change_needed: true,
        resolved_deadline_date: null,
        options: [],
        options_after_deadline: [],
        blocking_reasons: [],
        next_availability: null,
      });
    }
    const blocked = voluntaryBlockedBy(booking.passengers);
    if (blocked) {
      return ok({ ...base, resolved_deadline_date: target, options: [], options_after_deadline: [], blocking_reasons: [blocked], next_availability: null });
    }
    replaceFrom = 0;
    deadlineDate = target;
  }

  const replaced = flights.slice(replaceFrom);
  const replacedNumbers = new Set(replaced.map((f) => f.flight_number));
  const startDate = changeType === 'involuntary' ? (flights[replaceFrom].date > today ? flights[replaceFrom].date : today) : deadlineDate;
  const pool = await repos.flights.listByDateRange(startDate, addDays(deadlineDate, config.afterDeadlineWindowDays));
  const itineraries = findItineraries(pool, flights[replaceFrom].origin, finalDestination, new Set(flights.map(flightKey)), config);

  const outcomes = ancillaryOutcomes(booking.passengers, booking.ancillaries, changeType, replacedNumbers, []);
  const ancillaryFees = outcomes.reduce((s, o) => s + o.fee_ars, 0);
  const needsReview = outcomes.some((o) => o.outcome === 'needs_review');
  const flagOff = changeType === 'voluntary' && !config.voluntaryChangesEnabled;
  const perPassenger = booking.passengers.map((p) => ({
    passenger_id: p.passenger_id,
    requires_checkin_cancellation: p.checked_in,
    ancillaries: outcomes.filter((o) => o.passenger_id === p.passenger_id).map((o) => ({ type: o.type, outcome: o.outcome, note: o.note })),
  }));

  const evaluated = itineraries.map((it: Itinerary) => {
    const seats = it.legs.map((l) => l.seats ?? 0);
    const fits = seats.every((s) => s >= partySize);
    const reason = !fits ? 'INSUFFICIENT_SEATS' : flagOff ? 'VOLUNTARY_CHANGES_DISABLED' : needsReview ? 'ANCILLARY_NEEDS_REVIEW' : undefined;
    const last = it.legs[it.legs.length - 1];
    return {
      it,
      fits,
      seats: Math.min(...seats),
      reason,
      executable: reason === undefined,
      byDeadline: last.date <= deadlineDate,
      pricing: priceChange({
        changeType,
        passengers: booking.passengers,
        replacedPrices: replaced.map((f) => f.price_ars),
        newPrices: it.legs.map((l) => l.price_ars),
        ancillaryFees,
      }),
    };
  });
  evaluated.sort(
    (a, b) =>
      Number(b.executable) - Number(a.executable) ||
      arrivalMinutes(a.it) - arrivalMinutes(b.it) ||
      a.it.legs.length - b.it.legs.length ||
      a.it.legs.map(flightKey).join().localeCompare(b.it.legs.map(flightKey).join()),
  );
  const early = evaluated.filter((e) => e.byDeadline).slice(0, config.maxOptions);
  const late = evaluated.filter((e) => !e.byDeadline).slice(0, config.maxLateOptions);

  const nowMs = clock.nowMs();
  const expiresMs = nowMs + config.quoteTtlMin * 60000;
  const expiresAt = new Date(expiresMs).toISOString();
  let n = 0;
  const render = async (e: (typeof evaluated)[number]) => {
    const rank = n + 1;
    const optionId = String.fromCharCode(65 + n);
    n += 1;
    let quoteId: string | undefined;
    if (e.executable) {
      quoteId = `Q-${sha1Hex([booking.pnr, booking.version, changeType, e.it.legs.map(flightKey).join('+'), e.pricing.total_ars].join('|')).slice(0, 8).toUpperCase()}`;
      const existing = await repos.quotes.get(quoteId);
      if (!existing || existing.status !== 'executed') {
        const quote: QuoteRecord = {
          quote_id: quoteId,
          pnr: booking.pnr,
          booking_version: booking.version,
          change_type: changeType,
          disruption_type: cls.disruption_type,
          option_id: optionId,
          replace_from: replaceFrom,
          legs: e.it.legs.map((l) => ({ ...legView(l), seats_at_quote: l.seats, price_ars: l.price_ars })),
          party_size: partySize,
          per_passenger: perPassenger,
          payment: { simulated: true, total_ars: e.pricing.total_ars, breakdown: breakdownOf(e.pricing) },
          created_ms: nowMs,
          expires_ms: expiresMs,
          expires_at: expiresAt,
          status: 'open',
        };
        await repos.quotes.save(quote);
      }
    }
    const last = e.it.legs[e.it.legs.length - 1];
    return {
      option_id: optionId,
      rank,
      legs: e.it.legs.map(legView),
      arrival: `${last.date} ${last.arr}`,
      arrives_by_deadline: e.byDeadline,
      fits_party: e.fits,
      seats_available: e.seats,
      executable: e.executable,
      ...(e.reason ? { not_executable_reason: e.reason } : {}),
      ...(quoteId ? { quote_id: quoteId, expires_at: expiresAt } : {}),
      per_passenger: perPassenger,
      payment: { simulated: true, total_ars: e.pricing.total_ars, breakdown: breakdownOf(e.pricing) },
    };
  };
  const options = [];
  for (const e of early) options.push(await render(e));
  const optionsAfter = [];
  for (const e of late) optionsAfter.push(await render(e));

  const firstLate = optionsAfter[0];
  const hasDowngrade = cls.change_type === 'involuntary' && flights.some((f) => f.equipment_downgrade);
  return ok({
    ...base,
    resolved_deadline_date: deadlineDate,
    options,
    options_after_deadline: optionsAfter,
    blocking_reasons: [],
    next_availability: firstLate ? { date: firstLate.legs[0].date, option_id: firstLate.option_id, flights: firstLate.legs.map((l) => l.flight_number) } : null,
    ...(hasDowngrade
      ? {
          keep_current: {
            legs: flights.map(legView),
            seat_assignments_lost: true,
            note: 'Keeping the current flights is possible, but the seat assignments are lost because of the equipment change.',
          },
        }
      : {}),
  });
}

const breakdownOf = (p: { fee_ars: number; fare_difference_ars: number; ancillary_reissue_ars: number }) => ({
  fee_ars: p.fee_ars,
  fare_difference_ars: p.fare_difference_ars,
  ancillary_reissue_ars: p.ancillary_reissue_ars,
});
