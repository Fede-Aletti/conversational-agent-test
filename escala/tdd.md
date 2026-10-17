# Technical Design Document (TDD) - Escala

> Living document. Update the TDD first, then update tests/evals to match.
> Mode: draft from requirements. Sources: `escala/sources/prd.md` (functional PRD, Spanish, + English "Engineering assumptions" appendix), `escala/sources/project-context.md` (fixed decisions + credit policy), `TESTING.md` (offline harness). **Revision 2:** product-owner-approved architecture direction supersedes the appendix rows "Booking backend", "Policy knowledge", "Operation safety" (in-session Python tools / `_sim_state`).
> Artifact language: English. Agent-facing instructions and every customer-visible string: Spanish (Argentina), professional tone, voseo, voice-friendly (short turns, no markdown dependence).

## Guiding principle

**The LLM is the last resort.** Anything code can decide lives in a real backend: identification, impact of a disruption on the whole itinerary, eligible alternatives (deadline + seats for all passengers), per-passenger constraints (check-in), ancillary outcomes, fees/fare differences, voluntary vs involuntary classification, quote expiry, idempotency, simulated failures. The LLM is left with: understanding the request, asking for the minimum missing data, explaining backend results in natural Spanish, getting the passenger's explicit decision, and open-ended FAQ phrasing.

## Agent Design

### Architecture

- **App:** `projects/gen-lang-client-0907599903/locations/us/apps/escala`; local dir `escala/cxas_app/escala/`. **Channels:** text and voice, one app. Default eval modality `text`. Voice-ready: short turns, PNR read back letter by letter, option ids "A/B/C". Live/audio model not specified by sources: platform default (see Known Issues). Time zone `America/Argentina/Buenos_Aires`.
- **Two deployables:** (1) CES app (3 agents + one OpenAPI toolset + 1 thin Python tool + callbacks), (2) Firebase backend in `escala/backend/` (below).

```
Passenger (text/voice)
   -> CES app `escala`
        root_agent ──transfer──> disruption_rebooking_agent ──transfer──> handoff_agent
            └──────────────────────transfer─────────────────────────────────^
        OpenAPI toolset `escala_api` (service-agent ID token)  + before/after_tool callbacks
   -> Cloud Function `api` (HTTPS, Express, Firebase 2nd gen, TypeScript)
        bounded contexts: bookings | operations | ancillaries | policy-rules | handoff
   -> Firestore (seeded synthetic data, quotes, idempotency ledger, handoff cases)
   -> Vertex AI Search data store (aerolineas.com.ar pages) - FAQ only, behind /policies/faq
```

| Agent | Journey owned | Tools |
|---|---|---|
| `root_agent` | Greeting + experimental disclaimer, identification (PNR + surname, fallback surname + date + route), open FAQ, triage. Never decides anything the backend can decide. | `escala_api_lookupBooking`, `escala_api_searchFaq` |
| `disruption_rebooking_agent` | Entire disruption -> options -> read-back -> confirmation -> result journey (voluntary changes too). Answers baggage/ancillary questions inline from backend data and FAQ without leaving. | `lookupBooking`, `getFlightStatus`, `getRebookingOptions`, `createRebooking`, `searchFaq` (all `escala_api_*`), `record_quote_confirmation` (Python), `end_session` |
| `handoff_agent` | Builds the handoff case with full context, tells the passenger they will not repeat themselves, closes. Terminal agent. | `escala_api_createHandoffCase`, `set_session_outcome` (Python), `end_session` |

**Why journey-based agents, not per-domain agents (bookings / operations / ancillaries / policies):** the backend already unifies the domains behind functional endpoints, so a domain split in the LLM layer would add routing LLM calls and context loss with no decision left to specialise on. The design guide recommends isolating sub-agents "to specific use cases that reflect the customer journey to minimize a sub-agent handing off to another sub-agent (which will introduce context loss)" (gecx-design-guide.md, "Using the multi-agent framework") and lists the booking-style flow split across agents as a bad example (flow fragmentation, context degradation, experience disruption). Latency is also named as a multi-agent limitation, hence only 3 agents.

**Why a separate `handoff_agent` (vs. a tool on each agent):** handoff is reachable from root and from the rebooking journey (policy block, no alternatives, outage, destination change, explicit human request), so it is a reusable sub-agent (guide: "Build sub-agents that can be re-used across multiple intents"). It is terminal (no return transfer), so it adds one transfer but no ping-pong, and one place guarantees a complete case plus a deterministic closing. Context travels in the shared conversation + `active_pnr`; the backend enriches the case from Firestore, so the LLM only supplies `reason` and a short `summary`.

- `childAgents` must use directory names with underscores: root -> `["disruption_rebooking_agent", "handoff_agent"]`; `disruption_rebooking_agent` -> `["handoff_agent"]`.

### Backend (Firebase, `escala/backend/`)

**Stack:** Cloud Functions for Firebase 2nd gen, TypeScript, Node 20+, one HTTPS function `api` (Express router), Firestore (Native mode) on GCP project `gen-lang-client-0907599903`. Region: `us-central1` (closest Cloud Functions/Firestore region to the CES `us` location; confirm at deploy). Tests: vitest (domain + application with in-memory adapters), Firebase Emulator Suite (Firestore adapter + HTTP integration).

**Hexagonal layout by bounded context** (domain has no Firebase imports):

