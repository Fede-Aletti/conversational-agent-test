export interface Config {
  voluntaryChangesEnabled: boolean;
  enableScenariosEndpoint: boolean;
  quoteTtlMin: number;
  delayInvoluntaryMin: number;
  scheduleChangeInvoluntaryMin: number;
  minConnectionMin: number;
  /** Longest layover considered a connection when searching alternatives (synthetic). */
  maxConnectionMin: number;
  /** Days after the deadline in which later alternatives are still listed. */
  afterDeadlineWindowDays: number;
  slowModeMs: number;
  maxOptions: number;
  maxLateOptions: number;
}

export const DEFAULT_CONFIG: Config = {
  voluntaryChangesEnabled: true,
  enableScenariosEndpoint: false,
  quoteTtlMin: 15,
  delayInvoluntaryMin: 120,
  scheduleChangeInvoluntaryMin: 90,
  minConnectionMin: 60,
  maxConnectionMin: 360,
  afterDeadlineWindowDays: 7,
  slowModeMs: 8000,
  maxOptions: 4,
  maxLateOptions: 2,
};

export function configFromEnv(env: Record<string, string | undefined>): Config {
  return {
    ...DEFAULT_CONFIG,
    voluntaryChangesEnabled: (env.VOLUNTARY_CHANGES_ENABLED ?? 'true').toLowerCase() !== 'false',
    enableScenariosEndpoint: (env.ENABLE_SCENARIOS_ENDPOINT ?? 'false').toLowerCase() === 'true',
  };
}
