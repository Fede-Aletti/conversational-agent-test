import { describe, expect, it } from 'vitest';
import { buildDataset, FIXTURE_BOOKINGS, FIXTURE_SCENARIOS, hashDataset } from '../../seed/dataset';
import { DIMENSIONS, generateScenarios, SEED } from '../../seed/generate';
import type { ExpectedOutcome, ScenarioEntry } from '../../src/shared/types';
import { makeApp } from './helpers';

const generated = (): ScenarioEntry[] => buildDataset().scenarios.filter((s) => s.type === 'generated');
const isOutcome = (e: ScenarioEntry['expected_outcome']): e is ExpectedOutcome => 'party_size' in e;

describe('CUJ-21 generator invariants', () => {
  it('is deterministic: identical dataset hash across runs', () => {
    const reserved = new Set(FIXTURE_BOOKINGS.map((b) => b.pnr));
    const one = generateScenarios(SEED, reserved);
    const two = generateScenarios(SEED, reserved);
    expect(hashDataset({ ...one, policy_snippets: [] } as never)).toBe(hashDataset({ ...two, policy_snippets: [] } as never));
    expect(hashDataset(generateScenarios(SEED + 1, reserved) as never)).not.toBe(hashDataset(one as never));
    expect(hashDataset()).toBe(hashDataset());
  });

  it('produces ~120 generated bookings next to 22 named fixtures', () => {
    expect(generated().length).toBeGreaterThanOrEqual(100);
    expect(generated().length).toBeLessThanOrEqual(140);
    expect(FIXTURE_SCENARIOS).toHaveLength(22);
    expect(generated()[0].scenario_id).toBe('GEN-0001');
  });

  it('PNRs are unique, use the safe alphabet and never collide with fixtures', () => {
    const { bookings } = buildDataset();
    expect(new Set(bookings.map((b) => b.pnr)).size).toBe(bookings.length);
    for (const s of generated()) expect(s.pnr).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
  });

  it('covers every valid pair of dimension values, and the full disruption x availability product for 1 and 3 adults', () => {
    const rows = generated().map((s) => Object.fromEntries(s.tags.filter((t) => t.includes(':') && Object.keys(DIMENSIONS).includes(t.split(':')[0])).map((t) => t.split(':'))));
    const names = Object.keys(DIMENSIONS) as Array<keyof typeof DIMENSIONS>;
    const seen = new Set(rows.flatMap((r) => names.flatMap((a, i) => names.slice(i + 1).map((b) => `${a}=${r[a]}|${b}=${r[b]}`))));
    const missing: string[] = [];
    names.forEach((a, i) =>
      names.slice(i + 1).forEach((b) =>
        DIMENSIONS[a].forEach((va) =>
          DIMENSIONS[b].forEach((vb) => {
            const invalid = (a === 'shape' && va === 'direct' && b === 'disruption' && vb === 'missed_connection') || (b === 'shape' && vb === 'direct' && a === 'disruption' && va === 'missed_connection');
            if (!invalid && !seen.has(`${a}=${va}|${b}=${vb}`)) missing.push(`${a}=${va}|${b}=${vb}`);
          }),
        ),
      ),
    );
    expect(missing).toEqual([]);
    for (const pax of ['1a', '3a'])
      for (const d of DIMENSIONS.disruption)
        for (const av of DIMENSIONS.avail) expect(rows.some((r) => r.pax === pax && r.disruption === d && r.avail === av)).toBe(true);
  });

  it('assigns failure modes to a small subset (about 1 in 20)', () => {
    const failing = generated().filter((s) => s.tags.some((t) => t.startsWith('failure:')));
    expect(failing.length).toBeGreaterThanOrEqual(4);
    expect(failing.length).toBeLessThanOrEqual(8);
    expect(new Set(failing.flatMap((s) => s.tags.filter((t) => t.startsWith('failure:')))).size).toBe(3);
  });

  it('seed integrity: seats never negative, every booking segment resolves, every scenario PNR resolves', () => {
    const { flights, bookings, scenarios } = buildDataset();
    expect(flights.every((f) => f.seats === null || f.seats >= 0)).toBe(true);
    expect(flights.every((f) => (f.seats === null) === (f.status === 'cancelled'))).toBe(true);
    const keys = new Set(flights.map((f) => `${f.flight_number}_${f.date}`));
    expect(new Set(flights.map((f) => f.flight_number + f.date)).size).toBe(flights.length);
    for (const b of bookings) for (const s of b.segments) expect(keys.has(`${s.flight_number}_${s.date}`)).toBe(true);
    const pnrs = new Set(bookings.map((b) => b.pnr));
    for (const s of scenarios) if (s.pnr !== 'QWE4RT') expect(pnrs.has(s.pnr)).toBe(true);
  });
});

