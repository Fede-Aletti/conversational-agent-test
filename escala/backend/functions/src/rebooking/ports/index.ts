import type { IdempotencyRecord, QuoteRecord, RebookingRecord } from '../domain/types';

export interface QuoteRepository {
  get(quoteId: string): Promise<QuoteRecord | null>;
  save(quote: QuoteRecord): Promise<void>;
  listByPnr(pnr: string): Promise<QuoteRecord[]>;
}

export interface RebookingRepository {
  get(rebookingId: string): Promise<RebookingRecord | null>;
  save(rebooking: RebookingRecord): Promise<void>;
  listByPnr(pnr: string): Promise<RebookingRecord[]>;
}

export interface IdempotencyRepository {
  get(key: string): Promise<IdempotencyRecord | null>;
  save(record: IdempotencyRecord): Promise<void>;
}
