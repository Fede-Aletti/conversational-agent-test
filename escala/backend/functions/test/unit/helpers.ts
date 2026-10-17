import { buildDataset } from '../../seed/dataset';
import { handleRequest, type ApiResponse } from '../../src/http/router';
import type { Clock, Delayer } from '../../src/shared/clock';
import type { Config } from '../../src/shared/config';
import { createMemoryDeps, type MemoryOptions } from '../../src/shared/memory-store';
import type { FaqSearchPort } from '../../src/policy-rules/ports';

export class FakeClock implements Clock {
  constructor(public now = Date.parse('2026-10-17T12:00:00Z')) {}
  simulatedToday = () => '2026-11-12';
  nowMs = () => this.now;
  advanceMin(min: number) {
    this.now += min * 60000;
  }
}

export class FakeDelayer implements Delayer {
  sleeps: number[] = [];
  async sleep(ms: number) {
    this.sleeps.push(ms);
  }
}

export function makeApp(options: MemoryOptions & { config?: Partial<Config>; faq?: FaqSearchPort | null } = {}) {
  const clock = new FakeClock();
  const delay = new FakeDelayer();
  const deps = createMemoryDeps(buildDataset(), { clock, delay, ...options });
  const call = (method: string, path: string, input: { query?: Record<string, string>; body?: unknown } = {}): Promise<ApiResponse> =>
    handleRequest(deps, { method, path, query: input.query ?? {}, body: input.body });
  const get = async (path: string, query: Record<string, string> = {}) => (await call('GET', path, { query })).body as any;
  const post = async (path: string, body: unknown) => (await call('POST', path, { body })).body as any;
  return {
    deps, clock, delay, call, get, post,
    lookup: (last_name: string, pnr: string) => get('/bookings/lookup', { last_name, pnr }),
    options: (pnr: string, body: object = {}) => post(`/disruptions/${pnr}/options`, body),
    rebook: (quote_id: string, total: number, key = `rebook-${quote_id}`, confirmed: boolean = true) =>
      post('/rebookings', { quote_id, confirmed, confirmed_total_ars: total, idempotency_key: key }),
  };
}

export type App = ReturnType<typeof makeApp>;
