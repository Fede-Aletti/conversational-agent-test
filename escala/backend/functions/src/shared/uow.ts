import type { BookingRepository } from '../bookings/ports';
import type { FlightRepository } from '../operations/ports';
import type { HandoffRepository } from '../handoff/ports';
import type { IdempotencyRepository, QuoteRepository, RebookingRepository } from '../rebooking/ports';
import type { PolicySnippetRepository, FaqSearchPort } from '../policy-rules/ports';
import type { ScenarioRepository } from '../scenarios/ports';
import type { Clock, Delayer } from './clock';
import type { Config } from './config';

export interface Repos {
  bookings: BookingRepository;
  flights: FlightRepository;
  quotes: QuoteRepository;
  rebookings: RebookingRepository;
  idempotency: IdempotencyRepository;
  handoffs: HandoffRepository;
}

/** Runs `fn` atomically against transaction-bound repositories (all reads before writes). */
export interface UnitOfWork {
  run<T>(fn: (repos: Repos) => Promise<T>): Promise<T>;
}

export interface Deps {
  repos: Repos;
  uow: UnitOfWork;
  snippets: PolicySnippetRepository;
  scenarios: ScenarioRepository;
  faq: FaqSearchPort | null;
  clock: Clock;
  delay: Delayer;
  config: Config;
}
