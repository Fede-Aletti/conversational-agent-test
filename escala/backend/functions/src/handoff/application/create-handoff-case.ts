import { buildBookingView } from '../../bookings/application/lookup-booking';
import { normalizePnr } from '../../bookings/domain/normalize';
import { hex6, sha1Hex, stableStringify } from '../../shared/ids';
import { err, ok, type Result } from '../../shared/result';
import type { Deps } from '../../shared/uow';

export interface HandoffInput {
  reason: string;
  summary: string;
  pnr?: string;
  idempotency_key: string;
}

/** Assembles the full context (booking snapshot, quotes, rebookings, reason) so the passenger never repeats themselves. */
export async function createHandoffCase(deps: Deps, input: HandoffInput): Promise<Result<Record<string, unknown>>> {
  if (!input.idempotency_key) return err('MISSING_IDEMPOTENCY_KEY');
  const caseId = `HC-${hex6(input.idempotency_key)}`;
  const pnr = input.pnr ? normalizePnr(input.pnr) : null;
  const fingerprint = sha1Hex(stableStringify({ reason: input.reason, summary: input.summary, pnr }));
  const existing = await deps.repos.handoffs.get(caseId);
  if (existing) {
    if (existing.context.fingerprint !== fingerprint) return err('IDEMPOTENCY_KEY_REUSED');
    return ok({ status: 'ok', case_id: caseId, already_applied: true });
  }
  const booking = pnr ? await deps.repos.bookings.findByPnr(pnr) : null;
  const view = booking ? await buildBookingView(deps, booking) : null;
  const quotes = booking ? await deps.repos.quotes.listByPnr(booking.pnr) : [];
  const rebookings = booking ? await deps.repos.rebookings.listByPnr(booking.pnr) : [];
  await deps.repos.handoffs.save({
    case_id: caseId,
    idempotency_key: input.idempotency_key,
    reason: input.reason,
    summary: input.summary,
    pnr: booking ? booking.pnr : null,
    created_ms: deps.clock.nowMs(),
    context: {
      fingerprint,
      reason_codes: [input.reason],
      pnr_provided: pnr,
      booking_snapshot: view && view.ok ? view.value : null,
      quotes: quotes.map((q) => ({ quote_id: q.quote_id, status: q.status, total_ars: q.payment.total_ars, expires_at: q.expires_at, legs: q.legs.map((l) => l.flight_number) })),
      rebookings: rebookings.map((x) => ({ rebooking_id: x.rebooking_id, quote_id: x.quote_id })),
    },
  });
  return ok({ status: 'ok', case_id: caseId });
}
