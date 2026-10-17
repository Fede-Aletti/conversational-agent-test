import { ok, type Result } from '../../shared/result';
import type { Deps } from '../../shared/uow';

export async function listScenarios(deps: Deps, q: { type?: string; tag?: string; limit?: number }): Promise<Result<Record<string, unknown>>> {
  let items = await deps.scenarios.list(); // repositories return fixtures first, then generated
  if (q.type) items = items.filter((s) => s.type === q.type);
  if (q.tag) items = items.filter((s) => s.tags.includes(q.tag as string));
  const total = items.length;
  if (q.limit) items = items.slice(0, q.limit);
  return ok({ status: 'ok', total, scenarios: items });
}
