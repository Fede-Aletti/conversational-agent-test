export type PassengerType = 'adult' | 'minor' | 'infant';
export type FareFamily = 'ECO_BASIC' | 'ECO_PLUS' | 'ECO_FLEX';
export type AncillaryType = 'extra_bag' | 'seat_selection' | 'priority_boarding' | 'pet_in_cabin' | 'sport_equipment';
export type ChangeType = 'involuntary' | 'voluntary';
export type FailureModeKind = 'always_timeout' | 'always_5xx' | 'slow';

export interface FailureMode {
  endpoints: string[];
  mode: FailureModeKind;
}

export interface Flight {
  flight_number: string;
  date: string; // YYYY-MM-DD, local time (America/Argentina/Buenos_Aires)
  origin: string;
  destination: string;
  dep: string; // HH:MM
  arr: string; // HH:MM, same day
  status: 'scheduled' | 'cancelled';
  seats: number | null; // null for cancelled flights
  price_ars: number; // synthetic per-passenger leg price
  delay_min?: number;
  schedule_change_min?: number;
  equipment_downgrade?: boolean;
  failure_mode?: FailureMode;
}

export interface SegmentRef {
  flight_number: string;
  date: string;
}

export interface Passenger {
  passenger_id: string; // P1, P2...
  first_name: string;
  last_name: string;
  type: PassengerType;
  checked_in: boolean;
  fare_family: FareFamily;
}

export interface Ancillary {
  passenger_id: string;
  type: AncillaryType;
  segments: string[]; // flight numbers
  paid_ars: number;
  detail?: string; // e.g. seat "12A"
}

export interface Booking {
  pnr: string;
  passengers: Passenger[];
  segments: SegmentRef[];
  ancillaries: Ancillary[];
  failure_mode?: FailureMode;
  version: number;
  scenario_id?: string;
}

export interface ScenarioProbe {
  /** Parameters a tester sends to getRebookingOptions to exercise the scenario. */
  target_date?: string;
  deadline?: string;
}

export type ExpectedClass =
  | 'no_change_needed'
  | 'blocked_policy'
  | 'no_options'
  | 'only_after_deadline'
  | 'partial_seats_only'
  | 'needs_review'
  | 'options_available'
  | 'failure:timeout'
  | 'failure:5xx';

export interface ExpectedOutcome {
  class: ExpectedClass;
  change_type: ChangeType;
  disruption_type: string;
  party_size: number;
  has_keep_current?: boolean;
  slow?: boolean;
}

export interface ScenarioEntry {
  scenario_id: string;
  type: 'fixture' | 'generated';
  pnr: string;
  surname: string;
  tags: string[];
  exercises: string;
  expected_outcome: ExpectedOutcome | { class: 'booking_not_found' } | { class: 'custom'; note: string };
  probe?: ScenarioProbe;
}

export interface PolicySnippet {
  topic: string;
  title: string;
  text: string;
  keywords: string[];
  source_url: string;
}

export interface Dataset {
  flights: Flight[];
  bookings: Booking[];
  scenarios: ScenarioEntry[];
  policy_snippets: PolicySnippet[];
}
