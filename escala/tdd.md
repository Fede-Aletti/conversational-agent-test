# Technical Design Document (TDD) - Escala

> **Status: Approved by the product owner (2026-10-17), rev 3.** Living document. Update the TDD first, then update tests/evals to match.
> Mode: draft from requirements. Sources: `escala/sources/prd.md` (functional PRD, Spanish, + English "Engineering assumptions" appendix), `escala/sources/project-context.md` (fixed decisions + credit policy), `TESTING.md` (offline harness). **Revision 2:** product-owner-approved architecture direction supersedes the appendix rows "Booking backend", "Policy knowledge", "Operation safety" (in-session Python tools / `_sim_state`).
> Artifact language: English. Agent-facing instructions and every customer-visible string: Spanish (Argentina), professional tone, voseo, voice-friendly (short turns, no markdown dependence).

## Guiding principle

**The LLM is the last resort.** Anything code can decide lives in a real backend: identification, impact of a disruption on the whole itinerary, eligible alternatives (deadline + seats for all passengers), per-passenger constraints (check-in), ancillary outcomes, fees/fare differences, voluntary vs involuntary classification, quote expiry, idempotency, simulated failures. The LLM is left with: understanding the request, asking for the minimum missing data, explaining backend results in natural Spanish, getting the passenger's explicit decision, and open-ended FAQ phrasing.

**The backend is a MOCK** (rev 3): no real airline integration exists or is implied. It simulates an airline's systems deterministically, with a broad scenario catalog (named fixtures + a seeded generator, see Synthetic Dataset) so the conversational layer can be exercised against many situations. Randomness never occurs at runtime.

**Product focus: conversational flows.** The "Conversation flows" section is the contract the scaffolder turns into agent instructions.

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
| `POST /disruptions/{pnr}/options` body `{deadline?: "today"\|"tomorrow"\|"YYYY-MM-DD", target_date?: "YYYY-MM-DD", destination?: "IATA"}` | `getRebookingOptions` | Orchestrates: load booking -> classify (`involuntary` if a segment is cancelled, delayed >= 120 min [synthetic threshold], or the connection is broken; else `voluntary`) -> compute impact on the whole itinerary -> search flights origin(first impacted segment)->final destination -> filter by deadline and **seats for all passengers** -> apply per-passenger rules (check-in cancellation required, fare family permission) and ancillary outcomes -> price (fee + fare difference) -> rank. Returns `{change_type, disruption_type, resolved_deadline_date, party_size (seat-holding passengers; infants excluded), options:[{option_id, rank, legs[], arrival, arrives_by_deadline, fits_party, seats_available, executable, not_executable_reason?, quote_id, expires_at, per_passenger:[{passenger_id, requires_checkin_cancellation, ancillaries:[{type, outcome, note}]}], payment:{simulated:true, total_ars, breakdown:{fee_ars, fare_difference_ars, ancillary_reissue_ars}}}], options_after_deadline:[...], blocking_reasons:[...], next_availability}`. **One quote per executable option** (each option carries its own `quote_id`; deviation from a single quote for the whole list because a quote must snapshot a specific itinerary and price). Options that do not fit the whole party are listed with `executable:false`, no `quote_id`. `destination` different from the booking -> `DESTINATION_CHANGE_NOT_SUPPORTED`. Quote persisted with TTL `QUOTE_TTL_MIN = 15`. |
| `POST /rebookings` body `{quote_id, confirmed, confirmed_total_ars, idempotency_key}` | `createRebooking` | Two-phase execution with simulated payment. `confirmed` must be literally `true` else `CONFIRMATION_REQUIRED` (no side effects). `confirmed_total_ars` must equal the quote's `payment.total_ars` (0 for involuntary) else `TOTAL_MISMATCH`. Voluntary changes are rejected with `VOLUNTARY_CHANGES_DISABLED` when the flag is off. Validates quote exists/not expired (`QUOTE_EXPIRED`), **re-checks seats** (`QUOTE_STALE` if changed), then in one Firestore transaction: cancels check-in where required (simulated), re-issues segments, applies ancillary outcomes, records the simulated payment, writes the rebooking, marks quote `executed`. Verifies by read-after-write and returns `{rebooking_id, confirmation_code, receipt_id, payment:{status:"simulated_paid", total_ars, breakdown}, verified:true, new_itinerary, per_passenger:[{..., checkin_cancelled, action_required:"redo_checkin"}], ancillaries:[{passenger_id, type, outcome, note}], pending:[...]}`. `receipt_id` is deterministic (`RC-` + 6 hex of sha1(quote_id)); no real charge ever occurs. |
| `GET /scenarios?type=&tag=&limit=` | `listScenarios` (**debug, not exposed to CES**) | Lists the scenario catalog (fixtures + generated): `{scenario_id, type, pnr, surname, tags[], exercises, expected_outcome}`. Enabled only when env flag `ENABLE_SCENARIOS_ENDPOINT=true` (default false; deployed demo/test projects only); otherwise `404`. Excluded from the CES OpenAPI schema; same IAM auth as the rest. |
| `POST /handoff-cases` body `{reason, summary, pnr?, idempotency_key}` | `createHandoffCase` | Backend assembles context (booking snapshot, quotes offered/executed, rebooking status, reason codes) + LLM `summary`; returns `{case_id}` (deterministic `HC-` + 6 hex of sha1(key)). Idempotent. |
| `GET /policies/faq?q=` | `searchFaq` | Open-ended FAQ: queries the Vertex AI Search data store (Discovery Engine) over aerolineas.com.ar pages and returns `{answers:[{text, title, source_url}], source:"vertex_ai_search"\|"curated_fallback", as_of, verified}`. Falls back to curated snippets (dataset below) when `FAQ_DATASTORE_ID` is unset, the call fails/times out, or no result. Decision-grade rules (fees, change permissions, transfer rules) are **never** answered from FAQ; they come from `policy-rules` via the other endpoints. |

