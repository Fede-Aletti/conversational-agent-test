import type { PolicySnippet } from '../../../shared/types';
import type { FaqHit, FaqSearchPort, PolicySnippetRepository } from '../../ports';

export class MemorySnippetRepository implements PolicySnippetRepository {
  constructor(private readonly items: PolicySnippet[]) {}
  async list(): Promise<PolicySnippet[]> {
    return this.items.map((x) => ({ ...x }));
  }
}

/** Test double for the Vertex adapter. */
export class FakeFaqSearch implements FaqSearchPort {
  constructor(private readonly behavior: FaqHit[] | 'timeout') {}
  async search(): Promise<FaqHit[] | null> {
    return this.behavior === 'timeout' ? null : this.behavior;
  }
}
