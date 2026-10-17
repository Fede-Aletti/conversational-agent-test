import type { Config } from '../../shared/config';
import type { ChangeType, FareFamily, Passenger } from '../../shared/types';
import type { SegmentFacts } from '../../operations/domain/impact';
import type { PaymentBreakdown } from '../../rebooking/domain/types';

export type DisruptionType =
  | 'cancellation'
  | 'delay'
  | 'schedule_change'
  | 'missed_connection'
  | 'equipment_downgrade'
  | 'delay_minor'
  | 'none';

export interface Classification {
  change_type: ChangeType;
  disruption_type: DisruptionType;
  /** Indices of segments hit by an involuntary disruption. */
  impacted: number[];
  impacted_from: number | null;
  connection_status: 'not_applicable' | 'intact' | 'broken';
}

/** Voluntary vs involuntary classification (thresholds from Config; no LLM). */
export function classifyDisruption(facts: SegmentFacts[], config: Config): Classification {
  const cancelled = facts.filter((f) => f.cancelled).map((f) => f.index);
  const delayed = facts.filter((f) => !f.cancelled && f.delay_min >= config.delayInvoluntaryMin).map((f) => f.index);
  const sched = facts.filter((f) => !f.cancelled && f.schedule_change_min >= config.scheduleChangeInvoluntaryMin).map((f) => f.index);
  const missed = facts
    .filter((f) => f.gap_to_next_min !== null && f.gap_to_next_min < config.minConnectionMin)
    .map((f) => f.index + 1);
  const downgrade = facts.filter((f) => !f.cancelled && f.equipment_downgrade).map((f) => f.index);
  // A cancelled segment also loses the connection to the segment after it.
  const lostConnections = cancelled.filter((i) => i + 1 < facts.length).map((i) => i + 1);
  const impacted = [...new Set([...cancelled, ...lostConnections, ...delayed, ...sched, ...missed, ...downgrade])].sort((a, b) => a - b);

  let disruption_type: DisruptionType = 'none';
  if (cancelled.length) disruption_type = 'cancellation';
  else if (delayed.length) disruption_type = 'delay';
  else if (sched.length) disruption_type = 'schedule_change';
  else if (missed.length) disruption_type = 'missed_connection';
  else if (downgrade.length) disruption_type = 'equipment_downgrade';
  else if (facts.some((f) => f.delay_min > 0)) disruption_type = 'delay_minor';

  const connection_status: Classification['connection_status'] =
    facts.length < 2 ? 'not_applicable' : cancelled.length || missed.length ? 'broken' : 'intact';

  return {
    change_type: impacted.length ? 'involuntary' : 'voluntary',
    disruption_type,
    impacted,
    impacted_from: impacted.length ? impacted[0] : null,
    connection_status,
  };
}

export const isSeatHolder = (p: Passenger): boolean => p.type !== 'infant';

interface FareRule {
  voluntary_allowed: boolean;
  voluntary_fee_ars: number; // per seat-holding passenger
}

/** Synthetic fare families (names and values [TBV]). */
export const FARE_RULES: Record<FareFamily, FareRule> = {
  ECO_BASIC: { voluntary_allowed: false, voluntary_fee_ars: 0 },
  ECO_PLUS: { voluntary_allowed: true, voluntary_fee_ars: 45000 },
  ECO_FLEX: { voluntary_allowed: true, voluntary_fee_ars: 25000 },
};

export function voluntaryBlockedBy(passengers: Passenger[]): string | null {
  return passengers.filter(isSeatHolder).some((p) => !FARE_RULES[p.fare_family].voluntary_allowed) ? 'POLICY_FARE_NOT_CHANGEABLE' : null;
}

export function priceChange(args: {
  changeType: ChangeType;
  passengers: Passenger[];
  replacedPrices: number[];
  newPrices: number[];
  ancillaryFees: number;
}): PaymentBreakdown & { total_ars: number } {
  if (args.changeType === 'involuntary') return { fee_ars: 0, fare_difference_ars: 0, ancillary_reissue_ars: 0, total_ars: 0 };
  const holders = args.passengers.filter(isSeatHolder);
  const fee = holders.reduce((s, p) => s + FARE_RULES[p.fare_family].voluntary_fee_ars, 0);
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const diff = holders.length * Math.max(0, sum(args.newPrices) - sum(args.replacedPrices));
  return { fee_ars: fee, fare_difference_ars: diff, ancillary_reissue_ars: args.ancillaryFees, total_ars: fee + diff + args.ancillaryFees };
}
