import type { IdempotencyRecord, QuoteRecord, RebookingRecord } from '../../domain/types';
import type { IdempotencyRepository, QuoteRepository, RebookingRepository } from '../../ports';

export class MemoryQuoteRepository implements QuoteRepository {
  constructor(private readonly state: { quotes: Map<string, QuoteRecord> }) {}
  async get(id: string) {
    const q = this.state.quotes.get(id);
    return q ? structuredClone(q) : null;
  }
  async save(q: QuoteRecord) {
    this.state.quotes.set(q.quote_id, structuredClone(q));
  }
  async listByPnr(pnr: string) {
    return [...this.state.quotes.values()].filter((q) => q.pnr === pnr).map((q) => structuredClone(q));
  }
}

export class MemoryRebookingRepository implements RebookingRepository {
  constructor(private readonly state: { rebookings: Map<string, RebookingRecord> }) {}
  async get(id: string) {
    const r = this.state.rebookings.get(id);
    return r ? structuredClone(r) : null;
  }
  async save(r: RebookingRecord) {
    this.state.rebookings.set(r.rebooking_id, structuredClone(r));
  }
  async listByPnr(pnr: string) {
    return [...this.state.rebookings.values()].filter((r) => r.pnr === pnr).map((r) => structuredClone(r));
  }
}

export class MemoryIdempotencyRepository implements IdempotencyRepository {
  constructor(private readonly state: { idempotency: Map<string, IdempotencyRecord> }) {}
  async get(key: string) {
    const r = this.state.idempotency.get(key);
    return r ? structuredClone(r) : null;
  }
  async save(r: IdempotencyRecord) {
    this.state.idempotency.set(r.key, structuredClone(r));
  }
}
