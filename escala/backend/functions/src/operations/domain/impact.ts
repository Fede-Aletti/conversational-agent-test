import type { Flight } from '../../shared/types';
import { minutesOf } from '../../shared/time';

export interface SegmentFacts {
  index: number;
  flight_number: string;
  cancelled: boolean;
  delay_min: number;
  schedule_change_min: number;
  equipment_downgrade: boolean;
  /** Layover (minutes) to the next segment after applying delays; null when last segment or a segment is cancelled. */
  gap_to_next_min: number | null;
}

/** Pure facts about an itinerary's flights; the rules that classify them live in policy-rules. */
export function computeFacts(flights: Flight[]): SegmentFacts[] {
  return flights.map((f, i) => {
    const next = flights[i + 1];
    let gap: number | null = null;
    if (next && f.status !== 'cancelled' && next.status !== 'cancelled') {
      gap = minutesOf(next.date, next.dep) + (next.delay_min ?? 0) - (minutesOf(f.date, f.arr) + (f.delay_min ?? 0));
    }
    return {
      index: i,
      flight_number: f.flight_number,
      cancelled: f.status === 'cancelled',
      delay_min: f.delay_min ?? 0,
      schedule_change_min: f.schedule_change_min ?? 0,
      equipment_downgrade: f.equipment_downgrade === true,
      gap_to_next_min: gap,
    };
  });
}