```
escala/backend/
  firebase.json  .firebaserc  package.json  tsconfig.json  vitest.config.ts
  functions/src/
    index.ts                      # exports `api` (composition root: wires adapters)
    http/                         # Express routes, request validation, response envelope, openapi.yaml source
    shared/                       # Clock port (simulatedToday + wallClock), ids, Result/Err types, idempotency port
    bookings/      domain/ application/ ports/ adapters/{memory,firestore}/   # lookup, identification, itinerary model
    operations/    ...                                                        # flight status, disruption impact, alternatives search, failure simulation
    ancillaries/   ...                                                        # transfer outcomes per service
    policy-rules/  ...                                                        # fare families, fees, classification, check-in rules, quote TTL, FAQ port (Vertex adapter + curated fallback)
    handoff/       ...                                                        # case creation + context assembly
    rebooking/     ...                                                        # orchestrating use cases: GetRebookingOptions, CreateRebooking (quotes + execution), uses the contexts above through ports
  seed/            dataset.ts, seed.ts (--reset, --emulator|--project), refuses non-allowlisted projects
  test/            unit/ (vitest, memory adapters)   integration/ (emulator)   contract/ (OpenAPI vs responses)
```

(`rebooking` is an application-layer orchestration module that composes the five bounded contexts; it contains no rules of its own.)

**Response envelope.** Domain outcomes (not found, blocked, stale quote, simulated timeout) return **HTTP 200** with `{"status": "error", "error_code": "...", "retryable": bool, "agent_action": "<Spanish-ready instruction>"}`; success returns `{"status": "ok", ...}`. HTTP 4xx/5xx is reserved for malformed requests, auth failures, and real faults. Rationale: predictable tool results for the model and for offline tests; verify at build how CES surfaces non-2xx (Known Issues).

**Clocks.** `simulatedToday` is a fixed constant `2026-11-12` (Thursday) so "hoy/mañana" and the seeds are reproducible; the backend resolves `deadline: "tomorrow"` itself. `wallClock` is real time and drives quote expiry only. The LLM never computes dates.

**REST API (OpenAPI operationIds are the CES tool names; each is a functional endpoint):**

| Method + path | operationId | Behaviour (all decisions in code) |
|---|---|---|
| `GET /bookings/lookup?last_name=&pnr=` or `&flight_date=&origin=&destination=` | `lookupBooking` | Normalizes case/spaces/hyphens/diacritics; identifies by PNR+surname, else fallback (surname+date+route). Returns a **trimmed** booking: passengers (`P1`,`P2`, check-in state), segments with status, `connection_status`, per-passenger fare family, ancillaries (type, segments, paid), `disruption` summary (affected segments, `change_type_hint`). Not found -> `BOOKING_NOT_FOUND` (+ `agent_action`: re-check code, offer fallback, then handoff). |
| `GET /flights/{flight_number}/status?date=` | `getFlightStatus` | Static schedule status + delay minutes; simulated failure mode (see dataset) -> `UPSTREAM_TIMEOUT`, `retryable: true`. |
| `POST /disruptions/{pnr}/options` body `{deadline?: "today"\|"tomorrow"\|"YYYY-MM-DD", target_date?: "YYYY-MM-DD", destination?: "IATA"}` | `getRebookingOptions` | Orchestrates: load booking -> classify (`involuntary` if a segment is cancelled, delayed >= 120 min [synthetic threshold], or the connection is broken; else `voluntary`) -> compute impact on the whole itinerary -> search flights origin(first impacted segment)->final destination -> filter by deadline and **seats for all passengers** -> apply per-passenger rules (check-in cancellation required, fare family permission) and ancillary outcomes -> price (fee + fare difference) -> rank. Returns `{change_type, resolved_deadline_date, party_size, options:[{option_id, rank, legs[], arrival, arrives_by_deadline, fits_party, seats_available, executable, quote_id, expires_at, per_passenger:[{passenger_id, requires_checkin_cancellation, ancillaries:[{type, outcome, note}]}], fee_total_ars, fare_difference_ars, total_to_pay_ars}], options_after_deadline:[...], blocking_reasons:[...], next_availability}`. **One quote per executable option** (each option carries its own `quote_id`; deviation from a single quote for the whole list because a quote must snapshot a specific itinerary and price). Options that do not fit the whole party are listed with `executable:false`, no `quote_id`. `destination` different from the booking -> `DESTINATION_CHANGE_NOT_SUPPORTED`. Quote persisted with TTL `QUOTE_TTL_MIN = 15`. |
| `POST /rebookings` body `{quote_id, confirmed, idempotency_key}` | `createRebooking` | Two-phase execution. `confirmed` must be literally `true` else `CONFIRMATION_REQUIRED` (no side effects). Validates quote exists/not expired (`QUOTE_EXPIRED`), **re-checks seats** (`QUOTE_STALE` if changed), then in one Firestore transaction: cancels check-in where required (simulated), re-issues segments, applies ancillary outcomes, writes the rebooking, marks quote `executed`. Verifies by read-after-write and returns `{rebooking_id, confirmation_code, verified:true, new_itinerary, per_passenger:[{..., checkin_cancelled, action_required:"redo_checkin"}], ancillaries:[{passenger_id, type, outcome, note}], pending:[...]}`. Simulated payment: no charge; total echoed. |
| `POST /handoff-cases` body `{reason, summary, pnr?, idempotency_key}` | `createHandoffCase` | Backend assembles context (booking snapshot, quotes offered/executed, rebooking status, reason codes) + LLM `summary`; returns `{case_id}` (deterministic `HC-` + 6 hex of sha1(key)). Idempotent. |
| `GET /policies/faq?q=` | `searchFaq` | Open-ended FAQ: queries the Vertex AI Search data store (Discovery Engine) over aerolineas.com.ar pages and returns `{answers:[{text, title, source_url}], source:"vertex_ai_search"\|"curated_fallback", as_of, verified}`. Falls back to curated snippets (dataset below) when `FAQ_DATASTORE_ID` is unset, the call fails/times out, or no result. Decision-grade rules (fees, change permissions, transfer rules) are **never** answered from FAQ; they come from `policy-rules` via the other endpoints. |

