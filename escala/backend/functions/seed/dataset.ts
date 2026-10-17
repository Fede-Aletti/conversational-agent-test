import type { Ancillary, Booking, Dataset, ExpectedOutcome, FareFamily, Flight, Passenger, PassengerType, PolicySnippet, ScenarioEntry, ScenarioProbe } from '../src/shared/types';
import { addDays } from '../src/shared/time';
import { datasetHash, generateScenarios } from './generate';

// ---------------------------------------------------------------------------------------------
// Simulated "today" is 2026-11-12 (Thursday). Every flight number, PNR, name and price is fictitious.
// ---------------------------------------------------------------------------------------------

const f = (
  flight_number: string,
  date: string,
  origin: string,
  destination: string,
  dep: string,
  arr: string,
  seats: number | null,
  price_ars: number,
  extra: Partial<Flight> = {},
): Flight => ({ flight_number, date, origin, destination, dep, arr, status: seats === null ? 'cancelled' : 'scheduled', seats, price_ars, ...extra });

/** Core flights from the TDD "Flights" table. */
const CORE_FLIGHTS: Flight[] = [
  f('AR1561', '2026-11-12', 'COR', 'AEP', '07:10', '08:35', null, 60000),
  f('AR1692', '2026-11-12', 'AEP', 'BRC', '10:20', '12:35', 12, 110000),
  f('AR1563', '2026-11-12', 'COR', 'AEP', '11:30', '12:55', 6, 60000),
  f('AR1696', '2026-11-12', 'AEP', 'BRC', '15:40', '17:55', 1, 110000),
  f('AR1565', '2026-11-13', 'COR', 'AEP', '07:00', '08:25', 9, 60000),
  f('AR1694', '2026-11-13', 'AEP', 'BRC', '09:50', '12:05', 6, 110000),
  f('AR1880', '2026-11-13', 'COR', 'BRC', '09:15', '11:40', 2, 150000),
  f('AR1698', '2026-11-12', 'AEP', 'BRC', '13:00', '15:15', 8, 110000, { failure_mode: { endpoints: ['getFlightStatus'], mode: 'always_timeout' } }),
  f('AR1301', '2026-11-12', 'MDZ', 'AEP', '09:00', '10:50', null, 70000),
  f('AR1306', '2026-11-15', 'MDZ', 'AEP', '09:00', '10:50', 5, 70000),
  f('AR1700', '2026-11-12', 'AEP', 'MDZ', '18:00', '19:50', null, 70000),
  f('AR1702', '2026-11-12', 'AEP', 'MDZ', '20:30', '22:20', 9, 70000),
  f('AR1710', '2026-11-14', 'AEP', 'MDZ', '08:00', '09:50', 8, 70000),
  f('AR1850', '2026-11-14', 'AEP', 'IGR', '08:00', '10:05', 10, 95000),
  f('AR1852', '2026-11-15', 'AEP', 'IGR', '08:00', '10:05', 7, 105000),
  f('AR1860', '2026-11-16', 'AEP', 'IGR', '14:00', '16:05', 10, 90000),
  f('AR1862', '2026-11-17', 'AEP', 'IGR', '14:00', '16:05', 10, 90000),
];

const pax = (id: number, first: string, last: string, type: PassengerType, checked_in: boolean, fare: FareFamily): Passenger => ({
  passenger_id: `P${id}`, first_name: first, last_name: last, type, checked_in, fare_family: fare,
});
const bag = (passenger_id: string, segments: string[]): Ancillary => ({ passenger_id, type: 'extra_bag', segments, paid_ars: 38000 });
const seg = (flight_number: string, date: string) => ({ flight_number, date });

