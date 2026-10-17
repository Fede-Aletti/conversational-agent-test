import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { beforeAll, describe, expect, it } from 'vitest';
import { seedFirestore } from '../../seed/seed';
import { buildDataset } from '../../seed/dataset';
import { handleRequest } from '../../src/http/router';
import { createFirestoreDeps } from '../../src/shared/firestore-deps';
import { hex6 } from '../../src/shared/ids';
import type { Deps } from '../../src/shared/uow';

/**
 * Runs against the Firestore emulator only: `npm run test:integration` (firebase emulators:exec).
 * Without FIRESTORE_EMULATOR_HOST the suite is skipped, so it can never touch a real project.
 */
const emulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);

describe.skipIf(!emulator)('Firestore adapters + HTTP API (emulator)', () => {
  let db: Firestore;
  let deps: Deps;
  const slept: number[] = [];
  const call = async (method: string, path: string, input: { query?: Record<string, string>; body?: unknown } = {}) =>
    handleRequest(deps, { method, path, query: input.query ?? {}, body: input.body });
  const get = async (path: string, query: Record<string, string> = {}) => (await call('GET', path, { query })).body as any;
  const post = async (path: string, body: unknown) => (await call('POST', path, { body })).body as any;
  const options = (pnr: string, body: object = {}) => post(`/disruptions/${pnr}/options`, body);
  const rebook = (quote_id: string, total: number, key = `rebook-${quote_id}`) =>
    post('/rebookings', { quote_id, confirmed: true, confirmed_total_ars: total, idempotency_key: key });
  const count = async (name: string) => (await db.collection(name).count().get()).data().count;

  beforeAll(async () => {
    if (!getApps().length) initializeApp({ projectId: process.env.GCLOUD_PROJECT ?? 'demo-escala' });
    db = getFirestore();
    await seedFirestore(db, buildDataset(), { reset: true });
    deps = createFirestoreDeps(db, { config: { enableScenariosEndpoint: true }, delay: { sleep: async (ms) => void slept.push(ms) } });
  });

  it('seed is idempotent: re-running yields the same documents', async () => {
    const data = buildDataset();
    const before = [await count('flights'), await count('bookings'), await count('scenarios'), await count('policy_snippets')];
    expect(before).toEqual([data.flights.length, data.bookings.length, data.scenarios.length, data.policy_snippets.length]);
    await seedFirestore(db, data);
    expect([await count('flights'), await count('bookings'), await count('scenarios'), await count('policy_snippets')]).toEqual(before);
  });

  it('CUJ-04: lookup by PNR, normalized, and by surname + date + route', async () => {
    expect((await get('/bookings/lookup', { last_name: 'benitez', pnr: 'rm-r4tx' })).pnr).toBe('RMR4TX');
    expect((await get('/bookings/lookup', { last_name: 'Ferreyra', pnr: 'LQ3W9B' })).error_code).toBe('BOOKING_NOT_FOUND');
    expect(await get('/bookings/lookup', { last_name: 'FERREYRA', flight_date: '2026-11-14', origin: 'aep', destination: 'MDZ' })).toMatchObject({ pnr: 'LQ3W9D' });
    expect((await get('/bookings/lookup', { last_name: 'Nadie', pnr: 'QWE4RT' })).error_code).toBe('BOOKING_NOT_FOUND');
  });

  it('CUJ-09/24: simulated failures come from data', async () => {
    expect(await options('SV2T7K', { deadline: 'tomorrow' })).toMatchObject({ error_code: 'UPSTREAM_TIMEOUT', retryable: true });
    expect(await get('/flights/AR1698/status', { date: '2026-11-12' })).toMatchObject({ error_code: 'UPSTREAM_TIMEOUT' });
    expect(await options('UE4Q8H')).toMatchObject({ error_code: 'UPSTREAM_ERROR' });
    expect((await options('SL6Y3M')).status).toBe('ok');
    expect(slept).toEqual([8000]);
  });

  it('CUJ-01/05/06: RMR4TX options -> rebooking end to end, verified, with check-in cancellation', async () => {
    const res = await options('RMR4TX', { deadline: 'tomorrow' });
    expect(res.options.map((o: any) => [o.option_id, o.executable])).toEqual([['A', true], ['B', true], ['C', false]]);
    const a = res.options[0];
    expect((await post('/rebookings', { quote_id: a.quote_id, confirmed: false, confirmed_total_ars: 0, idempotency_key: 'k' })).error_code).toBe('CONFIRMATION_REQUIRED');
    expect((await db.collection('quotes').doc(a.quote_id).get()).data()?.status).toBe('open');

    const done = await rebook(a.quote_id, 0);
    expect(done).toMatchObject({ status: 'ok', verified: true, receipt_id: `RC-${hex6(a.quote_id)}`, payment: { status: 'simulated_paid', total_ars: 0 } });
    expect(done.per_passenger[1]).toEqual({ passenger_id: 'P2', checkin_cancelled: true, action_required: 'redo_checkin' });

    const booking = await get('/bookings/lookup', { last_name: 'Romero', pnr: 'RMR4TX' });
    expect(booking.segments.map((s: any) => s.flight_number)).toEqual(['AR1880']);
    expect(booking.passengers.map((p: any) => p.checked_in)).toEqual([false, false]);
    expect((await db.collection('flights').doc('AR1880_2026-11-13').get()).data()?.seats).toBe(0);
    expect((await db.collection('flights').doc('AR1692_2026-11-12').get()).data()?.seats).toBe(14);

    const replay = await rebook(a.quote_id, 0);
    expect(replay).toMatchObject({ already_applied: true, confirmation_code: done.confirmation_code });
    expect((await rebook(a.quote_id, 0, 'other-key')).matched_by).toBe('quote_id');
    expect((await rebook(a.quote_id, 7)).error_code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('CUJ-03: two concurrent identical requests execute exactly once (transaction)', async () => {
    const quote = (await options('DP4N8S', { deadline: 'tomorrow' })).options[0].quote_id;
    const results = await Promise.all([rebook(quote, 0), rebook(quote, 0), rebook(quote, 0)]);
    expect(results.every((r) => r.status === 'ok')).toBe(true);
    expect(results.filter((r) => !r.already_applied)).toHaveLength(1);
    expect(await db.collection('rebookings').where('pnr', '==', 'DP4N8S').count().get().then((s) => s.data().count)).toBe(1);
    expect((await db.collection('flights').doc('AR1702_2026-11-12').get()).data()?.seats).toBe(8);
  });

  it('CUJ-25: voluntary change confirmed by amount; mismatch writes nothing', async () => {
    const opt = (await options('NV8C5R', { target_date: '2026-11-15' })).options[0];
    expect(opt.payment.total_ars).toBe(45000);
    expect((await rebook(opt.quote_id, 1000)).error_code).toBe('TOTAL_MISMATCH');
    expect(await count('idempotency')).toBe(2);
    expect(await rebook(opt.quote_id, 45000)).toMatchObject({ status: 'ok', payment: { status: 'simulated_paid', total_ars: 45000 } });
  });

  it('CUJ-10: policy block has no quotes', async () => {
    expect(await options('PB9K4Z', { target_date: '2026-11-17' })).toMatchObject({ blocking_reasons: ['POLICY_FARE_NOT_CHANGEABLE'], options: [] });
    expect((await rebook('Q-FABRICAT', 0)).error_code).toBe('QUOTE_NOT_FOUND');
  });

  it('CUJ-13: handoff case is persisted with context and is idempotent', async () => {
    const key = 'handoff-RMR4TX-1';
    const res = await post('/handoff-cases', { reason: 'user_request', summary: 'Wants a person', pnr: 'RMR4TX', idempotency_key: key });
    expect(res.case_id).toBe(`HC-${hex6(key)}`);
    const doc = (await db.collection('handoff_cases').doc(res.case_id).get()).data()!;
    expect(doc.context.booking_snapshot.pnr).toBe('RMR4TX');
    expect(doc.context.rebookings.length).toBe(1);
    expect(await post('/handoff-cases', { reason: 'user_request', summary: 'Wants a person', pnr: 'RMR4TX', idempotency_key: key })).toMatchObject({ case_id: res.case_id, already_applied: true });
    expect((await post('/handoff-cases', { reason: 'user_request', summary: 'No PNR', idempotency_key: 'handoff-NOPNR-1' })).status).toBe('ok');
  });

  it('CUJ-15: FAQ falls back to curated snippets stored in Firestore', async () => {
    expect(await get('/policies/faq', { q: 'equipaje adicional' })).toMatchObject({ source: 'curated_fallback', verified: false });
  });

  it('CUJ-23: /scenarios lists fixtures first then generated (flag on)', async () => {
    const all = await get('/scenarios');
    expect(all.total).toBe(buildDataset().scenarios.length);
    expect(all.scenarios[0].scenario_id).toBe('FX-DEMO');
    expect(all.scenarios[22].scenario_id).toBe('GEN-0001');
    expect((await get('/scenarios', { type: 'fixture' })).total).toBe(22);
  });

  it('CUJ-21: generated scenarios behave as expected against Firestore (sample)', async () => {
    const sample = buildDataset().scenarios.filter((s) => s.type === 'generated' && 'party_size' in s.expected_outcome).filter((_, i) => i % 6 === 0);
    for (const s of sample) {
      const exp = s.expected_outcome as { class: string; party_size: number };
      const res = await options(s.pnr, s.probe ?? {});
      if (exp.class.startsWith('failure:')) expect(res.status).toBe('error');
      else {
        expect(res.status, s.scenario_id).toBe('ok');
        expect(res.party_size).toBe(exp.party_size);
        if (exp.class === 'options_available') expect(res.options.some((o: any) => o.executable)).toBe(true);
        if (exp.class === 'no_options') expect(res.options.length + res.options_after_deadline.length).toBe(0);
      }
    }
  });
});
