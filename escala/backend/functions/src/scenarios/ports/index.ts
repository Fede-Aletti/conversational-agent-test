import type { ScenarioEntry } from '../../shared/types';

export interface ScenarioRepository {
  list(): Promise<ScenarioEntry[]>;
}