**Idempotency and two-phase confirmation (code, not prompt):**

1. Phase 1 `getRebookingOptions` issues `quote_id` (snapshot of itinerary, passenger conditions, price, seat counts, `expires_at`).
2. Phase 2 `createRebooking` requires `quote_id` + `confirmed:true` + `idempotency_key` (`MISSING_IDEMPOTENCY_KEY` otherwise; format `rebook-<quote_id>`).
3. Ledger collection `idempotency/{key}` stores request fingerprint + response. Same key + same payload -> stored response with `already_applied:true`. Same key + different payload -> `IDEMPOTENCY_KEY_REUSED`. A different key for an already-executed quote -> stored result, `already_applied:true, matched_by:"quote_id"`.
4. Check-in cancellation is part of the same transaction (no LLM sequencing, no partial failure between "cancel check-in" and "rebook"). Partial-party rebooking is not supported (quote covers the whole party); such requests go to handoff.
5. `createHandoffCase` also requires `idempotency_key` (`handoff-<PNR|NOPNR>-<n>`).

**Rules module (`policy-rules`), synthetic and data-free of LLM:**
- Fare families: `ECO_FLEX` voluntary change allowed (fee ARS 25,000/pax + fare difference); `ECO_BASIC` voluntary change **blocked** (`POLICY_FARE_NOT_CHANGEABLE`); both free on involuntary change (same destination, difference 0).
- Ancillary transfer rules: `extra_bag` involuntary `transfers`, voluntary `transfers_with_fee` (re-issue ARS 10,000 per bag); `seat_selection` always `not_transferred` (reselect at check-in; refund handled by a human).
- Config flags: `voluntary_changes_enabled` (default **true**, see Open Questions), `QUOTE_TTL_MIN=15`, `DELAY_INVOLUNTARY_MIN=120`, `MIN_CONNECTION_MIN=60`.
- Fare difference: `max(0, sum(new leg prices) - sum(original leg prices))` per passenger for voluntary; 0 for involuntary.

**Infra prerequisites - deploy-time checks, not assumptions** (each is verified by a command/console check before first deploy; record result in Known Issues/Changelog):
1. Firebase added to GCP project `gen-lang-client-0907599903` (`firebase projects:list`; add Firebase if absent).
2. **Blaze (pay-as-you-go) plan** enabled - required to deploy 2nd gen functions (billing owner must approve; see Open Questions).
3. APIs enabled: Cloud Functions, Cloud Run, Cloud Build, Artifact Registry, Firestore, Eventarc (if requested by the deploy), Secret Manager (if API-key auth fallback is used), Discovery Engine (Vertex AI Search) (`gcloud services list --enabled`).
4. Firestore database created in Native mode; location is **immutable** once created -> choose deliberately (`us-central1` regional vs `nam5` multi-region) and confirm it is allowed/available for the project.
5. Functions region `us-central1` (or closest available to the CES `us` location); Node 20+ runtime available; `firebase-tools` version compatible; Java present for the emulator.
6. Deployer IAM sufficient (Functions/Run admin, Service Account User, Datastore/Firestore owner).
7. **Invoker access for CES:** 2nd gen functions run on Cloud Run; grant the invoker role to the principal CES uses for `serviceAgentIdTokenAuthConfig`. The exact CES service agent principal must be identified in the project at deploy time (do not assume its name). Fallback auth: `apiKeyConfig` with a Secret Manager key validated by the function.
8. Seed target safety: `seed.ts` only runs against the emulator or an allowlisted project id.

### CES integration

- **Toolset:** `toolsets/escala_api/escala_api.json` (`openApiToolset.openApiSchema` -> `toolsets/escala_api/open_api_toolset/open_api_schema.yaml`, `apiAuthentication.serviceAgentIdTokenAuthConfig: {}`; fallback `apiKeyConfig`). Schema is generated from/validated against `functions/src/http/openapi.yaml`; every operation has an explicit unique `operationId` and a semantically rich `description` (guide: "descriptions are instructions"). Assigned per agent via the agent JSON `toolsets` array with `toolIds` restricting each agent to its operations. Resulting tool names follow `{toolset}_{operationId}` (verify exact names with `retrieveTools` at build, since callbacks key on them).
- **No Python wrapper tools for trimming/chaining:** the backend returns minimal, functional responses (guide: "Prefer toolset wrappers for latency/data reduction" applies to raw third-party APIs; here we own the API). The only Python tools are state-only: `record_quote_confirmation(quote_id)` and `set_session_outcome(outcome)`.
- **Removed:** the in-session `_sim_state` JSON ledger and all in-session data/rules tools from revision 1.

### Routing Logic

PRD defines no routing rules explicitly; proposal from PRD 4 and 7:
- `root_agent`: greeting + disclaimer; open FAQ via `searchFaq` (answer with citation, hedge "según la información pública de referencia, a confirmar en aerolineas.com.ar"); identification via `lookupBooking`; any booking-specific incident/change/baggage-on-my-booking -> transfer to `disruption_rebooking_agent` with `active_pnr` already set; explicit human request or unresolvable -> `handoff_agent`.
- `disruption_rebooking_agent`: owns the journey end to end. Interruptions (baggage question) answered inline from `lookupBooking` ancillaries or `searchFaq`, then resume the pending step. Triggers to `handoff_agent`: `DESTINATION_CHANGE_NOT_SUPPORTED`, `POLICY_FARE_NOT_CHANGEABLE` (after explaining), empty options and the passenger declines the later flight, second consecutive `UPSTREAM_TIMEOUT`, explicit human request, partial-party request.
- Outage rule (instruction, backed by `retryable`/`agent_action`): retry the same call once; if it fails again, say plainly the system is not responding, never guess status or availability, offer handoff.
- Context change mid-conversation: keep `active_pnr` and facts; call `getRebookingOptions` again (this invalidates earlier quotes in the callback state); never re-ask known data.
- The agent presents only what the backend returned; `executable:false` options are explained but never offered for confirmation.

