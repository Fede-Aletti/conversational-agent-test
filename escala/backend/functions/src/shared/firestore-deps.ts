import type { Firestore } from 'firebase-admin/firestore';
import { FirestoreBookingRepository } from '../bookings/adapters/firestore';
import { FirestoreHandoffRepository } from '../handoff/adapters/firestore';
import { FirestoreFlightRepository } from '../operations/adapters/firestore';
import { FirestoreSnippetRepository } from '../policy-rules/adapters/firestore';
import { FirestoreIdempotencyRepository, FirestoreQuoteRepository, FirestoreRebookingRepository } from '../rebooking/adapters/firestore';
import { FirestoreScenarioRepository } from '../scenarios/adapters/firestore';
import { realDelayer, systemClock, type Clock, type Delayer } from './clock';
import { DEFAULT_CONFIG, type Config } from './config';
import { FsCtx } from './firestore-ctx';
import { configureFirestore } from './firestore';
import type { FaqSearchPort } from '../policy-rules/ports';
import type { Deps, Repos, UnitOfWork } from './uow';

const reposFor = (ctx: FsCtx): Repos => ({
  bookings: new FirestoreBookingRepository(ctx),
  flights: new FirestoreFlightRepository(ctx),
  quotes: new FirestoreQuoteRepository(ctx),
  rebookings: new FirestoreRebookingRepository(ctx),
  idempotency: new FirestoreIdempotencyRepository(ctx),
  handoffs: new FirestoreHandoffRepository(ctx),
});

export function createFirestoreDeps(
  firestore: Firestore,
  options: { config?: Partial<Config>; faq?: FaqSearchPort | null; clock?: Clock; delay?: Delayer } = {},
): Deps {
  const db = configureFirestore(firestore);
  const uow: UnitOfWork = {
    run: (fn) => db.runTransaction((tx) => fn(reposFor(new FsCtx(db, tx)))),
  };
  return {
    repos: reposFor(new FsCtx(db)),
    uow,
    snippets: new FirestoreSnippetRepository(db),
    scenarios: new FirestoreScenarioRepository(db),
    faq: options.faq ?? null,
    clock: options.clock ?? systemClock,
    delay: options.delay ?? realDelayer,
    config: { ...DEFAULT_CONFIG, ...options.config },
  };
}
