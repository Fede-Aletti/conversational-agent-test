import type { Firestore } from 'firebase-admin/firestore';
import type { PolicySnippet } from '../../../shared/types';
import type { FaqHit, FaqSearchPort, PolicySnippetRepository } from '../../ports';

export class FirestoreSnippetRepository implements PolicySnippetRepository {
  constructor(private readonly db: Firestore) {}
  async list(): Promise<PolicySnippet[]> {
    const snap = await this.db.collection('policy_snippets').get();
    return snap.docs.map((d) => d.data() as PolicySnippet);
  }
}

type TokenProvider = () => Promise<string>;
type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<{
  ok: boolean;
  json(): Promise<any>;
}>;

/** Vertex AI Search (Discovery Engine) adapter. Any failure or timeout yields null so the use case falls back to curated snippets. */
export class VertexFaqSearch implements FaqSearchPort {
  constructor(
    private readonly servingConfig: string, // projects/.../dataStores/<id>/servingConfigs/default_search
    private readonly getToken: TokenProvider,
    private readonly fetchFn: FetchLike = fetch as unknown as FetchLike,
    private readonly timeoutMs = 4000,
  ) {}

  async search(query: string): Promise<FaqHit[] | null> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await this.fetchFn(`https://discoveryengine.googleapis.com/v1/${this.servingConfig}:search`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${await this.getToken()}` },
        body: JSON.stringify({ query, pageSize: 3, contentSearchSpec: { snippetSpec: { returnSnippet: true } } }),
        signal: ctrl.signal,
      });
      if (!res.ok) return null;
      const body = await res.json();
      const hits: FaqHit[] = (body.results ?? []).map((r: any) => {
        const data = r.document?.derivedStructData ?? {};
        return { title: data.title ?? '', source_url: data.link ?? '', text: data.snippets?.[0]?.snippet ?? '' };
      });
      return hits.filter((h) => h.text && h.source_url);
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}
