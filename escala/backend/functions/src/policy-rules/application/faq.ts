import { ok, type Result } from '../../shared/result';
import type { Deps } from '../../shared/uow';
import type { PolicySnippet } from '../../shared/types';

const norm = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

export function scoreSnippet(snippet: PolicySnippet, query: string): number {
  const words = norm(query)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3);
  const hay = norm(`${snippet.title} ${snippet.keywords.join(' ')}`);
  return words.reduce((s, w) => s + (hay.includes(w) ? 1 : 0), 0);
}

/**
 * Open-ended FAQ. Vertex AI Search when configured and answering; otherwise curated snippets.
 * Decision-grade rules (fees, change permissions) are never answered from here.
 */
export async function searchFaq(deps: Deps, query: string): Promise<Result<Record<string, unknown>>> {
  if (deps.faq) {
    const hits = await deps.faq.search(query).catch(() => null);
    if (hits && hits.length) {
      return ok({ status: 'ok', answers: hits.slice(0, 3), source: 'vertex_ai_search', as_of: 'live index', verified: true });
    }
  }
  const snippets = await deps.snippets.list();
  const ranked = snippets
    .map((s) => ({ s, score: scoreSnippet(s, query) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.s.topic.localeCompare(b.s.topic))
    .slice(0, 3);
  return ok({
    status: 'ok',
    answers: ranked.map((x) => ({ text: x.s.text, title: x.s.title, source_url: x.s.source_url })),
    source: 'curated_fallback',
    as_of: 'needs verification',
    verified: false,
  });
}
