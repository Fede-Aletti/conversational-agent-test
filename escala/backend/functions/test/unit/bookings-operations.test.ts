import { describe, expect, it } from 'vitest';
import { buildDataset } from '../../seed/dataset';
import { computeFacts } from '../../src/operations/domain/impact';
import { classifyDisruption } from '../../src/policy-rules/domain/rules';
import { DEFAULT_CONFIG } from '../../src/shared/config';
import type { Flight } from '../../src/shared/types';
import { makeApp } from './helpers';

const flight = (extra: Partial<Flight>): Flight => ({
  flight_number: 'AR0001', date: '2026-12-01', origin: 'AEP', destination: 'COR', dep: '08:00', arr: '09:10', status: 'scheduled', seats: 5, price_ars: 1, ...extra,
});

describe('CUJ-04 identification and normalization', () => {
  it('QWE4RT is BOOKING_NOT_FOUND inside an HTTP 200 envelope with agent_action', async () => {
    const app = makeApp();
    const res = await app.call('GET', '/bookings/lookup', { query: { last_name: 'Nadie', pnr: 'QWE4RT' } });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'error', error_code: 'BOOKING_NOT_FOUND', retryable: false });
    expect((res.body as any).agent_action).toMatch(/surname|offer/i);
  });

  it('a wrong PNR fails, then surname + date + route finds LQ3W9D (fallback)', async () => {
    const app = makeApp();
    expect((await app.lookup('Ferreyra', 'LQ3W9B')).error_code).toBe('BOOKING_NOT_FOUND');
    const found = await app.get('/bookings/lookup', { last_name: 'Ferreyra', flight_date: '2026-11-14', origin: 'AEP', destination: 'MDZ' });
    expect(found).toMatchObject({ status: 'ok', pnr: 'LQ3W9D' });
    const wrongDate = await app.get('/bookings/lookup', { last_name: 'Ferreyra', flight_date: '2026-11-15', origin: 'AEP', destination: 'MDZ' });
    expect(wrongDate.error_code).toBe('BOOKING_NOT_FOUND');
  });

  it('normalizes case, spaces, hyphens and diacritics; either surname identifies RMR4TX', async () => {
    const app = makeApp();
    expect((await app.lookup('ferreyra', 'lq3-w9d')).pnr).toBe('LQ3W9D');
    expect((await app.lookup('GIMENEZ', ' pb9k4z ')).pnr).toBe('PB9K4Z');
    expect((await app.lookup('benitez', 'R M R 4 T X')).pnr).toBe('RMR4TX');
    expect((await app.lookup('Romero', 'RMR4TX')).pnr).toBe('RMR4TX');
    expect((await app.lookup('Romero', 'PB9K4Z')).error_code).toBe('BOOKING_NOT_FOUND');
  });

  it('returns a trimmed booking with passengers, check-in, fares, segments, ancillaries and disruption (CUJ-14)', async () => {
    const b = await makeApp().lookup('Romero', 'RMR4TX');
    expect(b.passengers).toEqual([
      expect.objectContaining({ passenger_id: 'P1', checked_in: false, fare_family: 'ECO_FLEX' }),
      expect.objectContaining({ passenger_id: 'P2', checked_in: true }),
    ]);
    expect(b.segments.map((s: any) => [s.flight_number, s.flight_status])).toEqual([['AR1561', 'cancelled'], ['AR1692', 'on_time']]);
    expect(b.connection_status).toBe('broken');
    expect(b.ancillaries.filter((a: any) => a.passenger_id === 'P2').map((a: any) => a.type)).toEqual(['extra_bag', 'seat_selection']);
    expect(b.disruption).toEqual({ change_type_hint: 'involuntary', disruption_type: 'cancellation', affected_segments: ['AR1561', 'AR1692'] });
    expect(b).not.toHaveProperty('failure_mode');
  });

  it('rejects malformed requests with HTTP 400 (not the envelope status)', async () => {
    const app = makeApp();
    expect((await app.call('GET', '/bookings/lookup', { query: { pnr: 'RMR4TX' } })).status).toBe(400);
    expect((await app.call('GET', '/bookings/lookup', { query: { last_name: 'x', flight_date: 'nope', origin: 'A', destination: 'B' } })).status).toBe(400);
    expect((await app.call('GET', '/nope')).status).toBe(404);
    expect((await app.call('DELETE', '/rebookings')).status).toBe(405);
  });
});

