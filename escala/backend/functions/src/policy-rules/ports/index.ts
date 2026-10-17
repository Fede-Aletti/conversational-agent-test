import type { PolicySnippet } from '../../shared/types';

export interface PolicySnippetRepository {
  list(): Promise<PolicySnippet[]>;
}

export interface FaqHit {
  text: string;
  title: string;
  source_url: string;
}

/** Open-ended FAQ search (Vertex AI Search). Returns null on failure/timeout; [] when nothing matched. */
export interface FaqSearchPort {
  search(query: string): Promise<FaqHit[] | null>;
}
