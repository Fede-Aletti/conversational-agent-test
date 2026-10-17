import type { Flight } from '../../shared/types';

export interface FlightRepository {
  get(flightNumber: string, date: string): Promise<Flight | null>;
  /** Flights with fromDate <= date <= toDate (inclusive). */
  listByDateRange(fromDate: string, toDate: string): Promise<Flight[]>;
  save(flight: Flight): Promise<void>;
}