describe('disruption classification (CUJ-12)', () => {
  const classify = (flights: Flight[]) => classifyDisruption(computeFacts(flights), DEFAULT_CONFIG);

  it('delay 119 is informational, 120 is involuntary', () => {
    expect(classify([flight({ delay_min: 119 })])).toMatchObject({ change_type: 'voluntary', disruption_type: 'delay_minor' });
    expect(classify([flight({ delay_min: 120 })])).toMatchObject({ change_type: 'involuntary', disruption_type: 'delay' });
  });
  it('schedule change 89 is informational, 90 is involuntary', () => {
    expect(classify([flight({ schedule_change_min: 89 })]).change_type).toBe('voluntary');
    expect(classify([flight({ schedule_change_min: 90 })])).toMatchObject({ change_type: 'involuntary', disruption_type: 'schedule_change' });
  });
  it('a delay below the threshold that breaks the 60 min connection is involuntary and impacts the next segment', () => {
    const first = flight({ arr: '07:30', dep: '06:00', delay_min: 100 });
    const second = flight({ flight_number: 'AR0002', origin: 'COR', destination: 'BRC', dep: '09:15', arr: '11:15' });
    expect(classify([first, second])).toMatchObject({ change_type: 'involuntary', disruption_type: 'missed_connection', impacted_from: 1, connection_status: 'broken' });
    expect(classify([{ ...first, delay_min: 45 }, second]).connection_status).toBe('intact');
  });
  it('cancellation and equipment downgrade are involuntary; no disruption is voluntary', () => {
    expect(classify([flight({ status: 'cancelled', seats: null })]).disruption_type).toBe('cancellation');
    expect(classify([flight({ equipment_downgrade: true })])).toMatchObject({ change_type: 'involuntary', disruption_type: 'equipment_downgrade' });
    expect(classify([flight({})])).toMatchObject({ change_type: 'voluntary', disruption_type: 'none', connection_status: 'not_applicable' });
  });
});

describe('getFlightStatus and failure modes (CUJ-09, CUJ-24)', () => {
  it('reports status, delay and cancellation', async () => {
    const app = makeApp();
    expect(await app.get('/flights/AR1561/status', { date: '2026-11-12' })).toMatchObject({ status: 'ok', flight_status: 'cancelled' });
    const ar9070 = buildDataset().flights.find((f) => f.flight_number === 'AR9070') as Flight;
    expect(await app.get('/flights/ar9070/status', { date: ar9070.date })).toMatchObject({ flight_status: 'delayed', delay_minutes: 180 });
    expect((await app.get('/flights/AR0000/status', { date: '2026-11-12' })).error_code).toBe('FLIGHT_NOT_FOUND');
  });

  it('AR1698 status is an UPSTREAM_TIMEOUT; SV2T7K options too; other endpoints keep working', async () => {
    const app = makeApp();
    expect(await app.get('/flights/AR1698/status', { date: '2026-11-12' })).toMatchObject({ status: 'error', error_code: 'UPSTREAM_TIMEOUT', retryable: true });
    expect(await app.options('SV2T7K', { deadline: 'tomorrow' })).toMatchObject({ error_code: 'UPSTREAM_TIMEOUT', retryable: true });
    expect((await app.lookup('Quiroga', 'SV2T7K')).status).toBe('ok');
    expect((await app.get('/policies/faq', { q: 'equipaje' })).status).toBe('ok');
  });

  it('UE4Q8H returns an UPSTREAM_ERROR envelope (200, retryable)', async () => {
    const res = await makeApp().call('POST', '/disruptions/UE4Q8H/options', { body: {} });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'error', error_code: 'UPSTREAM_ERROR', retryable: true });
  });

  it('SL6Y3M waits the slow-mode latency then succeeds', async () => {
    const app = makeApp();
    const res = await app.options('SL6Y3M', {});
    expect(res.status).toBe('ok');
    expect(app.delay.sleeps).toEqual([8000]);
  });
});
