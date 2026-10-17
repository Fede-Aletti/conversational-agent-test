import { FsCtx } from '../../../shared/firestore-ctx';
import type { IdempotencyRecord, QuoteRecord, RebookingRecord } from '../../domain/types';
import type { IdempotencyRepository, QuoteRepository, RebookingRepository } from '../../ports';

export class FirestoreQuoteRepository implements QuoteRepository {
  constructor(private readonly ctx: FsCtx) {}
  get(id: string) {
    return this.ctx.get<QuoteRecord>('quotes', id);
  }
  async save(q: QuoteRecord) {
    await this.ctx.set('quotes', q.quote_id, q);
  }
  listByPnr(pnr: string) {
    return this.ctx.query<QuoteRecord>(this.ctx.db.collection('quotes').where('pnr', '==', pnr));
  }
}

export class FirestoreRebookingRepository implements RebookingRepository {
  constructor(private readonly ctx: FsCtx) {}
  get(id: string) {
    return this.ctx.get<RebookingRecord>('rebookings', id);
  }
  async save(r: RebookingRecord) {
    await this.ctx.set('rebookings', r.rebooking_id, r);
  }
  listByPnr(pnr: string) {
    return this.ctx.query<RebookingRecord>(this.ctx.db.collection('rebookings').where('pnr', '==', pnr));
  }
}

export class FirestoreIdempotencyRepository implements IdempotencyRepository {
  constructor(private readonly ctx: FsCtx) {}
  get(key: string) {
    return this.ctx.get<IdempotencyRecord>('idempotency', encodeURIComponent(key));
  }
  async save(r: IdempotencyRecord) {
    await this.ctx.set('idempotency', encodeURIComponent(r.key), r);
  }
}
