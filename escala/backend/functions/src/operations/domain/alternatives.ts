import type { Config } from '../../shared/config';
import type { Flight } from '../../shared/types';
import { minutesOf } from '../../shared/time';

export interface Itinerary {
  legs: Flight[];
}

export const flightKey = (f: { flight_number: string; date: string }): string => `${f.flight_number}_${f.date}`;

export const arrivalMinutes = (it: Itinerary): number => {
  const last = it.legs[it.legs.length - 1];
  return minutesOf(last.date, last.arr) + (last.delay_min ?? 0);
};

/**
 * Direct and one-connection itineraries origin -> destination built from scheduled flights.
 * Connections must respect min and max layover. `exclude` holds flight keys the passenger already holds.
 */
export function findItineraries(
  flights: Flight[],
  origin: string,
  destination: string,
  exclude: Set<string>,
  config: Config,
): Itinerary[] {
  const usable = flights.filter((f) => f.status === 'scheduled' && !exclude.has(flightKey(f)));
  const out: Itinerary[] = [];
  for (const first of usable.filter((f) => f.origin === origin)) {
    if (first.destination === destination) {
      out.push({ legs: [first] });
      continue;
    }
    for (const second of usable) {
      if (second.origin !== first.destination || second.destination !== destination) continue;
      const layover = minutesOf(second.date, second.dep) - minutesOf(first.date, first.arr);
      if (layover >= config.minConnectionMin && layover <= config.maxConnectionMin) out.push({ legs: [first, second] });
    }
  }
  return out;
}