### Variables

| Variable | Schema | Source | Notes |
|---|---|---|---|
| `channel` | string `text`/`voice` | Session parameter (optional) | Tone only. |
| `active_pnr` | string | Set by `after_tool` callback on `lookupBooking` success | Context continuity across transfers/interruptions. Tests may seed it. |
| `offered_quotes` | JSON `{quote_id: expires_at}` | Set by `after_tool` callback on `getRebookingOptions` (replaces previous) | **NEVER override in evals.** |
| `confirmed_quote_id` | string | Set by Python tool `record_quote_confirmation` after the passenger's explicit yes; cleared by `after_tool` on `getRebookingOptions` and on `createRebooking` | **NEVER override in evals.** |
| `session_outcome` | `resolved`/`handed_off`/`failed` | `after_tool` on `createHandoffCase` -> `handed_off`; `set_session_outcome` for `resolved`/`failed` | Analytics (appendix "Metrics"). |
| `_disclaimer_shown` | bool | `after_model` callback | **NEVER override in evals.** |

Removed: `sim_today` (backend resolves dates), `_sim_state` (backend ledger).

### Callbacks

| Callback | Agent(s) | Purpose / justification |
|---|---|---|
| `before_tool` `guard_mutating_calls` | `disruption_rebooking_agent` | **Defense in depth** (backend remains authoritative). For `escala_api_createRebooking`: short-circuit with `{"status":"error","error_code":"CONFIRMATION_REQUIRED","agent_action":"..."}` unless `confirmed_quote_id == input.quote_id` and `quote_id in offered_quotes` and `input.confirmed is True`. Prevents the model from executing before the passenger confirmed the *current* quote. Limitation: `record_quote_confirmation` is itself LLM-called, so this narrows but does not eliminate the model-skips-consent risk; the backend rejects `confirmed:false`/expired/stale/unknown quotes regardless. |
| `after_tool` `track_state` | `root_agent`, `disruption_rebooking_agent`, `handoff_agent` | On `lookupBooking` ok -> `active_pnr`; on `getRebookingOptions` ok -> `offered_quotes` (reset `confirmed_quote_id`); on `createRebooking` ok -> clear `confirmed_quote_id`; on `createHandoffCase` ok -> `session_outcome="handed_off"`. State bookkeeping that code can do. |
| `after_model` `inject_disclaimer` | all three | Prepend the fixed Spanish experimental disclaimer once (flag `_disclaimer_shown`), only when the response has text. Appendix "Experimental disclaimer". |

No `before_agent` (clock moved to backend). No `before_model` trigger pattern. Callback code must use `tool.name` matching verified from the platform (guide: wrong tool names fail before `try/except`). All strings Spanish (AR, voseo).

### Instruction outline (agent-facing, Spanish at build time)

- Persona: asistente experimental, voseo, cordial, concreto, turnos cortos; dates/amounts in natural spoken form; one question at a time; PNR read back letter by letter; never read internal ids except `confirmation_code` and `case_id`.
- Ask only for what identifies the booking. Present backend options ranked as returned, with differences and limits (e.g. "la opción C sólo tiene un asiento, no entran los dos").
- Before `createRebooking`: read back, per passenger, new flights, what happens to check-in, which extras transfer / transfer with fee / do not, and total to pay (simulated); obtain explicit "sí"; call `record_quote_confirmation(quote_id)`; then `createRebooking` with `confirmed=true` and `idempotency_key="rebook-<quote_id>"`. A second "sí" for an executed quote is answered from `already_applied`.
- After execution: new itinerary, ancillary outcomes per passenger, what is still pending (e.g. redo check-in, reselect seat). Never claim anything the response does not state.
- Distinguish confirmed vs pending vs unknown; FAQ answers carry the source and the "needs verification" caveat when `verified:false`.
- Close: `set_session_outcome` (or handoff path), farewell, `end_session`.

---

## Synthetic Dataset (seed source of truth: `escala/backend/seed/dataset.ts`)

Simulated "today": **2026-11-12 (Thursday)**; "mañana" = 2026-11-13. All flight numbers, PNRs, names and prices are **fictitious** (`AR` prefix for realism only; no relation to real operations). Currency ARS. Local times (America/Argentina/Buenos_Aires). Loaded into Firestore collections `flights`, `bookings` (passengers/segments/ancillaries embedded), `policy_snippets`; runtime collections `quotes`, `rebookings`, `idempotency`, `handoff_cases`. The single TypeScript dataset removes the duplication risk of revision 1. Simulated failure modes live in data: `bookings/SV2T7K.failure_mode` and `flights/AR1698.failure_mode = {endpoints:[...], mode:"always_timeout"}`.

### Flights (economy seats; price = synthetic per-passenger leg price)

