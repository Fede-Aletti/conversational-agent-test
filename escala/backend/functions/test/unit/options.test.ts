import { describe, expect, it } from 'vitest';
import { buildDataset } from '../../seed/dataset';
import { ANCILLARY_RULES } from '../../src/ancillaries/domain/transfer-rules';
import { resolveDeadline } from '../../src/rebooking/domain/dates';
import { makeApp } from './helpers';

describe('CUJ-20 simulated today and deadline resolution', () => {
  it('resolves today, tomorrow and ISO dates; rejects past dates', () => {
    expect(resolveDeadline('today', '2026-11-12')).toEqual({ ok: true, value: '2026-11-12' });
    expect(resolveDeadline('tomorrow', '2026-11-12')).toEqual({ ok: true, value: '2026-11-13' });
    expect(resolveDeadline('2026-11-20', '2026-11-12')).toEqual({ ok: true, value: '2026-11-20' });
    expect(resolveDeadline('2026-11-11', '2026-11-12')).toMatchObject({ ok: false, error: { code: 'INVALID_DATE' } });
    expect(resolveDeadline('mañana', '2026-11-12')).toMatchObject({ ok: false });
  });
  it('the endpoint reports INVALID_DATE for a past target date', async () => {
    expect((await makeApp().options('NV8C5R', { target_date: '2026-11-01' })).error_code).toBe('INVALID_DATE');
  });
});

describe('CUJ-01/07 demo RMR4TX, deadline tomorrow', () => {
  it('ranks A (direct), B (via AEP) and C (not executable: 1 seat for 2)', async () => {
    const res = await makeApp().options('RMR4TX', { deadline: 'tomorrow' });
    expect(res).toMatchObject({ status: 'ok', change_type: 'involuntary', disruption_type: 'cancellation', resolved_deadline_date: '2026-11-13', party_size: 2 });
    expect(res.options.map((o: any) => o.legs.map((l: any) => l.flight_number))).toEqual([['AR1880'], ['AR1565', 'AR1694'], ['AR1563', 'AR1696']]);
    const [a, b, c] = res.options;
    expect([a.option_id, b.option_id, c.option_id]).toEqual(['A', 'B', 'C']);
    expect(a).toMatchObject({ arrival: '2026-11-13 11:40', fits_party: true, executable: true, seats_available: 2, arrives_by_deadline: true });
    expect(b).toMatchObject({ arrival: '2026-11-13 12:05', executable: true });
    expect(c).toMatchObject({ arrival: '2026-11-12 17:55', fits_party: false, executable: false, not_executable_reason: 'INSUFFICIENT_SEATS', seats_available: 1 });
    expect(c.quote_id).toBeUndefined();
    expect(a.quote_id).toMatch(/^Q-/);
    expect(a.payment).toEqual({ simulated: true, total_ars: 0, breakdown: { fee_ars: 0, fare_difference_ars: 0, ancillary_reissue_ars: 0 } });
  });

  it('CUJ-05/06: P1 keeps check-in, P2 must cancel it; bags transfer, seats do not', async () => {
    const [a] = (await makeApp().options('RMR4TX', { deadline: 'tomorrow' })).options;
    const [p1, p2] = a.per_passenger;
    expect(p1).toMatchObject({ passenger_id: 'P1', requires_checkin_cancellation: false });
    expect(p1.ancillaries.map((x: any) => [x.type, x.outcome])).toEqual([['extra_bag', 'transfers']]);
    expect(p2).toMatchObject({ passenger_id: 'P2', requires_checkin_cancellation: true });
    expect(p2.ancillaries.map((x: any) => [x.type, x.outcome])).toEqual([['extra_bag', 'transfers'], ['seat_selection', 'not_transferred']]);
  });

  it('a new options call keeps quote ids stable for the same booking state', async () => {
    const app = makeApp();
    const first = await app.options('RMR4TX', { deadline: 'tomorrow' });
    const second = await app.options('RMR4TX', { deadline: 'tomorrow' });
    expect(second.options.map((o: any) => o.quote_id)).toEqual(first.options.map((o: any) => o.quote_id));
  });

  it('rejects a destination change before searching (CUJ-11)', async () => {
    const res = await makeApp().options('RMR4TX', { destination: 'USH' });
    expect(res).toMatchObject({ error_code: 'DESTINATION_CHANGE_NOT_SUPPORTED', retryable: false });
    expect((await makeApp().options('RMR4TX', { destination: 'brc', deadline: 'tomorrow' })).status).toBe('ok');
  });

  it('unknown booking is BOOKING_NOT_FOUND', async () => {
    expect((await makeApp().options('QWE4RT', {})).error_code).toBe('BOOKING_NOT_FOUND');
  });
});

