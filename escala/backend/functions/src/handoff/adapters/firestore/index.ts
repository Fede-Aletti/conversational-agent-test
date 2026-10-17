import { FsCtx } from '../../../shared/firestore-ctx';
import type { HandoffCase, HandoffRepository } from '../../ports';

export class FirestoreHandoffRepository implements HandoffRepository {
  constructor(private readonly ctx: FsCtx) {}
  get(id: string) {
    return this.ctx.get<HandoffCase>('handoff_cases', id);
  }
  async save(c: HandoffCase) {
    await this.ctx.set('handoff_cases', c.case_id, c);
  }
}