| Flight | Route | Date | Dep-Arr | Status | Seats | Price ARS | Used by |
|---|---|---|---|---|---|---|---|
| AR1561 | COR->AEP | 2026-11-12 | 07:10-08:35 | **cancelled** | - | 60,000 | Demo (orig. seg 1) |
| AR1692 | AEP->BRC | 2026-11-12 | 10:20-12:35 | scheduled (connection broken) | 12 | 110,000 | Demo (orig. seg 2) |
| AR1563 | COR->AEP | 2026-11-12 | 11:30-12:55 | scheduled | 6 | 60,000 | Demo same-day option, leg 1 |
| AR1696 | AEP->BRC | 2026-11-12 | 15:40-17:55 | scheduled | **1** | 110,000 | Demo same-day option, leg 2 |
| AR1565 | COR->AEP | 2026-11-13 | 07:00-08:25 | scheduled | 9 | 60,000 | Demo next-morning option, leg 1 |
| AR1694 | AEP->BRC | 2026-11-13 | 09:50-12:05 | scheduled | 6 | 110,000 | Demo next-morning option, leg 2 |
| AR1880 | COR->BRC (direct, synthetic route) | 2026-11-13 | 09:15-11:40 | scheduled | **2** | 150,000 | Demo direct option |
| AR1698 | AEP->BRC | 2026-11-12 | 13:00-15:15 | scheduled (status/options **simulated timeout**) | 8 | 110,000 | Timeout scenario |
| AR1301 | MDZ->AEP | 2026-11-12 | 09:00-10:50 | **cancelled** | - | 70,000 | No-alternatives |
| AR1306 | MDZ->AEP | 2026-11-15 | 09:00-10:50 | scheduled | 5 | 70,000 | No-alternatives (after deadline) |
| AR1700 | AEP->MDZ | 2026-11-12 | 18:00-19:50 | **cancelled** | - | 70,000 | Duplicate confirmation |
| AR1702 | AEP->MDZ | 2026-11-12 | 20:30-22:20 | scheduled | 9 | 70,000 | Duplicate confirmation |
| AR1710 | AEP->MDZ | 2026-11-14 | 08:00-09:50 | scheduled | 8 | 70,000 | Fallback lookup |
| AR1850 | AEP->IGR | 2026-11-14 | 08:00-10:05 | scheduled | 10 | 95,000 | Destination change / voluntary |
| AR1852 | AEP->IGR | 2026-11-15 | 08:00-10:05 | scheduled | 7 | 105,000 | Voluntary target |
| AR1860 | AEP->IGR | 2026-11-16 | 14:00-16:05 | scheduled | 10 | 90,000 | Policy block |
| AR1862 | AEP->IGR | 2026-11-17 | 14:00-16:05 | scheduled | 10 | 90,000 | Policy block (alt.) |

Minimum connection time 60 min (same-day: 12:55 -> 15:40 ok; next morning: 08:25 -> 09:50 ok).

**Expected backend output for demo `RMR4TX`, `deadline: "tomorrow"` (2026-11-13), party of 2, `change_type: involuntary`, fee/difference 0:**

| Option (ranked) | Itinerary | Arrival BRC | Seats vs party | executable |
|---|---|---|---|---|
| A | AR1880 direct | 2026-11-13 11:40 | 2 of 2 | true (quote) |
| B | AR1565 + AR1694 via AEP | 2026-11-13 12:05 | 9 / 6 | true (quote) |
| C | AR1563 + AR1696 same day via AEP | 2026-11-12 17:55 | AR1696 has 1 seat for 2 | **false** (no quote; explain split-party limitation; partial-party rebooking unsupported -> handoff) |

Per-passenger for A/B: P1 no check-in cancellation, bag `transfers`; P2 `requires_checkin_cancellation: true`, bag `transfers`, seats `not_transferred`, `action_required: redo_checkin`.

### Bookings (seeds)

| PNR | Surname | Pax (check-in) | Itinerary | Fare | Ancillaries | Scenario |
|---|---|---|---|---|---|---|
| **RMR4TX** | Romero | P1 Valentina Romero (not checked in); P2 Joaquín Benítez (**checked in**) | AR1561 COR->AEP -> AR1692 AEP->BRC, 2026-11-12 | ECO_FLEX both | P1 `extra_bag` both segs (ARS 38,000); P2 `extra_bag` both segs (ARS 38,000) + `seat_selection` 12A / 12C (ARS 9,000) | **Main demo (PRD 5)** + two passengers with different conditions. Either surname identifies the booking. |
| **QWE4RT** | (nonexistent) | - | - | - | - | **Booking not found** (PRD 7). |
| **LQ3W9D** | Ferreyra | P1 Marcos Ferreyra | AR1710 AEP->MDZ, 2026-11-14 | ECO_FLEX | none | **Fallback lookup**: wrong PNR (e.g. `LQ3W9B`) -> `BOOKING_NOT_FOUND`; then surname + 2026-11-14 + AEP->MDZ succeeds. |
| **NV8C5R** | Sosa | P1 Camila Sosa | AR1850 AEP->IGR, 2026-11-14 (on time) | ECO_FLEX | `extra_bag` (ARS 38,000) | **Voluntary change + destination change** (PRD 7): `target_date 2026-11-15` -> option AR1852, fee 25,000 + difference 10,000 + bag re-issue 10,000 = **45,000**, executable (if flag on). Then `destination:"USH"` -> `DESTINATION_CHANGE_NOT_SUPPORTED`; agent keeps context, explains, offers handoff. |
| **TB6H1Y** | Molina | P1 Ramiro Molina | AR1301 MDZ->AEP, 2026-11-12 (**cancelled**) | ECO_FLEX | none | **No alternatives** (PRD 7): `options: []`, `options_after_deadline:[AR1306 2026-11-15]` (with quote, `arrives_by_deadline:false`), `next_availability`. Agent never invents options. |
| **SV2T7K** | Quiroga | P1 Elena Quiroga | AR1698 AEP->BRC, 2026-11-12 | ECO_FLEX | none | **Service timeout** (PRD 7): `getFlightStatus(AR1698)` and `getRebookingOptions(SV2T7K)` always return `UPSTREAM_TIMEOUT`; `lookupBooking` and `searchFaq` still work. |
| **DP4N8S** | Luna | P1 Tomás Luna | AR1700 AEP->MDZ, 2026-11-12 (**cancelled**) | ECO_FLEX | `extra_bag` | **Duplicate confirmation** (PRD 7): one option via AR1702; second `createRebooking` (same or different key) returns the same `confirmation_code`, `already_applied:true`. |
| **PB9K4Z** | Giménez | P1 Sofía Giménez | AR1860 AEP->IGR, 2026-11-16 (on time) | **ECO_BASIC** | none | **Policy blocks change** (PRD 7): voluntary request -> `blocking_reasons:[POLICY_FARE_NOT_CHANGEABLE]`, no quote; agent explains with FAQ citation and offers handoff. |