const CORE_BOOKINGS: Booking[] = [
  {
    pnr: 'RMR4TX', version: 1, scenario_id: 'FX-DEMO',
    passengers: [pax(1, 'Valentina', 'Romero', 'adult', false, 'ECO_FLEX'), pax(2, 'Joaquín', 'Benítez', 'adult', true, 'ECO_FLEX')],
    segments: [seg('AR1561', '2026-11-12'), seg('AR1692', '2026-11-12')],
    ancillaries: [
      bag('P1', ['AR1561', 'AR1692']),
      bag('P2', ['AR1561', 'AR1692']),
      { passenger_id: 'P2', type: 'seat_selection', segments: ['AR1561', 'AR1692'], paid_ars: 9000, detail: '12A / 12C' },
    ],
  },
  {
    pnr: 'LQ3W9D', version: 1, scenario_id: 'FX-FALLBACK',
    passengers: [pax(1, 'Marcos', 'Ferreyra', 'adult', false, 'ECO_FLEX')],
    segments: [seg('AR1710', '2026-11-14')], ancillaries: [],
  },
  {
    pnr: 'NV8C5R', version: 1, scenario_id: 'FX-VOLUNTARY',
    passengers: [pax(1, 'Camila', 'Sosa', 'adult', false, 'ECO_FLEX')],
    segments: [seg('AR1850', '2026-11-14')], ancillaries: [bag('P1', ['AR1850'])],
  },
  {
    pnr: 'TB6H1Y', version: 1, scenario_id: 'FX-NOALT',
    passengers: [pax(1, 'Ramiro', 'Molina', 'adult', false, 'ECO_FLEX')],
    segments: [seg('AR1301', '2026-11-12')], ancillaries: [],
  },
  {
    pnr: 'SV2T7K', version: 1, scenario_id: 'FX-TIMEOUT',
    passengers: [pax(1, 'Elena', 'Quiroga', 'adult', false, 'ECO_FLEX')],
    segments: [seg('AR1698', '2026-11-12')], ancillaries: [],
    failure_mode: { endpoints: ['getFlightStatus', 'getRebookingOptions'], mode: 'always_timeout' },
  },
  {
    pnr: 'DP4N8S', version: 1, scenario_id: 'FX-DUP',
    passengers: [pax(1, 'Tomás', 'Luna', 'adult', false, 'ECO_FLEX')],
    segments: [seg('AR1700', '2026-11-12')], ancillaries: [bag('P1', ['AR1700'])],
  },
  {
    pnr: 'PB9K4Z', version: 1, scenario_id: 'FX-POLICYBLOCK',
    passengers: [pax(1, 'Sofía', 'Giménez', 'adult', false, 'ECO_BASIC')],
    segments: [seg('AR1860', '2026-11-16')], ancillaries: [],
  },
];

// ---------------------------------------------------------------------------------------------
// Additional named fixtures. Each owns a dedicated 12-day date window (support flights in AR9xxx)
// so alternatives searches never cross fixtures.
// ---------------------------------------------------------------------------------------------

const FIXTURE_BASE = '2026-11-30';
const day = (k: number, offset = 0): string => addDays(FIXTURE_BASE, 12 * k + offset);

interface Extra {
  flights: Flight[];
  booking: Booking;
  scenario: ScenarioEntry;
}

function extra(
  k: number,
  scenario_id: string,
  pnr: string,
  exercises: string,
  tags: string[],
  build: (d: (offset?: number) => string) => { flights: Flight[]; passengers: Passenger[]; ancillaries?: Ancillary[]; segments: Array<[string, number]>; failure_mode?: Booking['failure_mode'] },
  expected: ExpectedOutcome,
  probe?: ScenarioProbe | ((d: (offset?: number) => string) => ScenarioProbe),
): Extra {
  const d = (offset = 0) => day(k, offset);
  const b = build(d);
  return {
    flights: b.flights,
    booking: {
      pnr, version: 1, scenario_id,
      passengers: b.passengers, segments: b.segments.map(([n, off]) => seg(n, d(off))), ancillaries: b.ancillaries ?? [],
      ...(b.failure_mode ? { failure_mode: b.failure_mode } : {}),
    },
    scenario: {
      scenario_id, type: 'fixture', pnr, surname: b.passengers[0].last_name, tags, exercises, expected_outcome: expected,
      probe: typeof probe === 'function' ? probe(d) : (probe ?? {}),
    },
  };
}

const FLEX: FareFamily = 'ECO_FLEX';
const inv = (disruption_type: string, party_size: number, rest: Partial<ExpectedOutcome> = {}): ExpectedOutcome => ({
  class: 'options_available', change_type: 'involuntary', disruption_type, party_size, ...rest,
});

