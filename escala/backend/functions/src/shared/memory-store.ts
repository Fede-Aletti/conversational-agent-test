import { MemoryBookingRepository } from '../bookings/adapters/memory';
import { MemoryHandoffRepository } from '../handoff/adapters/memory';
import { MemoryFlightRepository, flightDocId } from '../operations/adapters/memory';
import { MemorySnippetRepository } from '../policy-rules/adapters/memory';
import { MemoryIdempotencyRepository, MemoryQuoteRepository, MemoryRebookingRepository } from '../rebooking/adapters/memory';
import { MemoryScenarioRepository } from '../scenarios/adapters/memory';
import type { HandoffCase } from '../handoff/ports';
import type { IdempotencyRecord, QuoteRecord, RebookingRecord } from '../rebooking/domain/types';
import { realDelayer, systemClock, type Clock, type Delayer } from './clock';
import { DEFAULT_CONFIG, type Config } from './config';
import type { Booking, Dataset, Flight } from './types';
import type { Deps, Repos, UnitOfWork } from './uow';
import type { FaqSearchPort } from '../policy-rules/ports';

interface State {
  bookings: Map<string, Booking>;
  flights: Map<string, Flight>;
  quotes: Map<string, QuoteRecord>;
  rebookings: Map<string, RebookingRecord>;
  idempotency: Map<string, IdempotencyRecord>;
  handoffs: Map<string, HandoffCase>;
}

export interface MemoryOptions {
  clock?: Clock;
  delay?: Delayer;
  config?: Partial<Config>;
  faq?: FaqSearchPort | null;
}

/** Hexagonal composition with in-memory adapters (unit tests, local runs). The unit of work snapshots and rolls back on error. */
export function createMemoryDeps(data: Dataset, options: MemoryOptions = {}): Deps & { state: State } {
  const state: State = {
    bookings: new Map(data.bookings.map((b) => [b.pnr, structuredClone(b)])),
    flights: new Map(data.flights.map((f) => [flightDocId(f), structuredClone(f)])),
    quotes: new Map(),
    rebookings: new Map(),
    idempotency: new Map(),
    handoffs: new Map(),
  };
  const repos: Repos = {
    bookings: new MemoryBookingRepository(state),
    flights: new MemoryFlightRepository(state),
    quotes: new MemoryQuoteRepository(state),
    rebookings: new MemoryRebookingRepository(state),
    idempotency: new MemoryIdempotencyRepository(state),
    handoffs: new MemoryHandoffRepository(state),
  };
  let queue: Promise<unknown> = Promise.resolve();
  const uow: UnitOfWork = {
    run<T>(fn: (r: Repos) => Promise<T>): Promise<T> {
      const exec = async (): Promise<T> => {
        const snapshot = structuredClone(state);
        try {
          return await fn(repos);
        } catch (e) {
          Object.assign(state, snapshot);
          throw e;
        }
      };
      const next = queue.then(exec, exec);
      queue = next.catch(() => undefined);
      return next;
    },
  };
  return {
    state,
    repos,
    uow,
    snippets: new MemorySnippetRepository(data.policy_snippets),
    scenarios: new MemoryScenarioRepository(data.scenarios),
    faq: options.faq ?? null,
    clock: options.clock ?? systemClock,
    delay: options.delay ?? realDelayer,
    config: { ...DEFAULT_CONFIG, ...options.config },
  };
}