**Idempotency and two-phase confirmation (code, not prompt):**

1. Phase 1 `getRebookingOptions` issues `quote_id` (snapshot of itinerary, passenger conditions, price, seat counts, `expires_at`).
2. Phase 2 `createRebooking` requires `quote_id` + `confirmed:true` + `idempotency_key` (`MISSING_IDEMPOTENCY_KEY` otherwise; format `rebook-<quote_id>`).
3. Ledger collection `idempotency/{key}` stores request fingerprint + response. Same key + same payload -> stored response with `already_applied:true`. Same key + different payload -> `IDEMPOTENCY_KEY_REUSED`. A different key for an already-executed quote -> stored result, `already_applied:true, matched_by:"quote_id"`.
4. Check-in cancellation is part of the same transaction (no LLM sequencing, no partial failure between "cancel check-in" and "rebook"). Partial-party rebooking is not supported (quote covers the whole party); such requests go to handoff.
5. `createHandoffCase` also requires `idempotency_key` (`handoff-<PNR|NOPNR>-<n>`).

**Rules module (`policy-rules`), synthetic and data-free of LLM:**
- Fare families (Base/Plus/Flex style, names and values **[TBV]**, synthetic): `ECO_BASIC` voluntary change **blocked** (`POLICY_FARE_NOT_CHANGEABLE`); `ECO_PLUS` voluntary allowed (fee ARS 45,000/pax + fare difference); `ECO_FLEX` voluntary allowed (fee ARS 25,000/pax + fare difference); all free on involuntary change (same destination, difference 0).
- Ancillary transfer rules (involuntary / voluntary): `extra_bag` `transfers` / `transfers_with_fee` (ARS 10,000 per bag); `seat_selection` `not_transferred` / `not_transferred` (reselect at check-in; refund by a human); `priority_boarding` `transfers` / `not_transferred`; `sport_equipment` `transfers` / `transfers_with_fee` (ARS 15,000); `pet_in_cabin` `needs_review` / `needs_review` (carrier re-approval needed -> option `executable:false`, `not_executable_reason: ANCILLARY_NEEDS_REVIEW` -> handoff). Infants carry no ancillaries.
- Passenger types: `adult`, `minor` (2-11, **[TBV]**), `infant` (<2, lap, no seat). Seat counts use adults + minors only. Unaccompanied minors are out of scope (handoff).
- Disruption classification: `involuntary` if cancellation, delay >= `DELAY_INVOLUNTARY_MIN` (120), schedule change >= `SCHEDULE_CHANGE_INVOLUNTARY_MIN` (90), missed/broken connection, or equipment downgrade (seat assignments lost; a `keep_current` option is returned alongside alternatives); delay below threshold on all segments with intact connections is informational (`change_type: voluntary`, no rebooking needed).
- Config flags: **`voluntary_changes_enabled` = true by default** (decision closed, rev 3), `ENABLE_SCENARIOS_ENDPOINT` (default false), `QUOTE_TTL_MIN=15`, `DELAY_INVOLUNTARY_MIN=120`, `SCHEDULE_CHANGE_INVOLUNTARY_MIN=90`, `MIN_CONNECTION_MIN=60`.
- Fare difference: `max(0, sum(new leg prices) - sum(original leg prices))` per seat-holding passenger for voluntary; 0 for involuntary. Voluntary quote total = fee + fare difference + ancillary re-issue; shown to the passenger and **confirmed explicitly by amount** before execution.

