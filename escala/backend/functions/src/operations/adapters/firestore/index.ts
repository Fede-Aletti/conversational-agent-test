import type { Flight } from '../../../shared/types';
import { FsCtx } from '../../../shared/firestore-ctx';
import type { FlightRepository } from '../../ports';

const id = (flightNumber: string, date: string) => `${flightNumber}_${date}`;

export class FirestoreFlightRepository implements FlightRepository {
  constructor(private readonly ctx: FsCtx) {}
  get(flightNumber: string, date: string) {
    return this.ctx.get<Flight>('flights', id(flightNumber, date));
  }
  listByDateRange(from: string, to: string) {
    return this.ctx.query<Flight>(this.ctx.db.collection('flights').where('date', '>=', from).where('date', '<=', to));
  }
  async save(f: Flight) {
    await this.ctx.set('flights', id(f.flight_number, f.date), f);
  }
}
