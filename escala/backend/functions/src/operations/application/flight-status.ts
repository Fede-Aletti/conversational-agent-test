import { err, ok, type Result } from '../../shared/result';
import type { Deps } from '../../shared/uow';
import { simulateFailure } from '../domain/failure';

export async function getFlightStatus(deps: Deps, flightNumber: string, date: string): Promise<Result<Record<string, unknown>>> {
  const flight = await deps.repos.flights.get(flightNumber.trim().toUpperCase(), date);
  if (!flight) return err('FLIGHT_NOT_FOUND', { flight_number: flightNumber, date });
  const failure = await simulateFailure(flight.failure_mode, 'getFlightStatus', deps.delay, deps.config);
  if (!failure.ok) return failure;
  const delay = flight.delay_min ?? 0;
  const status =
    flight.status === 'cancelled'
      ? 'cancelled'
      : delay > 0
        ? 'delayed'
        : flight.schedule_change_min
          ? 'schedule_changed'
          : 'on_time';
  return ok({
    status: 'ok',
    flight_number: flight.flight_number,
    date: flight.date,
    origin: flight.origin,
    destination: flight.destination,
    scheduled_departure: flight.dep,
    scheduled_arrival: flight.arr,
    flight_status: status,
    delay_minutes: delay,
    schedule_change_minutes: flight.schedule_change_min ?? 0,
    equipment_downgrade: flight.equipment_downgrade === true,
  });
}