**Infra prerequisites - deploy-time checks, not assumptions** (each is verified by a command/console check before first deploy; record result in Known Issues/Changelog):
1. Firebase added to GCP project `gen-lang-client-0907599903` (`firebase projects:list`; add Firebase if absent).
2. **Blaze (pay-as-you-go) plan:** required for 2nd gen functions. GCP billing is already enabled on the project (product owner, rev 3); still verify the Firebase plan shows Blaze at deploy.
3. APIs enabled: Cloud Functions, Cloud Run, Cloud Build, Artifact Registry, Firestore, Eventarc (if requested by the deploy), Secret Manager (if API-key auth fallback is used), Discovery Engine (Vertex AI Search) (`gcloud services list --enabled`).
4. Firestore database created in Native mode; location is **immutable** once created -> choose deliberately (`us-central1` regional vs `nam5` multi-region) and confirm it is allowed/available for the project.
5. Functions region `us-central1` (or closest available to the CES `us` location); Node 20+ runtime available; `firebase-tools` version compatible; Java present for the emulator.
6. Deployer IAM sufficient (Functions/Run admin, Service Account User, Datastore/Firestore owner).
7. **Invoker access for CES:** 2nd gen functions run on Cloud Run; grant the invoker role to the principal CES uses for `serviceAgentIdTokenAuthConfig`. The exact CES service agent principal must be identified in the project at deploy time (do not assume its name). Fallback auth: `apiKeyConfig` with a Secret Manager key validated by the function.
8. Seed target safety: `seed.ts` only runs against the emulator or an allowlisted project id.

### CES integration

- **Toolset:** `toolsets/escala_api/escala_api.json` (`openApiToolset.openApiSchema` -> `toolsets/escala_api/open_api_toolset/open_api_schema.yaml`, `apiAuthentication.serviceAgentIdTokenAuthConfig: {}`; fallback `apiKeyConfig`). Schema is generated from/validated against `functions/src/http/openapi.yaml`; every operation has an explicit unique `operationId` and a semantically rich `description` (guide: "descriptions are instructions"). Assigned per agent via the agent JSON `toolsets` array with `toolIds` restricting each agent to its operations. Resulting tool names follow `{toolset}_{operationId}` (verify exact names with `retrieveTools` at build, since callbacks key on them).
- **No Python wrapper tools for trimming/chaining:** the backend returns minimal, functional responses (guide: "Prefer toolset wrappers for latency/data reduction" applies to raw third-party APIs; here we own the API). The only Python tools are state-only: `record_quote_confirmation(quote_id, total_ars)` and `set_session_outcome(outcome)`.
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
| `confirmed_quote_id` | string | Set by Python tool `record_quote_confirmation(quote_id, total_ars)` after the passenger's explicit yes to the quote **and its total amount** (also stores `confirmed_total_ars`); cleared by `after_tool` on `getRebookingOptions` and on `createRebooking` | **NEVER override in evals.** |
| `session_outcome` | `resolved`/`handed_off`/`failed` | `after_tool` on `createHandoffCase` -> `handed_off`; `set_session_outcome` for `resolved`/`failed` | Analytics (appendix "Metrics"). |
| `_disclaimer_shown` | bool | `after_model` callback | **NEVER override in evals.** |

Removed: `sim_today` (backend resolves dates), `_sim_state` (backend ledger).

### Callbacks

