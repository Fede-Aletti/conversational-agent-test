import { safeCode, sha1Hex, stableStringify } from '../src/shared/ids';
import { addDays } from '../src/shared/time';
import type { Ancillary, Booking, ExpectedOutcome, FareFamily, Flight, Passenger, PassengerType, ScenarioEntry } from '../src/shared/types';

export const SEED = 20261112;
/** Generated scenarios start well after the named fixtures; each owns a 12-day date window so searches never cross scenarios. */
export const GEN_START_DATE = '2027-06-01';
export const GEN_WINDOW_DAYS = 12;
export const TARGET_COUNT = 120;

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const DIMENSIONS = {
  pax: ['1a', '2a', '2a+m', '3a', '2a+i', '2a+m+i'],
  checkin: ['none', 'some', 'all'],
  anc: ['none', 'extra_bag', 'seat_selection', 'priority_boarding', 'pet_in_cabin', 'sport_equipment', 'combo'],
  fare: ['ECO_BASIC', 'ECO_PLUS', 'ECO_FLEX'],
  route: ['domestic', 'intl'],
  shape: ['direct', 'connection'],
  disruption: ['cancel', 'delay_below', 'delay_above', 'schedule_change', 'missed_connection', 'downgrade', 'none'],
  avail: ['none', 'partial', 'plenty', 'after_deadline'],
} as const;

type DimName = keyof typeof DIMENSIONS;
export type Row = Record<DimName, string>;
const DIM_NAMES = Object.keys(DIMENSIONS) as DimName[];

const isValid = (r: Partial<Row>): boolean => !(r.shape === 'direct' && r.disruption === 'missed_connection');

function pairsOf(r: Row): string[] {
  const out: string[] = [];
  for (let i = 0; i < DIM_NAMES.length; i++)
    for (let j = i + 1; j < DIM_NAMES.length; j++) out.push(`${DIM_NAMES[i]}=${r[DIM_NAMES[i]]}|${DIM_NAMES[j]}=${r[DIM_NAMES[j]]}`);
  return out;
}

function requiredPairs(): Set<string> {
  const all = new Set<string>();
  for (let i = 0; i < DIM_NAMES.length; i++)
    for (let j = i + 1; j < DIM_NAMES.length; j++)
      for (const a of DIMENSIONS[DIM_NAMES[i]])
        for (const b of DIMENSIONS[DIM_NAMES[j]]) {
          const partial: Partial<Row> = { [DIM_NAMES[i]]: a, [DIM_NAMES[j]]: b };
          if (isValid(partial)) all.add(`${DIM_NAMES[i]}=${a}|${DIM_NAMES[j]}=${b}`);
        }
  return all;
}

/**
 * Covering design: (1) full product of disruption x avail for 1 and 3 adults (56 rows), (2) greedy rows until every valid pair of
 * dimensions co-occurs, (3) padding with random valid rows up to TARGET_COUNT. Only the PRNG chooses among allowed values.
 */
export function buildRows(rng: () => number): Row[] {
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)];
  const complete = (fixed: Partial<Row>): Row => {
    for (;;) {
      const row = { ...fixed } as Partial<Row>;
      for (const d of DIM_NAMES) if (row[d] === undefined) row[d] = pick(DIMENSIONS[d]);
      if (isValid(row)) return row as Row;
    }
  };
  const uncovered = requiredPairs();
  const rows: Row[] = [];
  const add = (row: Row) => {
    rows.push(row);
    for (const p of pairsOf(row)) uncovered.delete(p);
  };
  const best = (fixed: Partial<Row>): Row => {
    let top: Row | null = null;
    let topScore = -1;
    for (let k = 0; k < 30; k++) {
      const cand = complete(fixed);
      const score = pairsOf(cand).filter((p) => uncovered.has(p)).length;
      if (score > topScore) {
        top = cand;
        topScore = score;
      }
    }
    return top as Row;
  };

  for (const pax of ['1a', '3a'])
    for (const disruption of DIMENSIONS.disruption)
      for (const avail of DIMENSIONS.avail) add(best({ pax, disruption, avail }));

  while (uncovered.size > 0) {
    const first = [...uncovered][0];
    const fixed: Partial<Row> = {};
    for (const part of first.split('|')) {
      const [d, v] = part.split('=');
      fixed[d as DimName] = v;
    }
    add(best(fixed));
  }
  while (rows.length < TARGET_COUNT) add(complete({}));
  return rows;
}

const FIRST_NAMES = ['Lucía', 'Mateo', 'Sofía', 'Santiago', 'Valeria', 'Nicolás', 'Camila', 'Julián', 'Agustina', 'Facundo', 'Martina', 'Ignacio'];
const LAST_NAMES = ['Acosta', 'Bustos', 'Cabrera', 'Domínguez', 'Escobar', 'Figueroa', 'Gallardo', 'Herrera', 'Ibarra', 'Juárez', 'Lacroix', 'Medina', 'Navarro', 'Ortega', 'Paredes', 'Quintana', 'Rojas', 'Salazar', 'Toledo', 'Urquiza', 'Vega', 'Zárate'];

