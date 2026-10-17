import type { Booking } from '../../shared/types';

export interface BookingRepository {
  findByPnr(pnr: string): Promise<Booking | null>;
  /** Bookings having a passenger whose normalized surname equals `normalizedSurname`. */
  findBySurname(normalizedSurname: string): Promise<Booking[]>;
  save(booking: Booking): Promise<void>;
}