| Callback | Agent(s) | Purpose / justification |
|---|---|---|
| `before_tool` `guard_mutating_calls` | `disruption_rebooking_agent` | **Defense in depth** (backend remains authoritative). For `escala_api_createRebooking`: short-circuit with `{"status":"error","error_code":"CONFIRMATION_REQUIRED","agent_action":"..."}` unless `confirmed_quote_id == input.quote_id`, `quote_id in offered_quotes`, `input.confirmed is True` and `input.confirmed_total_ars == confirmed_total_ars == offered total`. Prevents the model from executing before the passenger confirmed the *current* quote. Limitation: `record_quote_confirmation` is itself LLM-called, so this narrows but does not eliminate the model-skips-consent risk; the backend rejects `confirmed:false`/expired/stale/unknown quotes regardless. |
| `after_tool` `track_state` | `root_agent`, `disruption_rebooking_agent`, `handoff_agent` | On `lookupBooking` ok -> `active_pnr`; on `getRebookingOptions` ok -> `offered_quotes` (reset `confirmed_quote_id`); on `createRebooking` ok -> clear `confirmed_quote_id`; on `createHandoffCase` ok -> `session_outcome="handed_off"`. State bookkeeping that code can do. |
| `after_model` `inject_disclaimer` | all three | Prepend the fixed Spanish experimental disclaimer once (flag `_disclaimer_shown`), only when the response has text. Appendix "Experimental disclaimer". |

No `before_agent` (clock moved to backend). No `before_model` trigger pattern. Callback code must use `tool.name` matching verified from the platform (guide: wrong tool names fail before `try/except`). All strings Spanish (AR, voseo).

### Instruction outline (agent-facing, Spanish at build time)

- Persona: asistente experimental, voseo, cordial, concreto, turnos cortos; dates/amounts in natural spoken form; one question at a time; PNR read back letter by letter; never read internal ids except `confirmation_code` and `case_id`.
- Ask only for what identifies the booking. Present backend options ranked as returned, with differences and limits (e.g. "la opción C sólo tiene un asiento, no entran los dos").
- Before `createRebooking`: read back, per passenger, new flights, what happens to check-in, which extras transfer / transfer with fee / do not, and the total to pay (fee + fare difference + re-issue; "simulated", no real charge); obtain an explicit "sí" that restates the total when it is above 0; call `record_quote_confirmation(quote_id, total_ars)`; then `createRebooking` with `confirmed=true`, `confirmed_total_ars` and `idempotency_key="rebook-<quote_id>"`. Report the `receipt_id`. A second "sí" for an executed quote is answered from `already_applied`.
- After execution: new itinerary, ancillary outcomes per passenger, what is still pending (e.g. redo check-in, reselect seat). Never claim anything the response does not state.
- Distinguish confirmed vs pending vs unknown; FAQ answers carry the source and the "needs verification" caveat when `verified:false`.
- Close: `set_session_outcome` (or handoff path), farewell, `end_session`.

---

## Conversation flows

Contract for the scaffolder. Notation: **U** passenger, **A** agent (Spanish AR voseo, short turns; English here is a gist), `op()` = backend call. Fixture PNRs from the Scenario catalog. Flows reference **cross-cutting rules** first.

**Cross-cutting rules (apply to every flow)**
- R1 One question per turn; ask only for what is missing. Never re-ask `active_pnr`, surname or facts already given.
- R2 Never state flight status, availability, price, fee or rule that is not in a backend response. FAQ answers carry source; if `verified:false` add "a confirmar en aerolineas.com.ar".
- R3 Read-back before any execution: per passenger new flights, check-in effect, ancillary outcomes, total amount (simulated, no real charge). Offer only `executable:true` options.
- R4 Corrections: if U corrects PNR/surname/date/deadline/option, re-run the relevant `op()` (new lookup or new `getRebookingOptions`), which invalidates earlier quotes (callback resets `offered_quotes`, `confirmed_quote_id`); say so briefly.
- R5 Interruptions (FAQ, baggage, "what happens to my seat?"): answer inline from `lookupBooking` ancillaries or `searchFaq`, then resume: "Volviendo a tu cambio: ¿te quedás con la opción B?".
- R6 Intent switch: acknowledge, keep context, route by new intent (change -> options again; destination change -> explain + handoff; "never mind" -> close politely, `set_session_outcome`).
- R7 Double confirmation: second "sí"/"confirmá" after execution -> call `createRebooking` again with the same key only if unsure of state; answer from `already_applied:true` ("Ya lo hicimos, tu código sigue siendo X"), never imply a second change.
- R8 Refusal: U declines all options -> no execution; offer later options (`options_after_deadline`), then handoff; U declines the read-back -> back to option choice, nothing executed.
- R9 Handoff on explicit request is immediate (no persuasion); on failure paths first explain exactly what is pending and why, then offer it. Call sequence: transfer to `handoff_agent` -> `createHandoffCase(reason, summary, pnr?, idempotency_key="handoff-<PNR|NOPNR>-<n>")` -> tell U the `case_id` and that they will not need to repeat themselves -> farewell -> `end_session`.
- R10 Outage: `retryable:true` error -> one retry of the same op; second failure -> plain disclosure, no guessing, offer handoff.
- R11 Disclaimer once on the first agent text (callback).