**Human handoff (PRD 7):** may occur anywhere; primary tests: `RMR4TX` after options were shown, and with no PNR identified (`pnr` omitted). **Interruption (PRD 7):** during `RMR4TX` options the passenger asks about extra baggage; the agent answers from ancillaries/`searchFaq` and resumes without re-identification.

### Curated policy snippets (fallback for `/policies/faq`; Aerolíneas Argentinas public information - placeholder, needs human verification)

Every snippet: placeholder `source_url` under `https://www.aerolineas.com.ar/`, `as_of: "needs verification"`, `verified: false`. Specific figures are `[TBV]` and must not be quoted as facts until a human fills them from the official page. Spanish text is written at build time.

| topic | Summary | source_url (placeholder) |
|---|---|---|
| `baggage_allowance` | Carry-on/checked allowance depends on route and fare family; limits `[TBV]`; excess fee at airport `[TBV]`. | `https://www.aerolineas.com.ar/PLACEHOLDER/equipaje-franquicia` |
| `extra_baggage` | Additional bags can be bought before travel or at airport; price/limits `[TBV]`; tied to the booking. | `https://www.aerolineas.com.ar/PLACEHOLDER/equipaje-adicional` |
| `checkin` | Online check-in opens/closes at set times before departure `[TBV]`; counter check-in available; documents required. | `https://www.aerolineas.com.ar/PLACEHOLDER/check-in` |
| `fare_conditions` | Fare families differ in changes, refunds, baggage, seats; purchased fare rules apply `[TBV]`. | `https://www.aerolineas.com.ar/PLACEHOLDER/condiciones-tarifas` |
| `voluntary_changes_refunds` | Voluntary changes/refunds subject to fare rules, fees, difference `[TBV]`; deadlines `[TBV]`. | `https://www.aerolineas.com.ar/PLACEHOLDER/cambios-devoluciones` |
| `involuntary_changes` | If the airline cancels/significantly changes a flight, passenger may be reaccommodated or request alternatives/refund `[TBV]`; checked-in passengers must check in again on the new flight. | `https://www.aerolineas.com.ar/PLACEHOLDER/cambios-involuntarios` |
| `travel_requirements` | Domestic ID document requirements; minors/special cases `[TBV]`. | `https://www.aerolineas.com.ar/PLACEHOLDER/requisitos-de-viaje` |
| `services` | Ancillary services (seats, special assistance, pets, sports equipment) and where to request them `[TBV]`. | `https://www.aerolineas.com.ar/PLACEHOLDER/servicios` |

**Vertex AI Search data store** (build step, not an assumption): website data store restricted to `aerolineas.com.ar` page patterns; result citation = page URL + title. Whether indexing a third-party domain is permitted for the chosen indexing mode (some modes require domain verification) and acceptable under the site's terms must be checked at creation; if not ready or not allowed, `/policies/faq` runs on curated snippets only (`source:"curated_fallback"`).

---

## Eval Design

> **Credit policy:** platform evals (goldens, sims, `cxas run`, `ci-test`, `run-session`, `llm-lint`) are **DEFERRED** (project-context.md). The Coverage Map keeps the CUJs and the future platform eval type, and defines the **offline substitutes now**:
> **V** = backend unit/application tests, vitest, in-memory adapters (`escala/backend/test/unit/`); **E** = Firebase-emulator integration tests incl. HTTP (`escala/backend/test/integration/`); **K** = OpenAPI contract test (emulator responses validated against `openapi.yaml` and the CES copy); **C** = CES callback tests, pytest (`escala/evals/callback_tests/tests/<agent>/<type>_callbacks/<base>/test.py`, run by `uv run pytest`). Tool-test YAML is only needed for the two Python tools (`record_quote_confirmation`, `set_session_outcome`). Dialogue-quality behaviors (LLM judgment) have no offline substitute and stay deferred.

### Coverage Map

