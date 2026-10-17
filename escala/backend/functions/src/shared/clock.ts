export interface Clock {
  /** Fixed simulated "today" (YYYY-MM-DD). */
  simulatedToday(): string;
  /** Real wall clock in epoch ms; drives quote expiry only. */
  nowMs(): number;
}

export const SIMULATED_TODAY = '2026-11-12';

export const systemClock: Clock = {
  simulatedToday: () => SIMULATED_TODAY,
  nowMs: () => Date.now(),
};

/** Port used to simulate latency (slow failure mode). */
export interface Delayer {
  sleep(ms: number): Promise<void>;
}

export const realDelayer: Delayer = { sleep: (ms) => new Promise((r) => setTimeout(r, ms)) };
