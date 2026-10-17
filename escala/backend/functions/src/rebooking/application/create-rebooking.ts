import { applyAncillaryOutcomes } from '../../ancillaries/domain/transfer-rules';
import { loadSegmentFlights } from '../../bookings/application/lookup-booking';
import { err, ok, type Result } from '../../shared/result';
import { hex6, safeCode, sha1Hex, stableStringify } from '../../shared/ids';
import type { Deps } from '../../shared/uow';
import type { Flight } from '../../shared/types';
import type { RebookingRecord } from '../domain/types';
import { legView } from './get-rebooking-options';

export interface CreateRebookingInput {
  quote_id: string;
  confirmed: boolean;
  confirmed_total_ars: number;
  idempotency_key: string;
}

type Body = Record<string, unknown>;

/**
 * Two-phase execution with simulated payment. All checks and writes happen in one unit of work
 * (check-in cancellation, segments, ancillaries, seats, payment record, ledger). No real charge ever occurs.
 */
export async function createRebooking(deps: Deps, input: CreateRebookingInput): Promise<Result<Body>> {
  if (input.confirmed !== true) return err('CONFIRMATION_REQUIRED');
  if (!input.idempotency_key) return err('MISSING_IDEMPOTENCY_KEY');
  const fingerprint = sha1Hex(stableStringify({ quote_id: input.quote_id, confirmed: true, confirmed_total_ars: input.confirmed_total_ars }));
  const { config, clock } = deps;

  const outcome = await deps.uow.run<Result<Body>>(async (r) => {
    // ---- reads ----
    const prior = await r.idempotency.get(input.idempotency_key);
    if (prior) {
      if (prior.fingerprint !== fingerprint) return err('IDEMPOTENCY_KEY_REUSED');
      return ok({ ...prior.response, already_applied: true });
    }
    const quote = await r.quotes.get(input.quote_id);
    if (!quote) return err('QUOTE_NOT_FOUND');
    if (quote.status === 'executed') {
      const rb = quote.rebooking_id ? await r.rebookings.get(quote.rebooking_id) : null;
      if (!rb) return err('VERIFICATION_FAILED');
      return ok({ ...rb.response, already_applied: true, matched_by: 'quote_id' });
    }
    if (clock.nowMs() > quote.expires_ms) return err('QUOTE_EXPIRED');
    if (quote.change_type === 'voluntary' && !config.voluntaryChangesEnabled) return err('VOLUNTARY_CHANGES_DISABLED');
    if (input.confirmed_total_ars !== quote.payment.total_ars) return err('TOTAL_MISMATCH', { quoted_total_ars: quote.payment.total_ars });
    const booking = await r.bookings.findByPnr(quote.pnr);
    if (!booking || booking.version !== quote.booking_version) return err('QUOTE_STALE');
    const oldFlights = await loadSegmentFlights(r, booking);
    if (!oldFlights) return err('QUOTE_STALE');
    const newFlights = await Promise.all(quote.legs.map((l) => r.flights.get(l.flight_number, l.date)));
    if (newFlights.some((f) => !f || f.status !== 'scheduled' || (f.seats ?? 0) < quote.party_size)) return err('QUOTE_STALE');
    const targetFlights = newFlights as Flight[];

    // ---- compute ----
    const replaced = oldFlights.slice(quote.replace_from);
    const replacedNumbers = new Set(replaced.map((f) => f.flight_number));
    const newSegments = [...booking.segments.slice(0, quote.replace_from), ...targetFlights.map((f) => ({ flight_number: f.flight_number, date: f.date }))];
    const applied = applyAncillaryOutcomes(booking.passengers, booking.ancillaries, quote.change_type, replacedNumbers, targetFlights.map((f) => f.flight_number));
    const cancelCheckin = new Set(quote.per_passenger.filter((p) => p.requires_checkin_cancellation).map((p) => p.passenger_id));
    const passengers = booking.passengers.map((p) => (cancelCheckin.has(p.passenger_id) ? { ...p, checked_in: false } : p));
    const itinerary = [...oldFlights.slice(0, quote.replace_from), ...targetFlights].map(legView);

    const rebookingId = `RB-${hex6(quote.quote_id)}`;
    const response: Body = {
      status: 'ok',
      rebooking_id: rebookingId,
      confirmation_code: safeCode(`confirmation|${quote.quote_id}`),
      receipt_id: `RC-${hex6(quote.quote_id)}`,
      payment: { status: 'simulated_paid', total_ars: quote.payment.total_ars, breakdown: quote.payment.breakdown },
      verified: true,
      new_itinerary: itinerary,
      per_passenger: booking.passengers.map((p) => ({
        passenger_id: p.passenger_id,
        checkin_cancelled: cancelCheckin.has(p.passenger_id),
        action_required: cancelCheckin.has(p.passenger_id) ? 'redo_checkin' : null,
      })),
      ancillaries: applied.results,
      pending: [
        ...[...cancelCheckin].map((id) => `redo_checkin:${id}`),
        ...applied.results.filter((a) => a.outcome === 'not_transferred' && a.type === 'seat_selection').map((a) => `reselect_seat:${a.passenger_id}`),
      ],
    };
    const record: RebookingRecord = {
      rebooking_id: rebookingId,
      quote_id: quote.quote_id,
      pnr: quote.pnr,
      idempotency_key: input.idempotency_key,
      change_type: quote.change_type,
      created_ms: clock.nowMs(),
      response,
    };

    // ---- writes ----
    for (const f of targetFlights) await r.flights.save({ ...f, seats: (f.seats ?? 0) - quote.party_size });
    for (const f of replaced) if (f.status === 'scheduled' && f.seats !== null) await r.flights.save({ ...f, seats: f.seats + quote.party_size });
    await r.bookings.save({ ...booking, segments: newSegments, passengers, ancillaries: applied.ancillaries, version: booking.version + 1 });
    await r.rebookings.save(record);
    await r.quotes.save({ ...quote, status: 'executed', rebooking_id: rebookingId });
    await r.idempotency.save({ key: input.idempotency_key, fingerprint, response });
    return ok(response);
  });
  if (!outcome.ok || outcome.value.already_applied) return outcome;

  // Read-after-write verification (outside the transaction).
  const rebookingId = outcome.value.rebooking_id as string;
  const rb = await deps.repos.rebookings.get(rebookingId);
  const stored = rb ? (await deps.repos.quotes.get(rb.quote_id))?.status === 'executed' : false;
  const booking = rb ? await deps.repos.bookings.findByPnr(rb.pnr) : null;
  const expected = (outcome.value.new_itinerary as Array<{ flight_number: string }>).map((l) => l.flight_number).join();
  const actual = booking ? (await loadSegmentFlights(deps.repos, booking))?.map((f) => f.flight_number).join() : undefined;
  if (!stored || actual !== expected) return err('VERIFICATION_FAILED');
  return outcome;
}