**F-01 Main demo (CUJ-01/05/06/07)** - `RMR4TX`
1. U: opening utterance (PRD 5). A (root): disclaimer + asks PNR and surname. 2. U gives "R M R 4 T X, Romero". A reads PNR back letter by letter only if voice. `lookupBooking(last_name, pnr)` -> sets `active_pnr` -> transfer to `disruption_rebooking_agent` (no re-ask).
3. A confirms understanding in one sentence: AR1561 cancelled, connection lost, 2 pax, P2 checked in, extra bags. `getRebookingOptions(pnr, deadline:"tomorrow")` -> options A (direct 11:40), B (via AEP 12:05), C not executable (1 seat).
4. A presents A and B with differences (direct vs connection, arrival time) and says C does not fit both. 5. U picks A (or asks "¿y si viajo yo sola hoy?" -> R8/partial-party: not supported -> explain, offer handoff or A/B).
6. A read-back (R3): P1 unchanged check-in, bag transfers; P2 check-in will be cancelled and must be redone, bag transfers, seats 12A/12C are not kept, total $0. Asks "¿Confirmo el cambio para los dos?".
7. U "sí" -> `record_quote_confirmation(quote_id, 0)` -> `createRebooking(quote_id, confirmed:true, confirmed_total_ars:0, idempotency_key:"rebook-<quote_id>")` -> result `verified:true`.
8. A reports new itinerary, `confirmation_code`, `receipt_id`, ancillary outcomes per passenger, pending (P2 redo check-in, reselect seat). 9. Anything else? -> `set_session_outcome(resolved)` -> farewell -> `end_session`.
- Branches: interruption on baggage at step 4/6 (R5, `searchFaq("equipaje adicional")` or ancillaries); correction of deadline ("mejor pasado mañana") -> new `getRebookingOptions(deadline:"YYYY-MM-DD")` (R4); `QUOTE_EXPIRED`/`QUOTE_STALE` at step 7 -> re-run options, re-read-back, re-confirm; `CONFIRMATION_REQUIRED` (callback block) -> do the read-back/confirmation properly; double "sí" (R7).

**F-02 Duplicate confirmation (CUJ-02/03)** - `DP4N8S`: lookup -> options (one option AR1702, total 0) -> read-back -> "sí" -> record -> `createRebooking` -> result. U: "sí, confirmá" again -> `createRebooking` same key -> `already_applied:true` -> A repeats the same `confirmation_code`, no new change. Variant: U changes mind after execution ("mejor el vuelo de las 22") -> R6: new `getRebookingOptions` is a *new* change request on the already rebooked booking; if no further options, explain and offer handoff.

**F-03 Booking not found / fallback (CUJ-04)** - `QWE4RT`, `LQ3W9D`
1. U gives code `QWE4RT`+surname -> `lookupBooking` -> `BOOKING_NOT_FOUND`. A: "No lo encuentro; ¿revisás el código? " (one retry). 2. U cannot find it -> A asks surname + flight date + route (one question at a time) -> `lookupBooking(last_name, flight_date, origin, destination)` -> found -> continue (R1: no re-asking). 3. If still not found -> explain, offer handoff with whatever U provided (`pnr` omitted). Branch: U gives a typo'd code `LQ3W9B` (same flow); U refuses to give more -> handoff (R9).

**F-04 Voluntary change with simulated payment (CUJ-12)** - `NV8C5R`
1. U: "quiero pasar mi vuelo del 14 al 15". `lookupBooking` (if not identified) -> `getRebookingOptions(pnr, target_date:"2026-11-15")` -> `change_type: voluntary`, option AR1852, `payment.total_ars = 45000` (fee 25,000 + difference 10,000 + bag re-issue 10,000).
2. A: explains it is a voluntary change with cost, breaks down the three amounts (simulated), what transfers (bag with fee), seat none. Asks "¿Confirmás el cambio por $45.000?".
3. U "sí" -> `record_quote_confirmation(quote_id, 45000)` -> `createRebooking(..., confirmed_total_ars:45000)` -> result with `receipt_id`, `payment.status:"simulated_paid"`.
- Branches: U refuses the price (R8) -> offer other date (`getRebookingOptions` again) or end; U answers "sí" without restating the amount -> agent restates total and asks again (callback blocks otherwise); `TOTAL_MISMATCH` -> re-read quote; flag off -> `VOLUNTARY_CHANGES_DISABLED` -> explain and offer handoff; ECO_BASIC booking -> F-08.

