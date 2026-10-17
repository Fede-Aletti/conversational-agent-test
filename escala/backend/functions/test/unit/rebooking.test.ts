import { describe, expect, it, vi } from 'vitest';
import { createRebooking } from '../../src/rebooking/application/create-rebooking';
import { hex6 } from '../../src/shared/ids';
import { makeApp } from './helpers';

async function demo(app = makeApp()) {
  const res = await app.options('RMR4TX', { deadline: 'tomorrow' });
  return { app, a: res.options[0], b: res.options[1], c: res.options[2] };
}

describe('CUJ-01/05/06 end to end rebooking of RMR4TX', () => {
  it('executes option A atomically and verifies it', async () => {
    const { app, a } = await demo();
    const res = await app.rebook(a.quote_id, 0);
    expect(res).toMatchObject({
      status: 'ok',
      verified: true,
      receipt_id: `RC-${hex6(a.quote_id)}`,
      payment: { status: 'simulated_paid', total_ars: 0 },
    });
    expect(res.confirmation_code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(res.new_itinerary.map((l: any) => l.flight_number)).toEqual(['AR1880']);
    expect(res.per_passenger).toEqual([
      { passenger_id: 'P1', checkin_cancelled: false, action_required: null },
      { passenger_id: 'P2', checkin_cancelled: true, action_required: 'redo_checkin' },
    ]);
    expect(res.ancillaries.map((x: any) => `${x.passenger_id}:${x.type}:${x.outcome}`)).toEqual(['P1:extra_bag:transfers', 'P2:extra_bag:transfers', 'P2:seat_selection:not_transferred']);
    expect(res.pending).toEqual(['redo_checkin:P2', 'reselect_seat:P2']);

    const after = await app.lookup('Romero', 'RMR4TX');
    expect(after.segments.map((s: any) => s.flight_number)).toEqual(['AR1880']);
    expect(after.passengers.map((p: any) => p.checked_in)).toEqual([false, false]);
    expect(after.ancillaries.map((x: any) => `${x.passenger_id}:${x.type}`)).toEqual(['P1:extra_bag', 'P2:extra_bag']);
    expect(after.ancillaries.every((x: any) => x.segments.join() === 'AR1880')).toBe(true);
    expect(after.disruption.change_type_hint).toBe('voluntary');
  });

  it('moves seat inventory: new flight decremented by the party, replaced flight released', async () => {
    const { app, a } = await demo();
    await app.rebook(a.quote_id, 0);
    expect((await app.deps.repos.flights.get('AR1880', '2026-11-13'))?.seats).toBe(0);
    expect((await app.deps.repos.flights.get('AR1692', '2026-11-12'))?.seats).toBe(14);
  });

  it('CUJ-05: a failure mid-transaction leaves check-in, itinerary, seats and quote untouched', async () => {
    const { app, a } = await demo();
    vi.spyOn(app.deps.repos.rebookings, 'save').mockRejectedValueOnce(new Error('boom'));
    await expect(createRebooking(app.deps, { quote_id: a.quote_id, confirmed: true, confirmed_total_ars: 0, idempotency_key: 'k' })).rejects.toThrow('boom');
    const booking = await app.lookup('Romero', 'RMR4TX');
    expect(booking.passengers[1].checked_in).toBe(true);
    expect(booking.segments.map((s: any) => s.flight_number)).toEqual(['AR1561', 'AR1692']);
    expect((await app.deps.repos.flights.get('AR1880', '2026-11-13'))?.seats).toBe(2);
    expect((await app.deps.repos.quotes.get(a.quote_id))?.status).toBe('open');
    expect(app.deps.state.idempotency.size).toBe(0);
  });
});

describe('CUJ-02 two-phase confirmation', () => {
  it('confirmed=false or missing is CONFIRMATION_REQUIRED and writes nothing', async () => {
    const { app, a } = await demo();
    expect((await app.rebook(a.quote_id, 0, undefined, false)).error_code).toBe('CONFIRMATION_REQUIRED');
    expect((await app.post('/rebookings', { quote_id: a.quote_id, confirmed_total_ars: 0, idempotency_key: 'k' })).error_code).toBe('CONFIRMATION_REQUIRED');
    expect((await app.post('/rebookings', { quote_id: a.quote_id, confirmed: 'true', idempotency_key: 'k' })).error_code).toBe('CONFIRMATION_REQUIRED');
    expect(app.deps.state.rebookings.size).toBe(0);
    expect((await app.deps.repos.quotes.get(a.quote_id))?.status).toBe('open');
  });

  it('unknown quote is QUOTE_NOT_FOUND', async () => {
    expect((await makeApp().rebook('Q-00000000', 0)).error_code).toBe('QUOTE_NOT_FOUND');
  });

  it('an expired quote (15 min TTL on the wall clock) is QUOTE_EXPIRED', async () => {
    const { app, a } = await demo();
    app.clock.advanceMin(14);
    expect((await app.rebook(a.quote_id, 0, 'rebook-x')).status).toBe('ok');
    const second = await demo();
    second.app.clock.advanceMin(16);
    const res = await second.app.rebook(second.a.quote_id, 0);
    expect(res).toMatchObject({ error_code: 'QUOTE_EXPIRED', retryable: false });
    expect((await second.app.deps.repos.quotes.get(second.a.quote_id))?.status).toBe('open');
  });

  it('QUOTE_STALE when seats ran out after quoting', async () => {
    const { app, a } = await demo();
    const flight = (await app.deps.repos.flights.get('AR1880', '2026-11-13'))!;
    await app.deps.repos.flights.save({ ...flight, seats: 1 });
    expect((await app.rebook(a.quote_id, 0)).error_code).toBe('QUOTE_STALE');
    expect((await app.deps.repos.bookings.findByPnr('RMR4TX'))?.version).toBe(1);
  });

  it('QUOTE_STALE when the booking changed since quoting (another quote executed first)', async () => {
    const { app, a, b } = await demo();
    expect((await app.rebook(a.quote_id, 0)).status).toBe('ok');
    expect((await app.rebook(b.quote_id, 0)).error_code).toBe('QUOTE_STALE');
  });
});

describe('CUJ-03 idempotency (DP4N8S)', () => {
  async function dup() {
    const app = makeApp();
    const opt = (await app.options('DP4N8S', { deadline: 'tomorrow' })).options[0];
    return { app, quote: opt.quote_id as string };
  }

  it('same key + same payload returns the stored response with already_applied', async () => {
    const { app, quote } = await dup();
    const first = await app.rebook(quote, 0);
    const second = await app.rebook(quote, 0);
    expect(first.already_applied).toBeUndefined();
    expect(second).toMatchObject({ already_applied: true, confirmation_code: first.confirmation_code, receipt_id: first.receipt_id, rebooking_id: first.rebooking_id });
    expect(app.deps.state.rebookings.size).toBe(1);
    expect((await app.deps.repos.flights.get('AR1702', '2026-11-12'))?.seats).toBe(8);
  });

  it('a different key for an already-executed quote returns the stored result matched by quote_id', async () => {
    const { app, quote } = await dup();
    const first = await app.rebook(quote, 0);
    const second = await app.rebook(quote, 0, 'another-key');
    expect(second).toMatchObject({ already_applied: true, matched_by: 'quote_id', confirmation_code: first.confirmation_code });
    expect(app.deps.state.rebookings.size).toBe(1);
  });

  it('same key + different payload is IDEMPOTENCY_KEY_REUSED', async () => {
    const { app, quote } = await dup();
    await app.rebook(quote, 0);
    expect((await app.rebook(quote, 5, `rebook-${quote}`)).error_code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('missing idempotency key is MISSING_IDEMPOTENCY_KEY', async () => {
    const { app, quote } = await dup();
    expect((await app.post('/rebookings', { quote_id: quote, confirmed: true, confirmed_total_ars: 0 })).error_code).toBe('MISSING_IDEMPOTENCY_KEY');
  });

  it('two concurrent identical requests execute once', async () => {
    const { app, quote } = await dup();
    const [x, y] = await Promise.all([app.rebook(quote, 0), app.rebook(quote, 0)]);
    expect([x, y].filter((r) => r.already_applied).length).toBe(1);
    expect(app.deps.state.rebookings.size).toBe(1);
    expect((await app.deps.repos.flights.get('AR1702', '2026-11-12'))?.seats).toBe(8);
  });

  it('receipt_id is deterministic', async () => {
    const one = await dup();
    const two = await dup();
    expect((await one.app.rebook(one.quote, 0)).receipt_id).toBe((await two.app.rebook(two.quote, 0)).receipt_id);
  });
});

describe('CUJ-25 voluntary payment step (NV8C5R)', () => {
  async function voluntary(config = {}) {
    const app = makeApp({ config });
    const opt = (await app.options('NV8C5R', { target_date: '2026-11-15' })).options[0];
    return { app, quote: opt.quote_id as string };
  }

  it('TOTAL_MISMATCH when the confirmed amount differs from the quoted total; no side effects', async () => {
    const { app, quote } = await voluntary();
    const res = await app.rebook(quote, 25000);
    expect(res).toMatchObject({ error_code: 'TOTAL_MISMATCH', details: { quoted_total_ars: 45000 } });
    expect(app.deps.state.rebookings.size).toBe(0);
    expect((await app.rebook(quote, 0, 'rebook-zero')).error_code).toBe('TOTAL_MISMATCH');
  });

  it('executes with the simulated payment and a replay-stable receipt', async () => {
    const { app, quote } = await voluntary();
    const res = await app.rebook(quote, 45000);
    expect(res).toMatchObject({ status: 'ok', payment: { status: 'simulated_paid', total_ars: 45000, breakdown: { fee_ars: 25000, fare_difference_ars: 10000, ancillary_reissue_ars: 10000 } } });
    expect((await app.rebook(quote, 45000)).receipt_id).toBe(res.receipt_id);
    expect(res.new_itinerary.map((l: any) => l.flight_number)).toEqual(['AR1852']);
  });

  it('VOLUNTARY_CHANGES_DISABLED when the flag is switched off after quoting', async () => {
    const { app, quote } = await voluntary();
    app.deps.config.voluntaryChangesEnabled = false;
    expect((await app.rebook(quote, 45000)).error_code).toBe('VOLUNTARY_CHANGES_DISABLED');
    expect(app.deps.state.rebookings.size).toBe(0);
  });
});

describe('CUJ-13 handoff cases', () => {
  const key = 'handoff-RMR4TX-1';

  it('assembles context after options were shown; case_id is deterministic and idempotent', async () => {
    const { app } = await demo();
    const res = await app.post('/handoff-cases', { reason: 'user_request', summary: 'Wants a person', pnr: 'rmr4tx', idempotency_key: key });
    expect(res).toMatchObject({ status: 'ok', case_id: `HC-${hex6(key)}` });
    const stored = app.deps.state.handoffs.get(res.case_id)!;
    expect(stored.pnr).toBe('RMR4TX');
    expect(stored.context).toMatchObject({ reason_codes: ['user_request'], booking_snapshot: { pnr: 'RMR4TX' } });
    expect((stored.context.quotes as unknown[]).length).toBe(2);
    const again = await app.post('/handoff-cases', { reason: 'user_request', summary: 'Wants a person', pnr: 'RMR4TX', idempotency_key: key });
    expect(again).toMatchObject({ case_id: res.case_id, already_applied: true });
    expect(app.deps.state.handoffs.size).toBe(1);
  });

  it('works without a PNR, requires a key, and rejects a reused key with another payload', async () => {
    const app = makeApp();
    const res = await app.post('/handoff-cases', { reason: 'user_request', summary: 'Hi', idempotency_key: 'handoff-NOPNR-1' });
    expect(res.status).toBe('ok');
    expect(app.deps.state.handoffs.get(res.case_id)!.pnr).toBeNull();
    expect((await app.post('/handoff-cases', { reason: 'x', summary: 'y' })).error_code).toBe('MISSING_IDEMPOTENCY_KEY');
    expect((await app.post('/handoff-cases', { reason: 'other', summary: 'Hi', idempotency_key: 'handoff-NOPNR-1' })).error_code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect((await app.call('POST', '/handoff-cases', { body: { summary: 'only' } })).status).toBe(400);
  });
});
