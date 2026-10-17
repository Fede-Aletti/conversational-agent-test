import type { Firestore } from 'firebase-admin/firestore';
import type { ScenarioEntry } from '../../../shared/types';
import type { ScenarioRepository } from '../../ports';

export class FirestoreScenarioRepository implements ScenarioRepository {
  constructor(private readonly db: Firestore) {}
  async list() {
    const snap = await this.db.collection('scenarios').orderBy('order').get();
    return snap.docs.map((d) => {
      const { order: _o, ...entry } = d.data() as ScenarioEntry & { order: number };
      return entry as ScenarioEntry;
    });
  }
}
