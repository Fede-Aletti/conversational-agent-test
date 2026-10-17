export interface ApiError {
  code: string;
  retryable: boolean;
  agent_action: string;
  details?: Record<string, unknown>;
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: ApiError };

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });

/** Catalog of domain error outcomes. `agent_action` is an instruction for the agent (English); the agent answers the passenger in Spanish. */
const CATALOG: Record<string, { retryable: boolean; agent_action: string }> = {
  BOOKING_NOT_FOUND: {
    retryable: false,
    agent_action:
      'Ask the passenger to re-check the booking code and surname once. If still not found, ask for surname, flight date and route and look up again. If that also fails, explain and offer a human handoff.',
  },
  FLIGHT_NOT_FOUND: { retryable: false, agent_action: 'Tell the passenger the flight was not found for that date; ask them to confirm flight number and date.' },
  UPSTREAM_TIMEOUT: {
    retryable: true,
    agent_action:
      'The airline system timed out. Say you are checking, retry the same call once. If it fails again, say plainly the system is not responding, do not guess, and offer a human handoff.',
  },
  UPSTREAM_ERROR: {
    retryable: true,
    agent_action:
      'The airline system returned an internal error. Retry the same call once. If it fails again, say plainly the system is not responding, do not guess, and offer a human handoff.',
  },
  DESTINATION_CHANGE_NOT_SUPPORTED: {
    retryable: false,
    agent_action:
      'Destination changes cannot be done here. Keep the context, explain it, and offer either to keep the date change or a human handoff.',
  },
  INVALID_DATE: { retryable: false, agent_action: 'The requested date is in the past or invalid. Ask the passenger for a valid future date.' },
  TARGET_DATE_REQUIRED: { retryable: false, agent_action: 'Ask the passenger which date they want to travel and call again with target_date.' },
  CONFIRMATION_REQUIRED: {
    retryable: false,
    agent_action: 'Nothing was changed. Read back the new itinerary, check-in effects, extras and total amount, get an explicit yes from the passenger, then call again with confirmed=true.',
  },
  TOTAL_MISMATCH: {
    retryable: false,
    agent_action: 'Nothing was changed. The confirmed total differs from the quoted total. Re-read the quoted total to the passenger and ask them to confirm that exact amount.',
  },
  VOLUNTARY_CHANGES_DISABLED: {
    retryable: false,
    agent_action: 'Voluntary changes are currently disabled. Nothing was changed. Explain it and offer a human handoff.',
  },
  QUOTE_NOT_FOUND: { retryable: false, agent_action: 'The quote does not exist. Get fresh options with getRebookingOptions and start the confirmation again.' },
  QUOTE_EXPIRED: {
    retryable: false,
    agent_action: 'The quote expired. Nothing was changed. Get fresh options, re-read the summary and ask for confirmation again.',
  },
  QUOTE_STALE: {
    retryable: false,
    agent_action: 'Availability changed since the quote. Nothing was changed. Get fresh options, re-read the summary and ask for confirmation again.',
  },
  MISSING_IDEMPOTENCY_KEY: { retryable: false, agent_action: 'Retry with idempotency_key set (format rebook-<quote_id> or handoff-<PNR|NOPNR>-<n>).' },
  IDEMPOTENCY_KEY_REUSED: {
    retryable: false,
    agent_action: 'That idempotency key was already used with a different request. Nothing was changed. Use the key format rebook-<quote_id> (or handoff-<PNR|NOPNR>-<n>) with a key not used for a different request.',
  },
  VERIFICATION_FAILED: {
    retryable: true,
    agent_action: 'The change could not be verified after saving. Do not claim success. Offer a human handoff.',
  },
  INVALID_REQUEST: { retryable: false, agent_action: 'The request is malformed. Fix the parameters and call again.' },
};

export function err(code: string, details?: Record<string, unknown>): Result<never> {
  const entry = CATALOG[code];
  if (!entry) throw new Error(`Unknown error code ${code}`);
  return { ok: false, error: { code, retryable: entry.retryable, agent_action: entry.agent_action, ...(details ? { details } : {}) } };
}
