import { describe, expect, it } from 'vitest';
import { VertexFaqSearch } from '../../src/policy-rules/adapters/firestore';
import { FakeFaqSearch } from '../../src/policy-rules/adapters/memory';
import { makeApp } from './helpers';

describe('CUJ-15 FAQ with fake Vertex adapter and curated fallback', () => {
  const hit = { text: 'Respuesta indexada', title: 'Equipaje', source_url: 'https://www.aerolineas.com.ar/equipaje' };

  it('uses Vertex results when available', async () => {
    const res = await makeApp({ faq: new FakeFaqSearch([hit]) }).get('/policies/faq', { q: 'equipaje' });
    expect(res).toMatchObject({ source: 'vertex_ai_search', answers: [hit] });
  });

  it.each([
    ['empty result', new FakeFaqSearch([])],
    ['timeout/failure', new FakeFaqSearch('timeout')],
    ['unset data store', null],
  ])('falls back to curated snippets on %s', async (_name, faq) => {
    const res = await makeApp({ faq }).get('/policies/faq', { q: 'equipaje adicional' });
    expect(res).toMatchObject({ status: 'ok', source: 'curated_fallback', verified: false, as_of: 'needs verification' });
    expect(res.answers.length).toBeGreaterThan(0);
    for (const a of res.answers) expect(a.source_url).toMatch(/^https:\/\/www\.aerolineas\.com\.ar\/PLACEHOLDER\//);
  });

  it('returns no answers (never invents) when nothing matches; requires q', async () => {
    const app = makeApp();
    expect((await app.get('/policies/faq', { q: 'xyzzy' })).answers).toEqual([]);
    expect((await app.call('GET', '/policies/faq')).status).toBe(400);
  });

  it('VertexFaqSearch maps results and returns null on HTTP failure or abort', async () => {
    const body = { results: [{ document: { derivedStructData: { title: 'T', link: 'https://x', snippets: [{ snippet: 'S' }] } } }] };
    const okFetch = async () => ({ ok: true, json: async () => body });
    expect(await new VertexFaqSearch('projects/p/x', async () => 't', okFetch as never).search('q')).toEqual([{ title: 'T', source_url: 'https://x', text: 'S' }]);
    const badFetch = async () => ({ ok: false, json: async () => ({}) });
    expect(await new VertexFaqSearch('projects/p/x', async () => 't', badFetch as never).search('q')).toBeNull();
    const throwing = async () => {
      throw new Error('network');
    };
    expect(await new VertexFaqSearch('projects/p/x', async () => 't', throwing as never).search('q')).toBeNull();
  });
});

describe('CUJ-23 GET /scenarios', () => {
  it('is 404 when ENABLE_SCENARIOS_ENDPOINT is off', async () => {
    expect((await makeApp().call('GET', '/scenarios')).status).toBe(404);
  });

  it('lists fixtures first, then generated, with the required fields, and filters', async () => {
    const app = makeApp({ config: { enableScenariosEndpoint: true } });
    const all = await app.get('/scenarios');
    expect(all.total).toBe(all.scenarios.length);
    expect(all.scenarios.slice(0, 22).every((s: any) => s.type === 'fixture')).toBe(true);
    expect(all.scenarios.slice(22).every((s: any) => s.type === 'generated')).toBe(true);
    for (const s of all.scenarios) {
      expect(s).toEqual(expect.objectContaining({ scenario_id: expect.any(String), type: expect.any(String), pnr: expect.any(String), surname: expect.any(String), tags: expect.any(Array), exercises: expect.any(String), expected_outcome: expect.any(Object) }));
    }
    expect((await app.get('/scenarios', { type: 'fixture' })).total).toBe(22);
    expect((await app.get('/scenarios', { tag: 'disruption:cancel', limit: '3' })).scenarios).toHaveLength(3);
    expect((await app.call('GET', '/scenarios', { query: { limit: '0' } })).status).toBe(400);
  });
});