**F-05 Destination change mid-conversation (CUJ-11)** - `NV8C5R`: F-04 step 1 then U: "mejor cambiame el destino a Ushuaia" -> `getRebookingOptions(pnr, destination:"USH")` -> `DESTINATION_CHANGE_NOT_SUPPORTED`. A keeps context (same booking, same passenger), explains it cannot change destination here, offers: keep the date change (back to F-04) or handoff. U picks handoff -> R9. U goes back to date change -> F-04 step 2 (new quote; previous invalid).

**F-06 No alternatives (CUJ-08)** - `TB6H1Y`: lookup -> `getRebookingOptions(deadline:"tomorrow")` -> `options:[]`, `options_after_deadline:[AR1306 11-15]`. A: no flights arrive by tomorrow; the next available is 11-15 (be explicit it misses the deadline); asks if U wants it. U yes -> standard read-back/confirm/execute with its quote. U no -> R8 -> handoff. Never invents options or promises standby.

**F-07 Failure modes (CUJ-09/24)** - `SV2T7K` (timeout), `UE4Q8H` (5xx-like `UPSTREAM_ERROR`), `SL6Y3M` (slow)
- Timeout / 5xx-like: `getFlightStatus` or `getRebookingOptions` -> `retryable:true` error -> filler ("Estoy consultando, un momento") -> one retry (R10) -> second failure: A says the system is not responding, no guess, offers handoff or retry later -> handoff with reason `upstream_failure`, `summary` states what was being attempted.
- Slow (responds after ~8 s): A uses a short filler before the call and presents the result normally; no retry while the call is pending.
- U asks status while the outage lasts: `lookupBooking` and `searchFaq` still work; A answers what it can and labels the rest "pendiente de consulta".

**F-08 Policy blocks the change (CUJ-10)** - `PB9K4Z`: lookup -> `getRebookingOptions(target_date)` -> `blocking_reasons:[POLICY_FARE_NOT_CHANGEABLE]`, no quote. A explains the fare does not allow voluntary changes, cites `searchFaq("cambios tarifa")` with source/caveat, offers handoff. U insists on executing -> A does not try `createRebooking`; U asks for a human -> R9.

**F-09 Human handoff (CUJ-13)**: (a) before identification: "quiero hablar con una persona" -> root transfers -> `createHandoffCase(reason:"user_request", pnr omitted)`; (b) mid-flow after options shown (`RMR4TX`): immediate handoff, summary lists identified booking, options offered, quotes not executed; (c) after a failure path (F-05/06/07/08): A states what is pending, then handoff. In all: tells `case_id` and "no vas a tener que repetir nada"; `session_outcome` = `handed_off`. Repeated request -> idempotent same `case_id`.

**F-10 FAQ and interruptions (CUJ-14/15)**: root answers open questions via `searchFaq(q)`: 1-3 spoken sentences + source name; unverified -> caveat; no result -> "no tengo información confiable" + offer handoff, no invention. Mid-flow baggage question: R5. Question about the booking's own extras ("¿mi equipaje se mantiene?") -> from `lookupBooking` ancillaries + `getRebookingOptions` outcomes, not from FAQ.

**F-11 Flight status / delay inquiry (generated matrix)**: U: "mi vuelo está demorado" -> `lookupBooking` -> `getFlightStatus(flight, date)` -> if delay below threshold and connection intact: inform, no change needed, offer to explore options anyway (voluntary, F-04 path); if above threshold, schedule change, broken connection or equipment downgrade: `getRebookingOptions` (involuntary, F-01 path). Equipment downgrade: tell U seat assignments are lost; offer `keep_current` or alternatives.

**F-12 Special passengers and ancillaries (CUJ-22)**: infant on lap -> not counted for seats, no ancillaries, A mentions the infant stays with the adult on the new flight; minor -> counted for seats; `pet_in_cabin` or other `needs_review` -> option `executable:false` with `ANCILLARY_NEEDS_REVIEW`: A explains why and offers handoff; `sport_equipment` voluntary -> re-issue fee in total; `priority_boarding` voluntary -> "no se transfiere"; international regional (`XN7B2K`): A adds the travel-documents note from `searchFaq("requisitos de viaje")`.