| ID | Requirement (source) | Eval Type (platform, DEFERRED) | Offline substitute (build now) | Rationale | Priority | Severity | Tags |
|---|---|---|---|---|---|---|---|
| CUJ-01 | Main demo: cancelled COR->AEP leg, 2 pax, one checked in, extra bags; resolved in one conversation (PRD 5) | Sim (~16 turns text) + Golden for tool spine | V: options ranking/`fits_party`/per-pax conditions for `RMR4TX`; E: lookup -> options -> rebooking end to end with verified itinerary | Dialogue varies; decisions are code | P0 | NO-GO | `demo, PRD-5` |
| CUJ-02 | No modification without explicit confirmation; two-phase quote (PRD 4.D, 6) | Golden | V/E: `confirmed:false` -> `CONFIRMATION_REQUIRED`, no writes; expired -> `QUOTE_EXPIRED`; seats changed -> `QUOTE_STALE`; unknown quote; **C**: `guard_mutating_calls` blocks without matching `confirmed_quote_id` / non-offered quote / `confirmed` not true, passes otherwise | Enforced in code twice | P0 | NO-GO | `safety, confirmation` |
| CUJ-03 | Duplicate confirmation prevention (PRD 7) | Golden | V/E on `DP4N8S`: same key replay, different key same quote, same key different payload -> `IDEMPOTENCY_KEY_REUSED`; missing key; concurrent double POST (emulator transaction) executes once | Deterministic | P0 | NO-GO | `idempotency, PRD-7` |
| CUJ-04 | Booking not found + recovery (PRD 7) | Sim | V/E: `QWE4RT` -> `BOOKING_NOT_FOUND` + `agent_action`; wrong PNR then fallback on `LQ3W9D`; normalization (`lq3-w9d`, accents) | Dialogue recovery is LLM-judged | P0 | HIGH | `identification` |
| CUJ-05 | Checked-in passenger handled (appendix) | Golden | V/E: `RMR4TX` P2 `requires_checkin_cancellation`; execution result has `checkin_cancelled` and `action_required: redo_checkin`, atomic with rebooking (forced failure mid-transaction leaves check-in unchanged) | Deterministic | P0 | HIGH | `checkin` |
| CUJ-06 | Ancillaries never assumed to transfer (PRD 4.E) | Golden | V: rules table (`extra_bag` involuntary `transfers`, voluntary `transfers_with_fee`, seats `not_transferred`); E: result lists outcome per passenger | Data-driven | P0 | HIGH | `ancillaries, PRD-4E` |
| CUJ-07 | Two passengers, different conditions, seats for all (PRD 7) | Sim | V: option C `fits_party:false`, `executable:false`, no quote; A/B ok; per-pax differences | Multi-constraint reasoning is in code | P0 | HIGH | `multi-passenger` |
| CUJ-08 | No alternatives within deadline (PRD 7) | Sim | V/E `TB6H1Y`: `options:[]`, `options_after_deadline`, `next_availability`; never fabricated flights | Exception handling | P0 | HIGH | `no-alternatives` |
| CUJ-09 | Service outage recovery (PRD 7) | Sim | V/E: `SV2T7K` and `AR1698` -> `UPSTREAM_TIMEOUT retryable:true` with `agent_action`; other endpoints unaffected; K: envelope schema | Seeded failure in backend | P1 | HIGH | `resilience` |
| CUJ-10 | Policy blocks the change (PRD 7) | Golden | V/E `PB9K4Z`: `POLICY_FARE_NOT_CHANGEABLE`, no quote; `createRebooking` with fabricated quote id rejected | Deterministic rule | P0 | HIGH | `policy` |
| CUJ-11 | Destination change mid-conversation (PRD 7) | Sim | V/E `NV8C5R`: voluntary quote 45,000 then `DESTINATION_CHANGE_NOT_SUPPORTED`; **C**: `track_state` keeps `active_pnr`, new options call resets `offered_quotes` and `confirmed_quote_id` | Context handling LLM-judged | P1 | MEDIUM | `context` |
| CUJ-12 | Voluntary change: classification, fee + fare difference (appendix, new) | Golden | V: fee/difference arithmetic, classification thresholds (delay 119 vs 120 min, broken connection), flag `voluntary_changes_enabled=false` -> `executable:false` | Deterministic | P1 | HIGH | `voluntary, pricing` |
| CUJ-13 | Human handoff with context (PRD 4.F, 7) | Sim | V/E: case includes booking snapshot, quotes, reason; `pnr` omitted allowed; idempotent; deterministic `case_id`; **C**: `track_state` sets `session_outcome=handed_off` | Can occur anywhere | P0 | HIGH | `handoff` |
| CUJ-14 | Interruption for baggage question mid-flow (PRD 7) | Sim | V/E: `lookupBooking` exposes ancillaries; `searchFaq` returns citation shape | Continuity LLM-judged | P1 | MEDIUM | `interruption` |
| CUJ-15 | FAQ grounded with citation; fallback when data store not ready (PRD 4.A, appendix) | Sim | V: FAQ port with fake Vertex adapter (hit, empty, timeout -> curated fallback); E: curated path; every answer has `source_url`, `as_of`, `verified` | Wording varies | P1 | MEDIUM | `faq, grounding` |
| CUJ-16 | Experimental disclaimer once (appendix) | Golden | **C**: `inject_disclaimer` prepends once, sets flag, skips non-text responses, no double injection on multi-call turns | Callback-enforced | P1 | MEDIUM | `disclaimer` |
| CUJ-17 | Spanish (AR, voseo), voice-friendly, concise (appendix) | Sim (voice deferred; +4-6 max_turns when run) | none | Style is LLM-judged | P1 | MEDIUM | `style, voice` |
| CUJ-18 | Session outcome set (appendix "Metrics") | Golden | tool-test YAML for `set_session_outcome`; **C** for handoff path | Deterministic | P2 | LOW | `metrics` |
| CUJ-19 | API/tool contract integrity | - | K: OpenAPI contract test; `retrieveTools` check of operationIds vs callback names (manual, once); seed integrity test (every seed PNR resolves, seats non-negative) | Prevents schema/callback drift | P1 | HIGH | `contract` |
| CUJ-20 | Simulated "today"/deadline resolution (PRD 9) | - | V: `"tomorrow"` -> 2026-11-13, `"today"`, ISO passthrough, past date rejected | Deterministic | P2 | LOW | `determinism` |

### Test Data

Seed bookings above are the profiles; no session parameters are required except optional `channel`. Offline tests reset Firestore through `seed.ts --reset` (emulator) or build in-memory fixtures from the same `dataset.ts`.

