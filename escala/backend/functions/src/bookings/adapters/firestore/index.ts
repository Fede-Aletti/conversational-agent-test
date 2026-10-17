import type { Booking } from '../../../shared/types';
import { FsCtx } from '../../../shared/firestore-ctx';
import { normalizeName } from '../../domain/normalize';
import type { BookingRepository } from '../../ports';

const strip = ({ surname_keys: _k, ...rest }: Booking & { surname_keys?: string[] }): Booking => rest;

export class FirestoreBookingRepository implements BookingRepository {
  constructor(private readonly ctx: FsCtx) {}
  async findByPnr(pnr: string) {
    const b = await this.ctx.get<Booking>('bookings', pnr);
    return b ? strip(b) : null;
  }
  async findBySurname(key: string) {
    const docs = await this.ctx.query<Booking>(this.ctx.db.collection('bookings').where('surname_keys', 'array-contains', key));
    return docs.map(strip);
  }
  async save(booking: Booking) {
    await this.ctx.set('bookings', booking.pnr, { ...booking, surname_keys: [...new Set(booking.passengers.map((p) => normalizeName(p.last_name)))] });
  }
}