describe('CUJ-08 no alternatives (TB6H1Y)', () => {
  it('has no options by the deadline, lists the later flight with a quote, and reports next availability', async () => {
    const res = await makeApp().options('TB6H1Y', { deadline: 'tomorrow' });
    expect(res.options).toEqual([]);
    expect(res.options_after_deadline).toHaveLength(1);
    expect(res.options_after_deadline[0]).toMatchObject({ arrives_by_deadline: false, executable: true, legs: [expect.objectContaining({ flight_number: 'AR1306', date: '2026-11-15' })] });
    expect(res.options_after_deadline[0].quote_id).toMatch(/^Q-/);
    expect(res.next_availability).toMatchObject({ date: '2026-11-15', flights: ['AR1306'] });
  });
});

describe('CUJ-02/03 DP4N8S single easy option', () => {
  it('offers AR1702 for free and lists AR1710 after the deadline', async () => {
    const res = await makeApp().options('DP4N8S', { deadline: 'tomorrow' });
    expect(res.options).toHaveLength(1);
    expect(res.options[0]).toMatchObject({ executable: true, payment: expect.objectContaining({ total_ars: 0 }) });
    expect(res.options[0].legs[0].flight_number).toBe('AR1702');
    expect(res.options_after_deadline.map((o: any) => o.legs[0].flight_number)).toEqual(['AR1710']);
  });
});

describe('CUJ-12/25/10 voluntary changes and policy', () => {
  it('NV8C5R: fee 25,000 + fare difference 10,000 + bag re-issue 10,000 = 45,000', async () => {
    const res = await makeApp().options('NV8C5R', { target_date: '2026-11-15' });
    expect(res).toMatchObject({ change_type: 'voluntary', disruption_type: 'none', resolved_deadline_date: '2026-11-15' });
    expect(res.options).toHaveLength(1);
    expect(res.options[0]).toMatchObject({ executable: true, payment: { simulated: true, total_ars: 45000, breakdown: { fee_ars: 25000, fare_difference_ars: 10000, ancillary_reissue_ars: 10000 } } });
    expect(res.options[0].per_passenger[0].ancillaries).toEqual([expect.objectContaining({ type: 'extra_bag', outcome: 'transfers_with_fee' })]);
    expect(res.options_after_deadline.every((o: any) => o.arrives_by_deadline === false)).toBe(true);
  });

  it('a voluntary booking with no target date needs no change', async () => {
    expect(await makeApp().options('NV8C5R', {})).toMatchObject({ status: 'ok', no_change_needed: true, options: [] });
  });

  it('flag voluntary_changes_enabled=false lists options as non-executable without quotes', async () => {
    const res = await makeApp({ config: { voluntaryChangesEnabled: false } }).options('NV8C5R', { target_date: '2026-11-15' });
    expect(res.options[0]).toMatchObject({ executable: false, not_executable_reason: 'VOLUNTARY_CHANGES_DISABLED' });
    expect(res.options[0].quote_id).toBeUndefined();
  });

  it('PB9K4Z (ECO_BASIC): POLICY_FARE_NOT_CHANGEABLE, no options, no quotes; fabricated quote is rejected', async () => {
    const app = makeApp();
    const res = await app.options('PB9K4Z', { target_date: '2026-11-17' });
    expect(res).toMatchObject({ blocking_reasons: ['POLICY_FARE_NOT_CHANGEABLE'], options: [], options_after_deadline: [] });
    expect(app.deps.state.quotes.size).toBe(0);
    expect((await app.rebook('Q-FABRICAT', 0)).error_code).toBe('QUOTE_NOT_FOUND');
  });

  it('PL3T5R (ECO_PLUS, 2 pax): fee 45,000 per passenger', async () => {
    const res = await makeApp().options('PL3T5R', { target_date: await firstDate('AR9051') });
    expect(res.options[0].payment).toMatchObject({ total_ars: 90000, breakdown: { fee_ars: 90000, fare_difference_ars: 0, ancillary_reissue_ars: 0 } });
  });

  it('SQ9R3F: sport equipment re-issue fee in the total, priority boarding not transferred', async () => {
    const res = await makeApp().options('SQ9R3F', { target_date: await firstDate('AR9041') });
    expect(res.options[0].payment.breakdown).toEqual({ fee_ars: 25000, fare_difference_ars: 10000, ancillary_reissue_ars: 15000 });
    const outcomes = Object.fromEntries(res.options[0].per_passenger[0].ancillaries.map((a: any) => [a.type, a.outcome]));
    expect(outcomes).toEqual({ sport_equipment: 'transfers_with_fee', priority_boarding: 'not_transferred' });
  });
});

