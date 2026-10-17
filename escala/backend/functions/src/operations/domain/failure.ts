import type { Delayer } from '../../shared/clock';
import type { Config } from '../../shared/config';
import { err, ok, type Result } from '../../shared/result';
import type { FailureMode } from '../../shared/types';

/** Simulated failure modes live in data (`failure_mode`); randomness never occurs at runtime. */
export async function simulateFailure(
  mode: FailureMode | undefined,
  endpoint: string,
  delay: Delayer,
  config: Config,
): Promise<Result<void>> {
  if (!mode || !mode.endpoints.includes(endpoint)) return ok(undefined);
  switch (mode.mode) {
    case 'always_timeout':
      return err('UPSTREAM_TIMEOUT', { endpoint });
    case 'always_5xx':
      return err('UPSTREAM_ERROR', { endpoint });
    case 'slow':
      await delay.sleep(config.slowModeMs);
      return ok(undefined);
  }
}