const EXTRAS: Extra[] = [
  extra(0, 'FX-INFANT', 'KT5M2V', '1 adult + 1 infant, cancellation; infant excluded from seats and ancillaries (F-12)', ['infant', 'pax-types'],
    (d) => ({
      flights: [f('AR9001', d(), 'AEP', 'COR', '08:00', '09:10', null, 80000), f('AR9002', d(1), 'AEP', 'COR', '08:00', '09:10', 5, 80000)],
      passengers: [pax(1, 'Rocío', 'Aguirre', 'adult', false, FLEX), pax(2, 'Bruno', 'Aguirre', 'infant', false, FLEX)],
      ancillaries: [bag('P1', ['AR9001'])], segments: [['AR9001', 0]],
    }), inv('cancellation', 1)),
  extra(1, 'FX-MINOR', 'HN7D4C', '2 adults + 1 minor; the earliest option has only 2 of 3 seats (party-fit logic) (F-12)', ['minor', 'party-fit', 'pax-types'],
    (d) => ({
      flights: [
        f('AR9010', d(), 'AEP', 'MDZ', '08:00', '09:50', null, 90000),
        f('AR9011', d(1), 'AEP', 'MDZ', '07:00', '08:50', 2, 90000),
        f('AR9012', d(1), 'AEP', 'MDZ', '16:00', '17:50', 6, 90000),
      ],
      passengers: [pax(1, 'Hugo', 'Navarro', 'adult', false, FLEX), pax(2, 'Irene', 'Navarro', 'adult', false, FLEX), pax(3, 'Leo', 'Navarro', 'minor', false, FLEX)],
      segments: [['AR9010', 0]],
    }), inv('cancellation', 3)),
  extra(2, 'FX-PARTIAL', 'PS8N4W', '3 adults; one option with 2 seats, one with 3 seats later', ['partial-seats', 'multi-passenger'],
    (d) => ({
      flights: [
        f('AR9020', d(), 'AEP', 'BRC', '08:00', '10:15', null, 130000),
        f('AR9021', d(1), 'AEP', 'BRC', '06:30', '08:45', 2, 130000),
        f('AR9022', d(1), 'AEP', 'BRC', '14:00', '16:15', 3, 130000),
      ],
      passengers: [pax(1, 'Pablo', 'Sandoval', 'adult', true, FLEX), pax(2, 'Rita', 'Sandoval', 'adult', false, FLEX), pax(3, 'Joel', 'Sandoval', 'adult', false, FLEX)],
      segments: [['AR9020', 0]],
    }), inv('cancellation', 3)),
  extra(3, 'FX-PET', 'PW6J8X', 'pet_in_cabin: ANCILLARY_NEEDS_REVIEW makes the option non-executable -> handoff (F-12)', ['pet', 'ancillaries', 'needs-review'],
    (d) => ({
      flights: [f('AR9030', d(), 'AEP', 'USH', '07:00', '10:30', null, 160000), f('AR9031', d(1), 'AEP', 'USH', '07:00', '10:30', 5, 160000)],
      passengers: [pax(1, 'Gabriela', 'Pereyra', 'adult', false, FLEX)],
      ancillaries: [{ passenger_id: 'P1', type: 'pet_in_cabin', segments: ['AR9030'], paid_ars: 30000 }], segments: [['AR9030', 0]],
    }), { class: 'needs_review', change_type: 'involuntary', disruption_type: 'cancellation', party_size: 1 }),
  extra(4, 'FX-SPORT', 'SQ9R3F', 'sport_equipment + priority_boarding on a voluntary change: re-issue fee and non-transfer (F-12)', ['sport', 'priority', 'voluntary', 'ancillaries'],
    (d) => ({
      flights: [f('AR9040', d(), 'AEP', 'BRC', '09:00', '11:15', 20, 110000), f('AR9041', d(1), 'AEP', 'BRC', '09:00', '11:15', 20, 120000)],
      passengers: [pax(1, 'Tadeo', 'Cornejo', 'adult', false, FLEX)],
      ancillaries: [
        { passenger_id: 'P1', type: 'sport_equipment', segments: ['AR9040'], paid_ars: 25000 },
        { passenger_id: 'P1', type: 'priority_boarding', segments: ['AR9040'], paid_ars: 12000 },
      ],
      segments: [['AR9040', 0]],
    }), { class: 'options_available', change_type: 'voluntary', disruption_type: 'none', party_size: 1 }, (d) => ({ target_date: d(1) })),
  extra(5, 'FX-PLUS', 'PL3T5R', 'ECO_PLUS voluntary change: fee 45,000 per passenger', ['voluntary', 'eco-plus', 'pricing'],
    (d) => ({
      flights: [f('AR9050', d(), 'AEP', 'COR', '10:00', '11:10', 20, 80000), f('AR9051', d(1), 'AEP', 'COR', '10:00', '11:10', 20, 80000)],
      passengers: [pax(1, 'Alma', 'Villarreal', 'adult', false, 'ECO_PLUS'), pax(2, 'Dante', 'Villarreal', 'adult', false, 'ECO_PLUS')],
      segments: [['AR9050', 0]],
    }), { class: 'options_available', change_type: 'voluntary', disruption_type: 'none', party_size: 2 }, (d) => ({ target_date: d(1) })),
  extra(6, 'FX-DELAY-BELOW', 'DL4B6N', '90 min delay, connection intact: informational, no involuntary change (F-11)', ['delay', 'below-threshold'],
    (d) => ({
      flights: [f('AR9060', d(), 'AEP', 'IGR', '08:00', '10:05', 15, 95000, { delay_min: 90 })],
      passengers: [pax(1, 'Esteban', 'Luque', 'adult', false, FLEX)], segments: [['AR9060', 0]],
    }), { class: 'no_change_needed', change_type: 'voluntary', disruption_type: 'delay_minor', party_size: 1 }),
  extra(7, 'FX-DELAY-ABOVE', 'DL8H2P', '180 min delay: involuntary (F-11)', ['delay', 'above-threshold'],
    (d) => ({
      flights: [f('AR9070', d(), 'AEP', 'IGR', '08:00', '10:05', 15, 95000, { delay_min: 180 }), f('AR9071', d(), 'AEP', 'IGR', '14:00', '16:05', 4, 95000)],
      passengers: [pax(1, 'Flavia', 'Montiel', 'adult', false, FLEX)], segments: [['AR9070', 0]],
    }), inv('delay', 1)),
  extra(8, 'FX-SCHEDCHANGE', 'SC3K7T', '120 min schedule change: involuntary (F-11)', ['schedule-change'],
    (d) => ({
      flights: [f('AR9080', d(), 'AEP', 'MDZ', '08:00', '09:50', 15, 70000, { schedule_change_min: 120 }), f('AR9081', d(1), 'AEP', 'MDZ', '08:00', '09:50', 8, 70000)],
      passengers: [pax(1, 'Greta', 'Salvatierra', 'adult', false, FLEX)], segments: [['AR9080', 0]],
    }), inv('schedule_change', 1)),
  extra(9, 'FX-MISSEDCONN', 'MC5W9G', 'Seg 1 delayed 100 min (below threshold) breaks the 60 min connection: involuntary by connection rule', ['missed-connection', 'connection'],
    (d) => ({
      flights: [
        f('AR9090', d(), 'AEP', 'COR', '06:00', '07:30', 15, 70000, { delay_min: 100 }),
        f('AR9091', d(), 'COR', 'BRC', '09:15', '11:15', 15, 90000),
        f('AR9092', d(), 'COR', 'BRC', '14:00', '16:00', 5, 90000),
      ],
      passengers: [pax(1, 'Hilario', 'Duarte', 'adult', false, FLEX)], segments: [['AR9090', 0], ['AR9091', 0]],
    }), inv('missed_connection', 1)),
  extra(10, 'FX-DOWNGRADE', 'ED2V6Z', 'Equipment downgrade: seat assignments lost; keep_current + alternatives (F-11)', ['downgrade', 'keep-current'],
    (d) => ({
      flights: [f('AR9100', d(), 'AEP', 'BRC', '09:00', '11:15', 15, 110000, { equipment_downgrade: true }), f('AR9101', d(1), 'AEP', 'BRC', '09:00', '11:15', 8, 110000)],
      passengers: [pax(1, 'Ivana', 'Castañeda', 'adult', false, FLEX)],
      ancillaries: [{ passenger_id: 'P1', type: 'seat_selection', segments: ['AR9100'], paid_ars: 9000, detail: '14C' }], segments: [['AR9100', 0]],
    }), inv('equipment_downgrade', 1, { has_keep_current: true })),
  extra(11, 'FX-INTL', 'XN7B2K', 'Regional international AEP->MVD cancelled; travel-documents FAQ note (F-12)', ['international', 'regional'],
    (d) => ({
      flights: [f('AR9110', d(), 'AEP', 'MVD', '09:00', '10:10', null, 100000), f('AR9111', d(1), 'AEP', 'MVD', '09:00', '10:10', 5, 100000)],
      passengers: [pax(1, 'Julieta', 'Arriaga', 'adult', false, FLEX), pax(2, 'Mauro', 'Arriaga', 'adult', true, FLEX)], segments: [['AR9110', 0]],
    }), inv('cancellation', 2)),
  extra(12, 'FX-5XX', 'UE4Q8H', 'Backend UPSTREAM_ERROR (5xx-like, 200 envelope, retryable) (F-07)', ['failure', '5xx', 'resilience'],
    (d) => ({
      flights: [f('AR9120', d(), 'AEP', 'COR', '08:00', '09:10', null, 80000), f('AR9121', d(1), 'AEP', 'COR', '08:00', '09:10', 5, 80000)],
      passengers: [pax(1, 'Kevin', 'Olmos', 'adult', false, FLEX)], segments: [['AR9120', 0]],
      failure_mode: { endpoints: ['getFlightStatus', 'getRebookingOptions'], mode: 'always_5xx' },
    }), { class: 'failure:5xx', change_type: 'involuntary', disruption_type: 'cancellation', party_size: 1 }),
  extra(13, 'FX-SLOW', 'SL6Y3M', 'Backend latency ~8 s then success (F-07)', ['failure', 'slow', 'resilience'],
    (d) => ({
      flights: [f('AR9130', d(), 'AEP', 'COR', '08:00', '09:10', null, 80000), f('AR9131', d(1), 'AEP', 'COR', '08:00', '09:10', 5, 80000)],
      passengers: [pax(1, 'Luciana', 'Peralta', 'adult', false, FLEX)], segments: [['AR9130', 0]],
      failure_mode: { endpoints: ['getFlightStatus', 'getRebookingOptions'], mode: 'slow' },
    }), inv('cancellation', 1, { slow: true })),
];

