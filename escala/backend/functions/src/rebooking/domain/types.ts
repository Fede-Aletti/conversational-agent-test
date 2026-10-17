import type { ChangeType } from '../../shared/types';

export interface PaymentBreakdown {
  fee_ars: number;
  fare_difference_ars: number;
  ancillary_reissue_ars: number;
}

export interface Payment {
  simulated: true;
  total_ars: number;
  breakdown: PaymentBreakdown;
}

export interface AncillaryOutcomeView {
  type: string;
  outcome: 'transfers' | 'transfers_with_fee' | 'not_transferred' | 'needs_review';
  note: string;
}

export interface PassengerImpact {
  passenger_id: string;
  requires_checkin_cancellation: boolean;
  ancillaries: AncillaryOutcomeView[];
}

export interface LegView {
  flight_number: string;
  date: string;
  origin: string;
  destination: string;
  dep: string;
  arr: string;
}

export interface QuoteRecord {
  quote_id: string;
  pnr: string;
  booking_version: number;
  change_type: ChangeType;
  disruption_type: string;
  option_id: string;
  replace_from: number;
  legs: Array<LegView & { seats_at_quote: number | null; price_ars: number }>;
  party_size: number;
  per_passenger: PassengerImpact[];
  payment: Payment;
  created_ms: number;
  expires_ms: number;
  expires_at: string;
  status: 'open' | 'executed';
  rebooking_id?: string;
}

export interface RebookingRecord {
  rebooking_id: string;
  quote_id: string;
  pnr: string;
  idempotency_key: string;
  change_type: ChangeType;
  created_ms: number;
  response: Record<string, unknown>;
}

export interface IdempotencyRecord {
  key: string;
  fingerprint: string;
  response: Record<string, unknown>;
}
