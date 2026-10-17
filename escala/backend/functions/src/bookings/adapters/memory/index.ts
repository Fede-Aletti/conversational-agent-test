import type { Booking } from '../../../shared/types';
import { normalizeName } from '../../domain/normalize';
import type { BookingRepository } from '../../ports';

export class MemoryBookingRepository implements BookingRepository {
  constructor(private readonly state: { bookings: Map<string, Booking> }) {}
  async findByPnr(pnr: string) {
    const b = this.state.bookings.get(pnr);
    return b ? structuredClone(b) : null;
  }
  async findBySurname(key: string) {
    return [...this.state.bookings.values()]
      .filter((b) => b.passengers.some((p) => normalizeName(p.last_name) === key))
      .map((b) => structuredClone(b));
  }
  async save(booking: Booking) {
    this.state.bookings.set(booking.pnr, structuredClone(booking));
  }
}