**F-13 Closing and outcome**: after resolution: summary in two sentences (what changed, what is pending), `set_session_outcome(resolved)`, farewell, `end_session`. U leaves midway -> `set_session_outcome(failed)` only if nothing was resolved and no handoff.

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

### Bookings (core named fixtures, detail; full catalog and generator below)

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

### Scenario catalog (mock backend: named fixtures + deterministic generator)

**Named fixtures** are hand-written, keep stable PNRs, and are referenced by tests and Conversation flows. New fixtures need support flights in the `AR9xxx` range defined in `dataset.ts` (same fields as the flights table). PNR alphabet excludes `0/O/1/I`.

| Scenario id | PNR | What it exercises |
|---|---|---|
| FX-DEMO | RMR4TX | Main demo: cancel + broken connection, 2 pax, one checked in, bags + seats; option ranking, split-party option C not executable (F-01) |
| FX-NOTFOUND | QWE4RT | `BOOKING_NOT_FOUND` (F-03) |
| FX-FALLBACK | LQ3W9D | Lookup by surname + date + route after wrong PNR (F-03) |
| FX-VOLUNTARY | NV8C5R | Voluntary change, ECO_FLEX, fee + difference + bag re-issue = 45,000, simulated payment; destination change -> unsupported (F-04, F-05) |
| FX-NOALT | TB6H1Y | Cancelled, no alternatives by deadline, only later flight (F-06) |
| FX-TIMEOUT | SV2T7K | Backend `UPSTREAM_TIMEOUT` on status/options (F-07) |
| FX-DUP | DP4N8S | Single easy option; duplicate confirmation / idempotency (F-02) |
| FX-POLICYBLOCK | PB9K4Z | ECO_BASIC voluntary change blocked (F-08) |
| FX-INFANT | KT5M2V | 1 adult + 1 infant, cancellation; infant excluded from seats and ancillaries (F-12) |
| FX-MINOR | HN7D4C | 2 adults + 1 minor, partial seats (2 of 3 seats on the best option); party-fit logic (F-12) |
| FX-PARTIAL | PS8N4W | 3 adults, one option with 2 seats, one with 3 later; partial seats ranking |
| FX-PET | PW6J8X | `pet_in_cabin` -> `ANCILLARY_NEEDS_REVIEW`, option not executable -> handoff (F-12) |
| FX-SPORT | SQ9R3F | `sport_equipment` + `priority_boarding`, voluntary change with re-issue fee and non-transfer (F-12) |
| FX-PLUS | PL3T5R | ECO_PLUS voluntary change, fee 45,000/pax |
| FX-DELAY-BELOW | DL4B6N | 90 min delay, connection intact: informational, no involuntary change (F-11) |
| FX-DELAY-ABOVE | DL8H2P | 180 min delay: involuntary (F-11) |
| FX-SCHEDCHANGE | SC3K7T | 120 min schedule change: involuntary (F-11) |
| FX-MISSEDCONN | MC5W9G | Seg 1 delayed 100 min (below threshold) breaks the 60 min minimum connection: involuntary by connection rule |
| FX-DOWNGRADE | ED2V6Z | Equipment downgrade: seat assignments lost, `keep_current` + alternatives (F-11) |
| FX-INTL | XN7B2K | Regional international AEP->MVD cancelled; travel-documents FAQ note (F-12) |
| FX-5XX | UE4Q8H | Backend `UPSTREAM_ERROR` (5xx-like, 200 envelope, `retryable:true`) (F-07) |
| FX-SLOW | SL6Y3M | Backend latency ~8 s then success (F-07) |

**Deterministic generator** (`seed/generate.ts`): `generateScenarios(SEED=20261112)` uses a seeded PRNG (mulberry32) and pure functions; the output is a function of the seed only, with no clock or `Math.random` calls, and is written to Firestore by `seed.ts` (runtime handlers only read data). Scenario ids `GEN-0001...`; PNRs derived from the id with a fixed hash into the safe alphabet and checked for collisions with fixtures. A covering design (not the full cross product) builds ~120 bookings so that every pair of the following dimensions co-occurs at least once, plus the full product of the two most behavior-relevant ones:

