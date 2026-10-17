import type { Ancillary, AncillaryType, ChangeType, Flight, Passenger } from '../../shared/types';
import type { AncillaryOutcomeView } from '../../rebooking/domain/types';

type Outcome = AncillaryOutcomeView['outcome'];

interface Rule {
  involuntary: Outcome;
  voluntary: Outcome;
  fee_ars: number;
  note: Record<Outcome, string>;
}

const generic = (what: string): Record<Outcome, string> => ({
  transfers: `${what} transfers to the new flights at no cost.`,
  transfers_with_fee: `${what} transfers to the new flights with a re-issue fee.`,
  not_transferred: `${what} is not transferred to the new flights.`,
  needs_review: `${what} needs manual review by the airline.`,
});

/** Synthetic ancillary transfer rules (TDD: policy-rules > ancillary transfer rules). */
export const ANCILLARY_RULES: Record<AncillaryType, Rule> = {
  extra_bag: { involuntary: 'transfers', voluntary: 'transfers_with_fee', fee_ars: 10000, note: generic('The extra bag') },
  seat_selection: {
    involuntary: 'not_transferred',
    voluntary: 'not_transferred',
    fee_ars: 0,
    note: {
      ...generic('The seat selection'),
      not_transferred: 'The seat selection is not kept; the passenger must reselect at check-in. Refund of the seat fee is handled by a human.',
    },
  },
  priority_boarding: { involuntary: 'transfers', voluntary: 'not_transferred', fee_ars: 0, note: generic('Priority boarding') },
  pet_in_cabin: {
    involuntary: 'needs_review',
    voluntary: 'needs_review',
    fee_ars: 0,
    note: { ...generic('The pet in cabin'), needs_review: 'The carrier must re-approve the pet in cabin on the new flights; a human must review it.' },
  },
  sport_equipment: { involuntary: 'transfers', voluntary: 'transfers_with_fee', fee_ars: 15000, note: generic('The sport equipment') },
};

export interface PassengerAncillaryOutcome extends AncillaryOutcomeView {
  passenger_id: string;
  fee_ars: number;
}

/**
 * Outcome per ancillary that touches at least one replaced flight. Infants carry no ancillaries.
 * Ancillaries only on kept segments are untouched and not reported.
 */
export function ancillaryOutcomes(
  passengers: Passenger[],
  ancillaries: Ancillary[],
  changeType: ChangeType,
  replacedFlightNumbers: Set<string>,
  _newLegs: Flight[],
): PassengerAncillaryOutcome[] {
  const infants = new Set(passengers.filter((p) => p.type === 'infant').map((p) => p.passenger_id));
  const out: PassengerAncillaryOutcome[] = [];
  for (const a of ancillaries) {
    if (infants.has(a.passenger_id)) continue;
    if (!a.segments.some((s) => replacedFlightNumbers.has(s))) continue;
    const rule = ANCILLARY_RULES[a.type];
    const outcome = changeType === 'involuntary' ? rule.involuntary : rule.voluntary;
    out.push({
      passenger_id: a.passenger_id,
      type: a.type,
      outcome,
      note: rule.note[outcome],
      fee_ars: outcome === 'transfers_with_fee' ? rule.fee_ars : 0,
    });
  }
  return out;
}

/** Applies outcomes to the booking's ancillaries when a rebooking is executed. */
export function applyAncillaryOutcomes(
  passengers: Passenger[],
  ancillaries: Ancillary[],
  changeType: ChangeType,
  replacedFlightNumbers: Set<string>,
  newLegNumbers: string[],
): { ancillaries: Ancillary[]; results: Array<{ passenger_id: string; type: string; outcome: Outcome; note: string }> } {
  const infants = new Set(passengers.filter((p) => p.type === 'infant').map((p) => p.passenger_id));
  const kept: Ancillary[] = [];
  const results: Array<{ passenger_id: string; type: string; outcome: Outcome; note: string }> = [];
  for (const a of ancillaries) {
    if (infants.has(a.passenger_id) || !a.segments.some((s) => replacedFlightNumbers.has(s))) {
      kept.push(a);
      continue;
    }
    const rule = ANCILLARY_RULES[a.type];
    const outcome = changeType === 'involuntary' ? rule.involuntary : rule.voluntary;
    results.push({ passenger_id: a.passenger_id, type: a.type, outcome, note: rule.note[outcome] });
    if (outcome === 'transfers' || outcome === 'transfers_with_fee') {
      kept.push({ ...a, segments: [...a.segments.filter((s) => !replacedFlightNumbers.has(s)), ...newLegNumbers] });
    } else if (outcome === 'needs_review') {
      kept.push(a);
    }
  }
  return { ancillaries: kept, results };
}