const DOMESTIC_DIRECT = [['AEP', 'COR'], ['AEP', 'MDZ'], ['AEP', 'BRC'], ['AEP', 'IGR'], ['AEP', 'USH']];
const DOMESTIC_CONN = [['COR', 'AEP', 'BRC'], ['MDZ', 'AEP', 'IGR'], ['COR', 'AEP', 'USH'], ['BRC', 'AEP', 'MDZ']];
const INTL_DIRECT = [['AEP', 'MVD'], ['AEP', 'SCL'], ['AEP', 'GRU'], ['AEP', 'ASU']];
const INTL_CONN = [['COR', 'AEP', 'MVD'], ['MDZ', 'AEP', 'SCL'], ['COR', 'AEP', 'GRU'], ['BRC', 'AEP', 'ASU']];

const PAX_TYPES: Record<string, PassengerType[]> = {
  '1a': ['adult'],
  '2a': ['adult', 'adult'],
  '2a+m': ['adult', 'adult', 'minor'],
  '3a': ['adult', 'adult', 'adult'],
  '2a+i': ['adult', 'adult', 'infant'],
  '2a+m+i': ['adult', 'adult', 'minor', 'infant'],
};

const DISRUPTION_TYPE: Record<string, string> = {
  cancel: 'cancellation',
  delay_below: 'delay_minor',
  delay_above: 'delay',
  schedule_change: 'schedule_change',
  missed_connection: 'missed_connection',
  downgrade: 'equipment_downgrade',
  none: 'none',
};

export interface GeneratedData {
  flights: Flight[];
  bookings: Booking[];
  scenarios: ScenarioEntry[];
}

