import type { HandoffCase, HandoffRepository } from '../../ports';

export class MemoryHandoffRepository implements HandoffRepository {
  constructor(private readonly state: { handoffs: Map<string, HandoffCase> }) {}
  async get(id: string) {
    const c = this.state.handoffs.get(id);
    return c ? structuredClone(c) : null;
  }
  async save(c: HandoffCase) {
    this.state.handoffs.set(c.case_id, structuredClone(c));
  }
}
