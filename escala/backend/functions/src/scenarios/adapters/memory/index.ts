import type { ScenarioEntry } from '../../../shared/types';
import type { ScenarioRepository } from '../../ports';

export class MemoryScenarioRepository implements ScenarioRepository {
  constructor(private readonly items: ScenarioEntry[]) {}
  async list() {
    return this.items.map((s) => structuredClone(s));
  }
}