| Profile | PNR / surname | CUJs |
|---|---|---|
| Main demo | `RMR4TX` / Romero (or Benítez) | 01, 02, 05, 06, 07, 13, 14 |
| Not found / fallback | `QWE4RT`; wrong `LQ3W9B` -> Ferreyra 2026-11-14 AEP->MDZ (`LQ3W9D`) | 04 |
| Voluntary + destination change | `NV8C5R` / Sosa | 11, 12, 06 |
| No alternatives | `TB6H1Y` / Molina | 08 |
| Service timeout | `SV2T7K` / Quiroga | 09 |
| Duplicate confirmation | `DP4N8S` / Luna | 03 |
| Policy block | `PB9K4Z` / Giménez | 10 |

Opening utterance for CUJ-01 (PRD 5, verbatim): "Hola, viajamos dos de Córdoba a Bariloche con escala en Aeroparque. Me cancelaron el primer vuelo y necesito llegar mañana como máximo. Mi pareja ya hizo el check-in y pagamos equipaje adicional. ¿Nos podés cambiar a los dos sin perder lo que pagamos?" Expected spine: ask PNR + surname -> `lookupBooking` -> transfer to `disruption_rebooking_agent` -> `getRebookingOptions(deadline:"tomorrow")` -> present A/B (explain C not possible for both) -> passenger picks -> read-back (P2 check-in cancelled and must be redone, bags transfer, seats lost, total 0) -> explicit yes -> `record_quote_confirmation` -> `createRebooking` -> report result + pending -> `set_session_outcome(resolved)`.

---

## Build Steps (order)

1. **Backend domain + tests first:** scaffold `escala/backend/`; implement bounded contexts, `policy-rules`, `rebooking` use cases against in-memory adapters; vitest suites for CUJ-02/03/05-08/10/12/13/15/20 (TDD).
2. **Firestore adapters + emulator:** implement adapters, `firebase.json` emulator config, `seed.ts` + `dataset.ts`; emulator integration tests (E) incl. transactions and concurrency.
3. **Deploy-time infra checks** (Infra prerequisites list above) - record results; stop if any fails.
4. **Deploy functions + seed** to `gen-lang-client-0907599903`; smoke-test endpoints with the seeded PNRs; configure invoker IAM for CES.
5. **Vertex AI Search data store** (can run in parallel, non-blocking): create over aerolineas.com.ar pages; set `FAQ_DATASTORE_ID`; redeploy. Until ready, FAQ uses curated fallback.
6. **OpenAPI schema:** finalize `openapi.yaml`, contract test (K) against emulator and deployed responses; copy to the CES toolset.
7. **Scaffold CES app:** 3 agents + `escala_api` toolset + two Python state tools + callbacks (`guard_mutating_calls`, `track_state`, `inject_disclaimer`); Spanish instructions; verify tool names via `retrieveTools`.
8. **CES callback tests** (pytest, C) via `uv run pytest`.
9. **Lint:** `uv run cxas lint --app-dir escala/cxas_app/escala` (manual, offline) and `uv run pytest`.
10. **Push:** `uv run cxas push` only after lint passes. Optional once: `uv run cxas test-tools` for the two Python tools (non-LLM).
11. Platform evals (goldens, sims, voice): **deferred**, only on explicit user request.

---

## Pass Rate History

| Date | Goldens | Sims | Backend unit (vitest) | Emulator integration | Callback Tests | Notes |
|------|---------|------|-----------------------|----------------------|----------------|-------|

---

## Known Issues

- Policy snippets are placeholders (fake deep links, `[TBV]` figures); the agent hedges until a human verifies against aerolineas.com.ar. Vertex AI Search indexing of a third-party domain may be restricted or require verification, and may raise terms-of-use questions; fallback keeps FAQ working.
- To verify at build against the platform (local references do not settle them): exact tool names exposed to callbacks for OpenAPI operations (`{toolset}_{operationId}` per the design guide); how CES surfaces non-2xx responses from an OpenAPI tool (hence the HTTP 200 envelope); whether a before-tool callback may short-circuit an OpenAPI tool with a dict (the API reference signature returns `Optional[dict]`, the agent schema lists tool callback arrays); the CES service agent principal for ID-token auth and its invoker role.
- `guard_mutating_calls` depends on `record_quote_confirmation`, which is LLM-called: it is a seatbelt, not proof of passenger consent. The backend `confirmed`/quote/idempotency checks are the enforcement.
- One quote per option (not one for the whole list) so each quote snapshots a specific itinerary and price; quote TTL uses wall-clock time while "today" is simulated.
- Cold starts on 2nd gen functions can add latency (voice dead air); mitigate with `minInstances` only if measured as a problem (cost).
- Partial-party rebooking and multi-quote bundling are out of scope (handoff). Rich UI (cards) out of scope.
- Voice-specific risks (PNR transcription, barge-in, speech rate) are not covered offline; need deferred audio evals.
- Direct COR->BRC `AR1880` is a plausible synthetic route, not verified against the real network.
- Live/audio model not specified by sources; platform default assumed.

---

## Changelog

| Date | Change | Author |
|------|--------|--------|
| 2026-10-17 | Initial requirements-derived TDD draft (sources: prd.md, project-context.md) | tdd-writer |
| 2026-10-17 | Rev 2: Firebase backend (Functions + Firestore) owns all deterministic decisions; OpenAPI toolset; journey-based agents (root / disruption_rebooking / handoff); two-phase quotes with idempotency ledger; before/after_tool callbacks; Vertex AI Search FAQ with curated fallback; removed `_sim_state`/`sim_today`; offline substitutes now vitest/emulator/contract/callback tests; build order updated | tdd-writer |

Review and approve before scaffolding the agent.
