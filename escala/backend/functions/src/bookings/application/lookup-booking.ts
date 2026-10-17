import { err, ok, type Result } from '../../shared/result';
import type { Repos, Deps } from '../../shared/uow';
import type { Booking, Flight } from '../../shared/types';
import { computeFacts } from '../../operations/domain/impact';
import { classifyDisruption } from '../../policy-rules/domain/rules';
import { normalizeIata, normalizeName, normalizePnr } from '../domain/normalize';

export interface LookupParams {
  last_name: string;
  pnr?: string;
  flight_date?: string;
  origin?: string;
  destination?: string;
}

export async function loadSegmentFlights(repos: Repos, booking: Booking): Promise<Flight[] | null> {
  const flights = await Promise.all(booking.segments.map((s) => repos.flights.get(s.flight_number, s.date)));
  return flights.every((f): f is Flight => f !== null) ? (flights as Flight[]) : null;
}

export async function findBooking(repos: Repos, p: LookupParams): Promise<Booking | null> {
  const surname = normalizeName(p.last_name);
  if (p.pnr) {
    const booking = await repos.bookings.findByPnr(normalizePnr(p.pnr));
    return booking && booking.passengers.some((x) => normalizeName(x.last_name) === surname) ? booking : null;
  }
  const candidates = (await repos.bookings.findBySurname(surname)).sort((a, b) => a.pnr.localeCompare(b.pnr));
  const origin = p.origin ? normalizeIata(p.origin) : null;
  const destination = p.destination ? normalizeIata(p.destination) : null;
  for (const b of candidates) {
    const flights = await loadSegmentFlights(repos, b);
    if (!flights) continue;
    const onDate = flights.filter((f) => f.date === p.flight_date);
    const matches =
      onDate.some((f) => (!origin || f.origin === origin) && (!destination || f.destination === destination)) ||
      (onDate.length > 0 && (!origin || flights[0].origin === origin) && (!destination || flights[flights.length - 1].destination === destination));
    if (matches) return b;
  }
  return null;
}

/** Identification: PNR + surname, else surname + date + route. Returns a trimmed view for the agent. */
export async function lookupBooking(deps: Deps, params: LookupParams): Promise<Result<Record<string, unknown>>> {
  const booking = await findBooking(deps.repos, params);
  if (!booking) return err('BOOKING_NOT_FOUND');
  return buildBookingView(deps, booking);
}

/** Trimmed, agent-facing booking view (also used as the handoff booking snapshot). */
export async function buildBookingView(deps: Deps, booking: Booking): Promise<Result<Record<string, unknown>>> {
  const flights = await loadSegmentFlights(deps.repos, booking);
  if (!flights) return err('UPSTREAM_ERROR', { reason: 'segment flight missing' });
  const facts = computeFacts(flights);
  const cls = classifyDisruption(facts, deps.config);
  return ok({
    status: 'ok',
    pnr: booking.pnr,
    passengers: booking.passengers.map((p) => ({
      passenger_id: p.passenger_id,
      first_name: p.first_name,
      last_name: p.last_name,
      type: p.type,
      checked_in: p.checked_in,
      fare_family: p.fare_family,
    })),
    segments: flights.map((f, i) => ({
      segment: i + 1,
      flight_number: f.flight_number,
      date: f.date,
      origin: f.origin,
      destination: f.destination,
      departure: f.dep,
      arrival: f.arr,
      flight_status:
        f.status === 'cancelled' ? 'cancelled' : (f.delay_min ?? 0) > 0 ? 'delayed' : f.schedule_change_min ? 'schedule_changed' : 'on_time',
      delay_minutes: f.delay_min ?? 0,
    })),
    connection_status: cls.connection_status,
    ancillaries: booking.ancillaries.map((a) => ({
      passenger_id: a.passenger_id,
      type: a.type,
      segments: a.segments,
      paid_ars: a.paid_ars,
      ...(a.detail ? { detail: a.detail } : {}),
    })),
    disruption: {
      change_type_hint: cls.change_type,
      disruption_type: cls.disruption_type,
      affected_segments: cls.impacted.map((i) => flights[i].flight_number),
    },
  });
}