/** Pure function of `seed` (and the reserved PNRs): no clock, no Math.random. */
export function generateScenarios(seed: number = SEED, reservedPnrs: ReadonlySet<string> = new Set()): GeneratedData {
  const rng = mulberry32(seed);
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)];
  const rows = buildRows(rng);
  const usedPnrs = new Set(reservedPnrs);
  let flightCounter = 0;
  const nextFlightNumber = (): string => {
    const n = flightCounter++;
    return `AR${n < 1000 ? 8000 + n : 9500 + (n - 1000)}`;
  };

  const out: GeneratedData = { flights: [], bookings: [], scenarios: [] };

  rows.forEach((row, i) => {
    const id = `GEN-${String(i + 1).padStart(4, '0')}`;
    let pnr = safeCode(id);
    for (let salt = 1; usedPnrs.has(pnr); salt++) pnr = safeCode(`${id}#${salt}`);
    usedPnrs.add(pnr);

    const D = addDays(GEN_START_DATE, GEN_WINDOW_DAYS * i);
    const T = addDays(D, 2);
    const connection = row.shape === 'connection';
    const intl = row.route === 'intl';
    const airports = connection
      ? pick(intl ? INTL_CONN : DOMESTIC_CONN)
      : pick(intl ? INTL_DIRECT : DOMESTIC_DIRECT);
    const origin = airports[0];
    const hub = connection ? airports[1] : null;
    const dest = airports[airports.length - 1];

    // passengers
    const lastName = pick(LAST_NAMES);
    const types = PAX_TYPES[row.pax];
    const passengers: Passenger[] = types.map((type, k) => ({
      passenger_id: `P${k + 1}`,
      first_name: pick(FIRST_NAMES),
      last_name: lastName,
      type,
      checked_in: type !== 'infant' && (row.checkin === 'all' || (row.checkin === 'some' && k === 0)),
      fare_family: row.fare as FareFamily,
    }));
    const partySize = passengers.filter((p) => p.type !== 'infant').length;

    // original segments
    const mk = (o: string, d: string, date: string, dep: string, arr: string, seats: number | null, price: number, extra: Partial<Flight> = {}): Flight => ({
      flight_number: nextFlightNumber(), date, origin: o, destination: d, dep, arr, status: 'scheduled', seats, price_ars: price, ...extra,
    });
    const missed = row.disruption === 'missed_connection';
    const segs: Flight[] = connection
      ? [
          mk(origin, hub as string, D, '06:00', '07:30', 30, 60000),
          mk(hub as string, dest, D, missed ? '09:15' : '10:30', missed ? '11:15' : '12:30', 30, 70000),
        ]
      : [mk(origin, dest, D, '06:00', '08:00', 30, 120000)];
    switch (row.disruption) {
      case 'cancel':
        segs[0].status = 'cancelled';
        segs[0].seats = null;
        break;
      case 'delay_below':
        segs[0].delay_min = 90;
        break;
      case 'delay_above':
        segs[0].delay_min = 180;
        break;
      case 'schedule_change':
        segs[0].schedule_change_min = 120;
        break;
      case 'missed_connection':
        segs[0].delay_min = 100;
        break;
      case 'downgrade':
        segs[0].equipment_downgrade = true;
        break;
    }
    const origTotal = segs.reduce((s, f) => s + f.price_ars, 0);

    // alternatives
    const involuntary = !['delay_below', 'none'].includes(row.disruption);
    const searchFrom = missed ? segs[1].origin : origin;
    const altDate = involuntary ? addDays(D, 1) : T;
    const lateDate = involuntary ? addDays(D, 4) : addDays(T, 3);
    const altPrice = involuntary ? origTotal : origTotal + 5000;
    const alts: Flight[] = [];
    const seatsPartial = Math.max(0, partySize - 1);
    if (row.avail === 'plenty') {
      alts.push(mk(searchFrom, dest, altDate, '07:00', '09:00', partySize + 3, altPrice));
      alts.push(mk(searchFrom, dest, altDate, '15:00', '17:00', partySize + 5, altPrice));
    } else if (row.avail === 'partial') {
      alts.push(mk(searchFrom, dest, altDate, '07:00', '09:00', seatsPartial, altPrice));
    } else if (row.avail === 'after_deadline') {
      alts.push(mk(searchFrom, dest, lateDate, '07:00', '09:00', partySize + 3, altPrice));
    }

    // ancillaries (first seat-holding passenger)
    const allSegNumbers = segs.map((f) => f.flight_number);
    const ancillaries: Ancillary[] = [];
    const add = (type: Ancillary['type'], paid: number, detail?: string) =>
      ancillaries.push({ passenger_id: 'P1', type, segments: allSegNumbers, paid_ars: paid, ...(detail ? { detail } : {}) });
    if (row.anc === 'extra_bag' || row.anc === 'combo') add('extra_bag', 38000);
    if (row.anc === 'seat_selection' || row.anc === 'combo') add('seat_selection', 9000, `${10 + (i % 20)}A`);
    if (row.anc === 'priority_boarding' || row.anc === 'combo') add('priority_boarding', 12000);
    if (row.anc === 'pet_in_cabin') add('pet_in_cabin', 30000);
    if (row.anc === 'sport_equipment') add('sport_equipment', 25000);

    const failure = i % 20 === 19 ? (['always_timeout', 'always_5xx', 'slow'] as const)[Math.floor(i / 20) % 3] : undefined;
    const booking: Booking = {
      pnr,
      passengers,
      segments: segs.map((f) => ({ flight_number: f.flight_number, date: f.date })),
      ancillaries,
      version: 1,
      scenario_id: id,
      ...(failure ? { failure_mode: { endpoints: ['getFlightStatus', 'getRebookingOptions'], mode: failure } } : {}),
    };

    // expected outcome, by construction (independent of the domain code under test)
    let cls: ExpectedOutcome['class'];
    if (failure === 'always_timeout') cls = 'failure:timeout';
    else if (failure === 'always_5xx') cls = 'failure:5xx';
    else if (row.disruption === 'delay_below') cls = 'no_change_needed';
    else if (row.disruption === 'none' && row.fare === 'ECO_BASIC') cls = 'blocked_policy';
    else if (row.avail === 'none') cls = 'no_options';
    else if (row.avail === 'after_deadline') cls = 'only_after_deadline';
    else if (row.avail === 'partial') cls = 'partial_seats_only';
    else cls = row.anc === 'pet_in_cabin' ? 'needs_review' : 'options_available';

    const tags = [
      ...DIM_NAMES.map((d) => `${d}:${row[d]}`),
      involuntary ? 'involuntary' : 'voluntary',
      ...(failure ? [`failure:${failure}`] : []),
    ];
    out.flights.push(...segs, ...alts);
    out.bookings.push(booking);
    out.scenarios.push({
      scenario_id: id,
      type: 'generated',
      pnr,
      surname: lastName,
      tags,
      exercises: `${row.pax} pax, ${row.shape} ${row.route}, ${row.disruption}, alternatives ${row.avail}, ${row.fare}, ancillaries ${row.anc}`,
      expected_outcome: {
        class: cls,
        change_type: involuntary ? 'involuntary' : 'voluntary',
        disruption_type: DISRUPTION_TYPE[row.disruption],
        party_size: partySize,
        ...(row.disruption === 'downgrade' ? { has_keep_current: true } : {}),
        ...(failure === 'slow' ? { slow: true } : {}),
      },
      probe: row.disruption === 'none' ? { target_date: T } : {},
    });
  });
  return out;
}

export function datasetHash(data: unknown): string {
  return sha1Hex(stableStringify(data));
}