const fx = (scenario_id: string, pnr: string, surname: string, exercises: string, tags: string[], expected: ScenarioEntry['expected_outcome'], probe?: ScenarioProbe): ScenarioEntry => ({
  scenario_id, type: 'fixture', pnr, surname, tags, exercises, expected_outcome: expected, ...(probe ? { probe } : {}),
});

const CORE_SCENARIOS: ScenarioEntry[] = [
  fx('FX-DEMO', 'RMR4TX', 'Romero', 'Main demo: cancel + broken connection, 2 pax, one checked in, bags + seats; option ranking, split-party option C not executable (F-01)', ['demo', 'multi-passenger', 'checkin'],
    inv('cancellation', 2), { deadline: 'tomorrow' }),
  fx('FX-NOTFOUND', 'QWE4RT', 'Desconocido', 'BOOKING_NOT_FOUND (F-03)', ['identification', 'not-found'], { class: 'booking_not_found' }),
  fx('FX-FALLBACK', 'LQ3W9D', 'Ferreyra', 'Lookup by surname + date + route after a wrong PNR (F-03)', ['identification', 'fallback'],
    { class: 'custom', note: 'wrong PNR LQ3W9B -> BOOKING_NOT_FOUND; surname Ferreyra + 2026-11-14 + AEP->MDZ succeeds' }),
  fx('FX-VOLUNTARY', 'NV8C5R', 'Sosa', 'Voluntary change, ECO_FLEX: fee + difference + bag re-issue = 45,000, simulated payment; destination change unsupported (F-04, F-05)', ['voluntary', 'pricing', 'destination-change'],
    { class: 'options_available', change_type: 'voluntary', disruption_type: 'none', party_size: 1 }, { target_date: '2026-11-15' }),
  fx('FX-NOALT', 'TB6H1Y', 'Molina', 'Cancelled, no alternatives by the deadline, only a later flight (F-06)', ['no-alternatives'],
    { class: 'only_after_deadline', change_type: 'involuntary', disruption_type: 'cancellation', party_size: 1 }, { deadline: 'tomorrow' }),
  fx('FX-TIMEOUT', 'SV2T7K', 'Quiroga', 'UPSTREAM_TIMEOUT on status/options (F-07)', ['failure', 'timeout', 'resilience'],
    { class: 'failure:timeout', change_type: 'voluntary', disruption_type: 'none', party_size: 1 }, { deadline: 'tomorrow' }),
  fx('FX-DUP', 'DP4N8S', 'Luna', 'Single easy option; duplicate confirmation / idempotency (F-02)', ['idempotency', 'duplicate'],
    inv('cancellation', 1), { deadline: 'tomorrow' }),
  fx('FX-POLICYBLOCK', 'PB9K4Z', 'Giménez', 'ECO_BASIC voluntary change blocked (F-08)', ['policy', 'eco-basic'],
    { class: 'blocked_policy', change_type: 'voluntary', disruption_type: 'none', party_size: 1 }, { target_date: '2026-11-17' }),
];

