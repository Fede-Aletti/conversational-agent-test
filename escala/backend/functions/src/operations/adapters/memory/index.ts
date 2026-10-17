import type { Flight } from '../../../shared/types';
import type { FlightRepository } from '../../ports';

export const flightDocId = (f: { flight_number: string; date: string }): string => `${f.flight_number}_${f.date}`;

export class MemoryFlightRepository implements FlightRepository {
  constructor(private readonly state: { flights: Map<string, Flight> }) {}
  async get(flightNumber: string, date: string) {
    const f = this.state.flights.get(flightDocId({ flight_number: flightNumber, date }));
    return f ? structuredClone(f) : null;
  }
  async listByDateRange(from: string, to: string) {
    return [...this.state.flights.values()].filter((f) => f.date >= from && f.date <= to).map((f) => structuredClone(f));
  }
  async save(flight: Flight) {
    this.state.flights.set(flightDocId(flight), structuredClone(flight));
  }
}