/** Independent oracle: classifies an API response into the expected-outcome vocabulary. */
function classify(res: any): string {
  if (res.error_code === 'UPSTREAM_TIMEOUT') return 'failure:timeout';
  if (res.error_code === 'UPSTREAM_ERROR') return 'failure:5xx';
  if (res.status === 'error') return `error:${res.error_code}`;
  if (res.no_change_needed) return 'no_change_needed';
  if (res.blocking_reasons.length) return 'blocked_policy';
  if (!res.options.length) return res.options_after_deadline.length ? 'only_after_deadline' : 'no_options';
  if (res.options.some((o: any) => o.executable)) return 'options_available';
  return res.options.some((o: any) => o.not_executable_reason === 'INSUFFICIENT_SEATS') ? 'partial_seats_only' : 'needs_review';
}

describe('CUJ-21/22 every scenario behaves as its expected outcome', () => {
  const app = makeApp();
  const withOutcome = buildDataset().scenarios.filter((s) => isOutcome(s.expected_outcome));

  it('has expected outcomes for 21 fixtures + all generated scenarios', () => {
    expect(withOutcome.length).toBe(20 + generated().length);
  });

  it.each(withOutcome.map((s) => [s.scenario_id, s] as const))('%s', async (_id, s) => {
    const expected = s.expected_outcome as ExpectedOutcome;
    expect((await app.lookup(s.surname, s.pnr)).status).toBe('ok');
    const res = await app.options(s.pnr, s.probe ?? {});
    expect(classify(res)).toBe(expected.class);
    if (res.status !== 'ok') return;
    expect(res).toMatchObject({ change_type: expected.change_type, disruption_type: expected.disruption_type, party_size: expected.party_size });
    expect(Boolean(res.keep_current)).toBe(Boolean(expected.has_keep_current));
    for (const o of [...res.options, ...res.options_after_deadline]) {
      if (o.executable) {
        expect(o.fits_party).toBe(true);
        expect(o.seats_available).toBeGreaterThanOrEqual(expected.party_size);
        expect(o.quote_id).toMatch(/^Q-/);
        expect(o.not_executable_reason).toBeUndefined();
      } else {
        expect(o.quote_id).toBeUndefined();
        expect(o.not_executable_reason).toBeDefined();
      }
    }
  });

  it('rebooking then replaying is idempotent for every scenario that has an executable option', async () => {
    let executed = 0;
    for (const s of withOutcome) {
      const exp = s.expected_outcome as ExpectedOutcome;
      if (exp.class !== 'options_available') continue;
      const res = await app.options(s.pnr, s.probe ?? {});
      const option = [...res.options, ...res.options_after_deadline].find((o: any) => o.executable);
      const first = await app.rebook(option.quote_id, option.payment.total_ars);
      expect(first.status, s.scenario_id).toBe('ok');
      const replay = await app.rebook(option.quote_id, option.payment.total_ars);
      expect(replay).toMatchObject({ already_applied: true, receipt_id: first.receipt_id, confirmation_code: first.confirmation_code });
      executed += 1;
    }
    expect(executed).toBeGreaterThan(30);
    expect([...app.deps.state.flights.values()].every((f) => f.seats === null || f.seats >= 0)).toBe(true);
  });
});