const firstDate = async (flightNumber: string): Promise<string> =>
  (buildDataset().flights.find((f) => f.flight_number === flightNumber) as { date: string }).date;

describe('CUJ-22 special passengers and ancillary matrix', () => {
  it('KT5M2V: the infant is excluded from seats and ancillaries', async () => {
    const res = await makeApp().options('KT5M2V', {});
    expect(res.party_size).toBe(1);
    const infant = res.options[0].per_passenger.find((p: any) => p.passenger_id === 'P2');
    expect(infant.ancillaries).toEqual([]);
    expect(res.options[0]).toMatchObject({ executable: true });
  });

  it('HN7D4C: the minor counts for seats; the earliest option has 2 of 3 seats and is not executable', async () => {
    const res = await makeApp().options('HN7D4C', {});
    expect(res.party_size).toBe(3);
    const [first, second] = res.options;
    expect(first).toMatchObject({ executable: true, seats_available: 6 });
    expect(second).toMatchObject({ executable: false, fits_party: false, seats_available: 2, not_executable_reason: 'INSUFFICIENT_SEATS' });
  });

  it('PS8N4W: partial seats ranking puts the 3-seat option first', async () => {
    const res = await makeApp().options('PS8N4W', {});
    expect(res.options.map((o: any) => [o.seats_available, o.executable])).toEqual([[3, true], [2, false]]);
  });

  it('PW6J8X: pet_in_cabin makes the option non-executable (ANCILLARY_NEEDS_REVIEW, no quote)', async () => {
    const res = await makeApp().options('PW6J8X', {});
    expect(res.options[0]).toMatchObject({ executable: false, not_executable_reason: 'ANCILLARY_NEEDS_REVIEW' });
    expect(res.options[0].quote_id).toBeUndefined();
    expect(res.options[0].per_passenger[0].ancillaries[0].outcome).toBe('needs_review');
  });

  it('DL4B6N (90 min delay): informational, no rebooking needed', async () => {
    const app = makeApp();
    expect((await app.lookup('Luque', 'DL4B6N')).disruption.disruption_type).toBe('delay_minor');
    expect(await app.options('DL4B6N', {})).toMatchObject({ change_type: 'voluntary', no_change_needed: true });
  });

  it.each([
    ['DL8H2P', 'delay'],
    ['SC3K7T', 'schedule_change'],
    ['MC5W9G', 'missed_connection'],
    ['ED2V6Z', 'equipment_downgrade'],
    ['XN7B2K', 'cancellation'],
  ])('%s is involuntary (%s) and has an executable option', async (pnr, type) => {
    const res = await makeApp().options(pnr, {});
    expect(res).toMatchObject({ change_type: 'involuntary', disruption_type: type });
    expect(res.options.some((o: any) => o.executable)).toBe(true);
    expect(res.options.every((o: any) => o.payment.total_ars === 0)).toBe(true);
  });

  it('MC5W9G only replaces the missed second segment (search starts at COR)', async () => {
    const res = await makeApp().options('MC5W9G', {});
    expect(res.options[0].legs.map((l: any) => [l.origin, l.destination])).toEqual([['COR', 'BRC']]);
  });

  it('ED2V6Z: keep_current is offered alongside alternatives and the seat is not transferred', async () => {
    const res = await makeApp().options('ED2V6Z', {});
    expect(res.keep_current).toMatchObject({ seat_assignments_lost: true });
    expect(res.options[0].per_passenger[0].ancillaries[0]).toMatchObject({ type: 'seat_selection', outcome: 'not_transferred' });
  });
});

describe('CUJ-06 ancillary transfer rules', () => {
  it('matches the synthetic rules table', () => {
    const table = Object.fromEntries(Object.entries(ANCILLARY_RULES).map(([k, r]) => [k, [r.involuntary, r.voluntary, r.fee_ars]]));
    expect(table).toEqual({
      extra_bag: ['transfers', 'transfers_with_fee', 10000],
      seat_selection: ['not_transferred', 'not_transferred', 0],
      priority_boarding: ['transfers', 'not_transferred', 0],
      pet_in_cabin: ['needs_review', 'needs_review', 0],
      sport_equipment: ['transfers', 'transfers_with_fee', 15000],
    });
  });
});