| Dimension | Values |
|---|---|
| Passengers (1-4) | 1 adult; 2 adults; 2 adults + minor; 3 adults; 2 adults + infant; 4 mixed (adults, minor, infant) |
| Check-in per passenger | none / some / all checked in (per pax flag) |
| Ancillaries | none; `extra_bag`; `seat_selection`; `priority_boarding`; `pet_in_cabin`; `sport_equipment`; combinations (per-pax) with transfer rules above |
| Fare family | `ECO_BASIC`, `ECO_PLUS`, `ECO_FLEX` (names **[TBV]**) |
| Route class | domestic (AEP/COR/BRC/IGR/MDZ/USH pairs); regional international (AEP-MVD, AEP-SCL, AEP-GRU, AEP-ASU) |
| Itinerary shape | direct; one connection |
| Disruption type | cancel; delay below threshold; delay at/above threshold; schedule change; missed connection; equipment downgrade; none (voluntary) |
| Alternatives availability | none; partial seats (< party); plenty; only after deadline |
| Failure mode | none; timeout; 5xx-like; slow (assigned to a small fixed subset, e.g. 1 in 20) |

The full product of **disruption type x alternatives availability** (7 x 4 = 28 combinations) is generated for each of {1 pax, 3 pax} so those two dimensions are exhaustively covered; the other dimensions are assigned by the covering design with the PRNG choosing only among allowed values. Generated flights live in `AR8xxx`/`AR9xxx` ranges, with seat counts set by the availability dimension. Each generated booking carries `tags[]` and an `expected_outcome` (class of result computed by an independent oracle in the test suite, not by the production code under test) so `GET /scenarios` and property tests can assert it. Determinism check: two generator runs produce an identical dataset hash (test CUJ-21).

**`GET /scenarios`** (flag-gated debug endpoint, see API table) returns this catalog (fixtures first, then generated, filterable by `type`, `tag`) so demo operators and testers can pick a PNR for a situation without reading the code.

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
| CUJ-21 | Generated scenario matrix: invariants over ~120 generated bookings | - | V/E property tests: generator determinism (identical dataset hash across runs), seats never negative, every `executable` option has `fits_party` and enough seats for seat-holding pax (infants excluded), classification equals the independent oracle's `expected_outcome`, rebooking then replay is idempotent | Mock breadth with cheap regression | P1 | HIGH | `generator, matrix` |
| CUJ-22 | Special passengers and ancillary matrix (infant, minor, pet, sport equipment, priority) (F-12) | Sim | V/E: `KT5M2V`, `HN7D4C`, `PS8N4W`, `PW6J8X`, `SQ9R3F`, `XN7B2K` expectations | Rules in code | P1 | MEDIUM | `pax-types, ancillaries` |
| CUJ-23 | `GET /scenarios` flag-gated catalog | - | E: 404 when `ENABLE_SCENARIOS_ENDPOINT` off; when on lists every fixture + generated with required fields; not present in CES schema (K) | Debug tooling safety | P2 | LOW | `debug` |
| CUJ-24 | Failure modes: timeout, 5xx-like, slow (F-07) | Sim | V/E: `SV2T7K`, `UE4Q8H`, `SL6Y3M` envelopes and latency | Seeded failures | P1 | HIGH | `resilience` |
| CUJ-25 | Voluntary payment step: total confirmed by amount, simulated receipt (F-04) | Golden | V/E: `TOTAL_MISMATCH`, `VOLUNTARY_CHANGES_DISABLED` with flag off, `receipt_id` deterministic and replay-stable; **C**: callback blocks when amount differs from offered total | Deterministic | P0 | HIGH | `voluntary, payment` |
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
2. **Firestore adapters + emulator:** implement adapters, `firebase.json` emulator config, `seed.ts` + `dataset.ts` (named fixtures) + `generate.ts` (seeded generator) + flag-gated `GET /scenarios`; emulator integration tests (E) incl. transactions and concurrency.
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
| 2026-10-17 | Rev 3 (APPROVED by product owner): backend declared MOCK; scenario catalog (22 named fixtures) + seeded generator (~120 bookings) + flag-gated `GET /scenarios`; "Conversation flows" section (F-01..F-13 with backend call sequences); voluntary changes ENABLED by default with simulated payment (confirm total, `receipt_id`); Blaze/billing resolved; coverage CUJ-21..25 | tdd-writer |

Review and approve before scaffolding the agent.