export const FIXTURE_FLIGHTS: Flight[] = [...CORE_FLIGHTS, ...EXTRAS.flatMap((e) => e.flights)];
export const FIXTURE_BOOKINGS: Booking[] = [...CORE_BOOKINGS, ...EXTRAS.map((e) => e.booking)];
export const FIXTURE_SCENARIOS: ScenarioEntry[] = [...CORE_SCENARIOS, ...EXTRAS.map((e) => e.scenario)];

// Curated policy snippets (fallback for /policies/faq). Placeholder URLs; figures are [TBV]; needs human verification.
const snippet = (topic: string, title: string, text: string, keywords: string[], slug: string): PolicySnippet => ({
  topic, title, text, keywords, source_url: `https://www.aerolineas.com.ar/PLACEHOLDER/${slug}`,
});

export const POLICY_SNIPPETS: PolicySnippet[] = [
  snippet('baggage_allowance', 'Franquicia de equipaje', 'La franquicia de equipaje de mano y despachado depende de la ruta y de la tarifa. Los límites exactos están a confirmar [TBV]. El exceso se cobra en el aeropuerto, con valores a confirmar [TBV].', ['equipaje', 'franquicia', 'valija', 'maleta', 'mano', 'despachado', 'kilos'], 'equipaje-franquicia'),
  snippet('extra_baggage', 'Equipaje adicional', 'El equipaje adicional se puede comprar antes del viaje o en el aeropuerto y queda asociado a la reserva. Precios y límites a confirmar [TBV].', ['equipaje', 'adicional', 'extra', 'valija', 'bolso'], 'equipaje-adicional'),
  snippet('checkin', 'Check-in', 'El check-in online abre y cierra en horarios fijados antes de la salida, a confirmar [TBV]. También hay check-in en mostrador. Hay que llevar la documentación.', ['check', 'checkin', 'check-in', 'mostrador', 'documentacion', 'embarque'], 'check-in'),
  snippet('fare_conditions', 'Condiciones de las tarifas', 'Las familias tarifarias difieren en cambios, devoluciones, equipaje y asientos. Se aplican las reglas de la tarifa comprada, a confirmar [TBV].', ['tarifa', 'tarifas', 'cambios', 'condiciones', 'familia', 'devoluciones'], 'condiciones-tarifas'),
  snippet('voluntary_changes_refunds', 'Cambios y devoluciones voluntarios', 'Los cambios y devoluciones voluntarios dependen de la tarifa, de cargos y de la diferencia tarifaria, con plazos a confirmar [TBV].', ['cambio', 'cambios', 'devolucion', 'devoluciones', 'reembolso', 'voluntario', 'cargo'], 'cambios-devoluciones'),
  snippet('involuntary_changes', 'Cambios involuntarios', 'Si la aerolínea cancela o modifica de forma importante un vuelo, el pasajero puede ser reubicado o pedir alternativas o devolución, a confirmar [TBV]. Quienes ya hicieron el check-in deben hacerlo de nuevo en el vuelo nuevo.', ['cancelacion', 'cancelado', 'demora', 'involuntario', 'reubicacion', 'reprogramacion', 'check'], 'cambios-involuntarios'),
  snippet('travel_requirements', 'Requisitos de viaje', 'Para vuelos de cabotaje se pide documento de identidad. Menores y casos especiales, y los requisitos para vuelos regionales, a confirmar [TBV].', ['documento', 'dni', 'pasaporte', 'requisitos', 'menores', 'viaje', 'internacional'], 'requisitos-de-viaje'),
  snippet('services', 'Servicios adicionales', 'Asientos, asistencia especial, mascotas y equipamiento deportivo se solicitan como servicios adicionales; dónde y cómo pedirlos está a confirmar [TBV].', ['asiento', 'asientos', 'asistencia', 'mascota', 'mascotas', 'deportivo', 'servicios', 'prioritario', 'embarque'], 'servicios'),
];

let cached: Dataset | null = null;

/** Fixtures + deterministic generated catalog (fixtures first). Pure and memoized. */
export function buildDataset(): Dataset {
  if (cached) return cached;
  const reserved = new Set(FIXTURE_BOOKINGS.map((b) => b.pnr).concat(FIXTURE_SCENARIOS.map((s) => s.pnr)));
  const generated = generateScenarios(undefined, reserved);
  cached = {
    flights: [...FIXTURE_FLIGHTS, ...generated.flights],
    bookings: [...FIXTURE_BOOKINGS, ...generated.bookings],
    scenarios: [...FIXTURE_SCENARIOS, ...generated.scenarios],
    policy_snippets: POLICY_SNIPPETS,
  };
  return cached;
}

export const hashDataset = (d: Dataset = buildDataset()): string => datasetHash(d);
