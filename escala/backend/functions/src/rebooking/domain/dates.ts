import { err, ok, type Result } from '../../shared/result';
import { addDays, isIsoDate } from '../../shared/time';

/** Resolves "today" | "tomorrow" | ISO date against the simulated today. The LLM never computes dates. */
export function resolveDeadline(value: string, today: string): Result<string> {
  if (value === 'today') return ok(today);
  if (value === 'tomorrow') return ok(addDays(today, 1));
  if (!isIsoDate(value) || value < today) return err('INVALID_DATE', { value });
  return ok(value);
}
