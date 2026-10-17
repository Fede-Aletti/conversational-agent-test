# Technical Design Document (TDD) - Escala

> Living document. Update the TDD first, then update evals/tests to match.
> Mode: draft from requirements. Sources: `escala/sources/prd.md` (functional PRD, Spanish, + English "Engineering assumptions" appendix = default decisions), `escala/sources/project-context.md` (fixed technical decisions + credit policy). Offline harness shape from `TESTING.md`.
> Artifact language: English. Agent-facing instructions and all customer-visible text: Spanish (Argentina), professional tone, voseo, voice-friendly (short turns, no markdown dependence, no bullet/table reliance).

## Agent Design

### Architecture

- **App:** `projects/gen-lang-client-0907599903/locations/us/apps/escala` (project-context.md). Local dir `escala/cxas_app/escala/`.
- **Modality:** text **and** voice, same app (project-context.md "Channels"). Voice-ready instructions: short turns, spell/read back booking codes, no markdown, option ids that are easy to say aloud ("A", "B", "C"). Default eval modality is `text` (gecx-config.json). The Live/audio model is not specified by the sources; use the platform default (see Open Questions).
- **Time zone:** `America/Argentina/Buenos_Aires`. Simulated "today" is a fixed constant (see Variables) so data and relative dates ("mañana") are reproducible.
- **Pattern:** one specialist sub-agent that owns the whole disruption CUJ end to end (PRD 5: "resolved within one conversation without losing information"), per the design guide's warning against splitting a single fluid flow across agents (flow fragmentation, lossy handoffs).

| Agent | Role | Justification (source) |
|---|---|---|
| `root_agent` | Greeting + experimental disclaimer, intent detection, general policy FAQ (PRD 4.A) via `get_policy_snippet`, human-handoff request handling, session outcome. Routes anything involving a specific booking/flight incident to `rebooking_agent`. | PRD 4.A (FAQ is stateless, no booking needed), 4.F, appendix "Experimental disclaimer". |
| `rebooking_agent` | Booking lookup, flight status/incident impact on the whole trip, alternatives, per-passenger conditions (check-in, ancillaries, fare policy), explicit confirmation, simulated modification + verification, handoff with context. Also has `get_policy_snippet` so an interruption ("¿y cuántas valijas puedo llevar?", PRD 7) is answered without leaving the flow. | PRD 4.B-E, 5, 6 ("Conciencia del contexto"). |

- **Not proposed:** separate agents for FAQ, ancillaries, or handoff. FAQ is a single tool lookup; ancillaries and handoff are steps inside the rebooking CUJ and need its context. Revisit only if instruction-following degrades (design guide: start small, split later). `childAgents` must use the directory name `rebooking_agent` (underscore).
- **Tradeoff of keeping FAQ on root and also giving the tool to `rebooking_agent`:** the tool is duplicated in two tool lists (cheap, deterministic) in exchange for avoiding a lossy transfer during an interruption.

### Tools

All tools are **Python functions** over an in-code synthetic dataset (appendix "Booking backend"). Every tool returns `{"result": {...}}`. Success payloads carry `"status": "ok"`; failures carry `"status": "error"`, a stable `error_code`, `retryable` (bool) and an `agent_action` string telling the model exactly what to say/do next (design guide: deterministic recovery). Tools are stateless except for the session state variable `_sim_state` (see Variables); the in-code dataset is immutable and per-session mutations are an overlay in `_sim_state`.

| Tool | Mutating | Purpose / contract |
|---|---|---|
| `get_policy_snippet(topic)` | no | Returns a curated snippet: `{topic, summary_es, source_url, as_of, verified}`. Topics: `baggage_allowance`, `extra_baggage`, `checkin`, `fare_conditions`, `voluntary_changes_refunds`, `involuntary_changes`, `travel_requirements`, `services`. Unknown topic -> `error_code: UNKNOWN_TOPIC` with the valid topic list. Every snippet today has `as_of: "needs verification"`, `verified: false`; the agent must hedge ("según la información pública de referencia, a confirmar en aerolineas.com.ar") and never state unverified numbers as final. (appendix "Policy knowledge") |
| `find_booking(last_name, pnr="", flight_date="", origin="", destination="")` | no | Primary: `pnr` + `last_name`. Fallback: `last_name` + `flight_date` (YYYY-MM-DD) + `origin`/`destination` IATA. Normalizes case/spaces/hyphens/diacritics. Returns the aggregate booking context in one call (state aggregation pattern): passengers (`P1`, `P2`, check-in state), segments with static status (`scheduled`/`cancelled`/`delayed`), `connection_status` (`ok`/`broken`), fare family per passenger, ancillaries with their `transfer_rule`. Sets `active_pnr`. Not found -> `error_code: BOOKING_NOT_FOUND`, `retryable: true`, `agent_action` = ask to re-check the code, offer fallback lookup by last name + date + route, then handoff. (PRD 7 "no encuentra su reserva") |
| `get_flight_status(flight_number, flight_date)` | no | Live-style status for one flight (`scheduled`/`delayed`/`cancelled`, times, new estimated times). Seeded `UPSTREAM_TIMEOUT` for `AR1698` (see dataset). |
| `search_alternatives(pnr, deadline_date="", destination="")` | no | Derives the disrupted portion of the itinerary from the booking (first impacted segment origin -> final destination), computes `change_type` (`involuntary` if any segment is cancelled/delayed beyond threshold, else `voluntary`), and returns options `[{option_id: "A"/"B"/..., legs[], arrival_datetime, arrives_by_deadline, seats_available, party_size, fits_party}]` ordered by arrival. Options that miss the deadline are returned separately in `options_after_deadline`; empty everywhere -> `status: "ok", options: []` with `next_availability` (never invent). `destination` different from the booking -> `error_code: DESTINATION_CHANGE_NOT_SUPPORTED`, `agent_action` = explain and offer handoff. Seeded `UPSTREAM_TIMEOUT` for PNR `SV2T7K`. |
| `evaluate_rebooking(pnr, option_id)` | no | Deterministic rules engine for one option. Per passenger: `can_rebook`, `requires_checkin_cancellation`, fare policy result, and each ancillary with `outcome` in {`transfers`, `not_transferred`, `needs_review`} plus a Spanish-ready `note`. Party-level: `fits_party`, `fare_difference_ars`, `blocking_reasons[]` (e.g. `POLICY_FARE_NOT_CHANGEABLE`, `NO_SEATS_FOR_PARTY`). The model must relay exactly this; it must not infer transfers. (PRD 4.E, appendix "Ancillaries on rebooking") |
| `cancel_checkin(pnr, passenger_id, confirmed, idempotency_key)` | **yes** | Simulated check-in cancellation for one passenger (appendix "Checked-in passenger"). |
| `confirm_rebooking(pnr, option_id, confirmed, idempotency_key)` | **yes** | Executes the simulated modification for all passengers, then **verifies** by re-reading the overlay and returns `{new_itinerary, per_passenger_ancillary_outcome, confirmation_code, verified: true}`. Refuses with `CHECKIN_ACTIVE` (+ `agent_action` to call `cancel_checkin`) if any passenger is still checked in on the replaced segments. |
| `create_handoff_case(pnr, reason, summary, idempotency_key)` | **yes** | Stores a context summary and returns `{case_id}` (deterministic: `HC-` + first 6 hex of sha1(`idempotency_key`)). Sets `session_outcome = "handed_off"`. `pnr` may be empty (no booking identified yet). The agent tells the passenger they will not need to repeat themselves. (appendix "Human handoff", PRD 4.F) |
| `set_session_outcome(outcome)` | state | Writes `session_outcome` in {`resolved`, `failed`} (`handed_off` is set by `create_handoff_case`). Called once at the end of the conversation. (appendix "Metrics") |
| `end_session` | system | Built-in; ends the session after the farewell. |

**Mutating-tool safety contract (applies to `cancel_checkin`, `confirm_rebooking`, `create_handoff_case`)**

1. `confirmed` must be literally `true`; otherwise return `status: "confirmation_required"` with a summary of what would change and **no side effects**. The instruction requires the agent to obtain an explicit "sí" to a read-back of the exact operation in the previous user turn before passing `confirmed=true`.
2. `idempotency_key` is required and non-empty (`error_code: MISSING_IDEMPOTENCY_KEY`). Format given in the instruction: `rebook-<PNR>-<OPTION>`, `cancelci-<PNR>-<PASSENGER_ID>`, `handoff-<PNR or NOPNR>-<N>`.
3. The tool stores the first result in `_sim_state.ledger[key]`. A repeat with the same key returns the stored result unchanged plus `already_applied: true`, without re-executing.
4. Defense in depth against a model that varies the key: `confirm_rebooking` and `cancel_checkin` also dedupe on a natural key (`pnr+option_id`, `pnr+passenger_id`) and return `already_applied: true, matched_by: "natural_key"`.
5. Partial-failure honesty: if `cancel_checkin` succeeded and `confirm_rebooking` then fails, the overlay keeps the cancelled check-in and the error payload states it, so the agent reports exactly what is pending (PRD 5 "identificar exactamente qué quedó pendiente").

**Tool design notes:** inputs are voice-expressible (PNR, surname, ISO date, IATA, option letter, `P1`/`P2`); the agent reads the PNR back letter by letter before the first lookup on voice. PNRs avoid ambiguous characters (no `0/O`, `1/I`).

### Routing Logic

PRD does not define routing rules explicitly; proposal derived from PRD 4 and 7:

- `root_agent`: general questions (baggage, check-in, fares, changes/refunds, requirements, services) -> answer with `get_policy_snippet`, no transfer. Mentions of "mi reserva", a PNR, a flight cancelled/delayed/missed connection, "cambiar/reprogramar", or a request needing booking data -> transfer to `rebooking_agent` carrying what the user already said.
- `rebooking_agent`: owns the flow once entered. Interruption with a general policy question -> answer via its own `get_policy_snippet` and resume the pending step ("Retomando lo de tu cambio...").
- Human handoff: if the user asks for a person at any point, or the agent cannot complete (policy block, no alternatives, outage after one retry, destination change), call `create_handoff_case` in whichever agent is active. Do not argue the user out of an explicit human request; one short offer of the quick alternative is allowed only if it is the very next unambiguous step.
- Context change mid-conversation (e.g., new destination, PRD 7): keep `active_pnr` and passenger facts; re-evaluate against rules; do not re-ask known data.
- Outage rule: on `UPSTREAM_TIMEOUT` retry the same call **once**; if it fails again say plainly that the system is not responding, do not guess status/availability, and offer handoff.

### Variables

Consolidated into few variables (design guide: avoid variable explosion; use JSON for feature state).

| Variable | Schema | Source | Notes |
|---|---|---|---|
| `sim_today` | string `YYYY-MM-DD` = `2026-11-12` | Derived in root `before_agent` | **NEVER override in evals.** Fixed simulated date so "mañana" = `2026-11-13` and seeds stay valid. |
| `channel` | string `text`/`voice` | Session parameter (optional) | Informational for tone; instruction does not branch on it beyond brevity. Default `text`. |
| `active_pnr` | string | Set by `find_booking` (tool) | Context continuity across interruptions/agent transfers. Tests may seed it. |
| `_sim_state` | JSON `{ledger:{key:result}, overlay:{pnr:{checkin_cancelled:[...], rebooked_option, confirmation_code}}, fail_counters:{}}` | Written only by mutating tools | **NEVER override in evals** (except offline tool tests that pre-seed it to test idempotency). Underscore prefix = observability/internal. |
| `session_outcome` | string `resolved`/`handed_off`/`failed` | Set by `set_session_outcome` / `create_handoff_case` | Analytics (appendix "Metrics"). |
| `_disclaimer_shown` | bool | Set by after_model callback | **NEVER override in evals.** |

### Callbacks

Kept minimal; every callback below is motivated by a source line.

| Callback | Agent | Purpose | Justification |
|---|---|---|---|
| `before_agent` | `root_agent` | Initialize `sim_today` (constant), `_sim_state` skeleton, `session_outcome` unset, `_disclaimer_shown=false`. Idempotent (only sets when missing). | Reproducible data (PRD 9 "datos simulados coherentes para pruebas reproducibles"). |
| `after_model` | `root_agent`, `rebooking_agent` | If `_disclaimer_shown` is false and the response contains text, prepend the fixed Spanish experimental disclaimer ("Soy Escala, un asistente experimental, sin afiliación con Aerolíneas Argentinas; las reservas y operaciones son simuladas.") and set the flag. Covers the case where the first turn is a direct transfer. | Appendix "Experimental disclaimer" + PRD 9; wording must not depend on LLM compliance. |

- No `before_model` trigger pattern: tool calls are chosen by the LLM; safety is enforced inside the tools (confirmation flag + idempotency), which is deterministic without phrase matching (design guide: do not overfit callbacks).
- No deterministic farewell callback; revisit if evals show `end_session` without a spoken farewell.
- **Language:** all callback/user-visible strings in Spanish (Argentina, voseo).

### Instruction outline (agent-facing, Spanish at build time)

- Persona: asistente experimental, voseo, cordial y concreto, turnos cortos; read numbers/dates in natural spoken form; one question at a time; never read raw ids except PNR (letter by letter) and `case_id`/`confirmation_code`.
- Requests only the minimum to identify the booking (PNR + last name; fallback surname + date + route).
- Distinguishes confirmed data (from tools) vs pending vs unknown; never invents availability, policies or results; cites snippet `as_of` caveat.
- Before any mutating call: read back what will change per passenger (new flights, check-in cancellation, which extras transfer/do not), ask for an explicit yes, then call with `confirmed=true`. A second "sí" for an already-applied operation is answered from `already_applied`, never re-executed.
- After `confirm_rebooking`: report new itinerary, ancillary outcomes per passenger, what is still pending (e.g., redo check-in, seat reselection).
- Ends by calling `set_session_outcome` (or relying on `create_handoff_case`), then farewell.

---

## Synthetic Dataset (single source for tools, tool tests and evals)

Simulated "today": **2026-11-12 (Thursday)**. "Mañana" = 2026-11-13. All flight numbers, PNRs, names and prices are **fictitious** (flight numbers use the `AR` prefix for realism only; they do not correspond to real operations). Currency ARS, all amounts synthetic. Times are local (America/Argentina/Buenos_Aires). Implementation location: a single Python dict duplicated into each tool file (tools cannot import shared modules on the platform; keep it in sync via a test that asserts identical dataset hashes across tool files, or generate the files from one source script).

### Flights

| Flight | Route | Date | Dep-Arr | Status | Economy seats | Used by |
|---|---|---|---|---|---|---|
| AR1561 | COR->AEP | 2026-11-12 | 07:10-08:35 | **cancelled** | - | Demo (orig. seg 1) |
| AR1692 | AEP->BRC | 2026-11-12 | 10:20-12:35 | scheduled (connection broken) | 12 | Demo (orig. seg 2) |
| AR1563 | COR->AEP | 2026-11-12 | 11:30-12:55 | scheduled | 6 | Option A leg 1 |
| AR1696 | AEP->BRC | 2026-11-12 | 15:40-17:55 | scheduled | **1** | Option A leg 2 |
| AR1565 | COR->AEP | 2026-11-13 | 07:00-08:25 | scheduled | 9 | Option B leg 1 |
| AR1694 | AEP->BRC | 2026-11-13 | 09:50-12:05 | scheduled | 6 | Option B leg 2 |
| AR1880 | COR->BRC (direct) | 2026-11-13 | 09:15-11:40 | scheduled | **2** | Option C (direct, plausible seasonal route) |
| AR1698 | AEP->BRC | 2026-11-12 | 13:00-15:15 | scheduled (status service times out) | 8 | Timeout scenario |
| AR1301 | MDZ->AEP | 2026-11-12 | 09:00-10:50 | **cancelled** | - | No-alternatives |
| AR1306 | MDZ->AEP | 2026-11-15 | 09:00-10:50 | scheduled | 5 | No-alternatives (after deadline) |
| AR1700 | AEP->MDZ | 2026-11-12 | 18:00-19:50 | **cancelled** | - | Duplicate confirmation |
| AR1702 | AEP->MDZ | 2026-11-12 | 20:30-22:20 | scheduled | 9 | Duplicate confirmation |
| AR1710 | AEP->MDZ | 2026-11-14 | 08:00-09:50 | scheduled | 8 | Fallback lookup |
| AR1850 | AEP->IGR | 2026-11-14 | 08:00-10:05 | scheduled | 10 | Destination change |
| AR1852 | AEP->IGR | 2026-11-15 | 08:00-10:05 | scheduled | 7 | Destination change (voluntary alt.) |
| AR1860 | AEP->IGR | 2026-11-16 | 14:00-16:05 | scheduled | 10 | Policy block |
| AR1862 | AEP->IGR | 2026-11-17 | 14:00-16:05 | scheduled | 10 | Policy block (alt.) |

Minimum connection time for the dataset: 60 min (A: 12:55 -> 15:40 ok; B: 08:25 -> 09:50 ok).

**Demo alternatives (booking `RMR4TX`, deadline 2026-11-13, party of 2):**

| Option | Itinerary | Arrival BRC | Seats vs party | Result |
|---|---|---|---|---|
| A | AR1563 + AR1696 (same day) | 2026-11-12 17:55 | AR1696 has 1 seat for 2 pax | `fits_party: false` -> only one passenger could travel today; agent must explain the split-party limitation |
| B | AR1565 + AR1694 (next morning via AEP) | 2026-11-13 12:05 | 9 / 6 | fits, within deadline |
| C | AR1880 direct | 2026-11-13 11:40 | 2 | fits, within deadline, earliest arrival that fits the whole party |

### Fare families (synthetic rule sets)

| Family | Voluntary change | Involuntary change | Notes |
|---|---|---|---|
| `ECO_FLEX` | allowed, fee ARS 25,000/pax + fare difference | free, same destination, fare difference 0 | |
| `ECO_BASIC` | **not allowed** (`POLICY_FARE_NOT_CHANGEABLE`) | free, same destination, fare difference 0 | Refund rules via policy snippet only |

### Ancillary transfer rules (data-driven, never assumed)

| Type | Involuntary change | Voluntary change |
|---|---|---|
| `extra_bag` (23 kg) | `transfers` | `needs_review` (handoff) |
| `seat_selection` | `not_transferred` (note: seat can be reselected at check-in; paid seat refund handled by human) | `not_transferred` |

### Bookings (seeds)

| PNR | Holder surname | Pax (check-in) | Itinerary | Fare | Ancillaries | Scenario |
|---|---|---|---|---|---|---|
| **RMR4TX** | Romero | P1 Valentina Romero (not checked in); P2 Joaquín Benítez (**checked in**) | AR1561 COR->AEP -> AR1692 AEP->BRC, 2026-11-12 | ECO_FLEX both | P1 `extra_bag`(both segs, ARS 38,000); P2 `extra_bag`(both segs, ARS 38,000) + `seat_selection` 12A on AR1561 and 12C on AR1692 (ARS 9,000) | **Main demo (PRD 5)**; also "two passengers with different conditions" (PRD 7): P2 needs check-in cancellation and loses seats, P1 does not; and option A fits only one pax. Either surname identifies the booking. |
| **QWE4RT** | (does not exist) | - | - | - | - | **Booking not found** (PRD 7): any `find_booking` with this PNR returns `BOOKING_NOT_FOUND`. |
| **LQ3W9D** | Ferreyra | P1 Marcos Ferreyra (not checked in) | AR1710 AEP->MDZ, 2026-11-14 | ECO_FLEX | none | **Recovery via fallback lookup**: user gives a wrong PNR (e.g. `LQ3W9B`) -> not found -> `find_booking(last_name="Ferreyra", flight_date="2026-11-14", origin="AEP", destination="MDZ")` succeeds. |
| **NV8C5R** | Sosa | P1 Camila Sosa (not checked in) | AR1850 AEP->IGR, 2026-11-14 (on time) | ECO_FLEX | `extra_bag` (ARS 38,000) | **Destination change mid-conversation** (PRD 7): user starts asking to move to 2026-11-15 (voluntary, fee applies, `needs_review` for bag) then says "mejor cambiame a Ushuaia" -> `DESTINATION_CHANGE_NOT_SUPPORTED` -> agent keeps context, explains, offers handoff. |
| **TB6H1Y** | Molina | P1 Ramiro Molina (not checked in) | AR1301 MDZ->AEP, 2026-11-12 (**cancelled**) | ECO_FLEX | none | **No alternatives** (PRD 7): deadline 2026-11-13 -> `options: []`, `options_after_deadline: [AR1306 on 2026-11-15]`, `next_availability: 2026-11-15`. Agent must not invent options; offers the later flight (needs consent) or handoff. |
| **SV2T7K** | Quiroga | P1 Elena Quiroga (not checked in) | AR1698 AEP->BRC, 2026-11-12 | ECO_FLEX | none | **Service timeout** (PRD 7): `get_flight_status(AR1698)` and `search_alternatives(SV2T7K)` return `UPSTREAM_TIMEOUT` (`retryable: true`) every time; `find_booking` and policy lookups still work. Expected: one retry, plain disclosure, no guessed status, handoff offer. |
| **DP4N8S** | Luna | P1 Tomás Luna (not checked in) | AR1700 AEP->MDZ, 2026-11-12 (**cancelled**) | ECO_FLEX | `extra_bag` | **Duplicate confirmation** (PRD 7): one easy option (AR1702, option A, 9 seats). User says "sí" twice (or "dale" then "confirmá"); the second `confirm_rebooking` returns `already_applied: true` with the same `confirmation_code`; agent says it was already done, shows the same result. |
| **PB9K4Z** | Giménez | P1 Sofía Giménez (not checked in) | AR1860 AEP->IGR, 2026-11-16 (on time) | **ECO_BASIC** | none | **Policy blocks change** (PRD 7): voluntary change request -> `evaluate_rebooking` returns `blocking_reasons: [POLICY_FARE_NOT_CHANGEABLE]`; agent explains rule from `fare_conditions`/`voluntary_changes_refunds` snippets (with the "needs verification" caveat), does not execute, offers handoff. |

**Human handoff scenario (PRD 7):** no dedicated booking; the request "quiero hablar con una persona" can occur at any point in any seed (primary test: RMR4TX after options were presented, and with no PNR identified yet).

**Interruption scenario (PRD 7):** during RMR4TX option presentation the user asks about extra baggage; the agent answers via `get_policy_snippet("extra_baggage")` and resumes with the pending option choice and without re-asking identification.

### Policy snippets (Aerolíneas Argentinas public information - placeholder, needs human verification)

Every snippet: `source_url` is a **placeholder** under `https://www.aerolineas.com.ar/`, `as_of: "needs verification"`, `verified: false`. Content below is a high-level summary of the kind of information the public pages provide; **specific numbers are marked `[TBV]` and must not be shipped as facts until a human fills them from the official page.** Spanish text is produced at build time from these summaries.

| topic | Summary (to be rendered in Spanish) | source_url (placeholder) | as of |
|---|---|---|---|
| `baggage_allowance` | Carry-on and checked baggage allowance depend on route (domestic/international) and fare family; weight/size limits `[TBV]`; excess handled at airport with fee `[TBV]`. | `https://www.aerolineas.com.ar/PLACEHOLDER/equipaje-franquicia` | needs verification |
| `extra_baggage` | Additional checked bags can be purchased before travel or at airport; price and limits `[TBV]`; prepaid extra baggage is tied to the booking. | `https://www.aerolineas.com.ar/PLACEHOLDER/equipaje-adicional` | needs verification |
| `checkin` | Online check-in opens and closes at fixed times before departure `[TBV: opening/closing hours]`; airport counter check-in also available; documents required. | `https://www.aerolineas.com.ar/PLACEHOLDER/check-in` | needs verification |
| `fare_conditions` | Fare families differ in changes, refunds, baggage and seat selection; the rules of the purchased fare apply `[TBV]`. | `https://www.aerolineas.com.ar/PLACEHOLDER/condiciones-tarifas` | needs verification |
| `voluntary_changes_refunds` | Voluntary changes/refunds are subject to fare rules, fees and fare difference `[TBV]`; deadlines relative to departure `[TBV]`. | `https://www.aerolineas.com.ar/PLACEHOLDER/cambios-devoluciones` | needs verification |
| `involuntary_changes` | When the airline cancels or significantly changes a flight, the passenger can be reaccommodated or request alternatives/refund per the carrier's conditions `[TBV]`; checked-in passengers need to be re-checked-in on the new flight. | `https://www.aerolineas.com.ar/PLACEHOLDER/cambios-involuntarios` | needs verification |
| `travel_requirements` | Domestic travel: valid ID document requirements; minors and special cases `[TBV]`. | `https://www.aerolineas.com.ar/PLACEHOLDER/requisitos-de-viaje` | needs verification |
| `services` | Overview of ancillary services (seat selection, special assistance, pets, sports equipment) and where to request them `[TBV]`. | `https://www.aerolineas.com.ar/PLACEHOLDER/servicios` | needs verification |

---

## Eval Design

> **Credit policy:** platform evals (goldens, sims, `cxas run`, `ci-test`, `run-session`, `llm-lint`) are **DEFERRED** (project-context.md). Rows below list the CUJ and the *future* platform eval type for later, plus the **offline substitute** to build now: tool-test YAML in `escala/evals/tool_tests/<tool>.yaml` (run by `uv run pytest`, `tests/test_tools_yaml.py`) and callback tests in `escala/evals/callback_tests/tests/<agent>/<type>_callbacks/<base>/test.py` (`tests/test_callbacks.py`). Dialogue-quality behaviors (LLM judgment) have no offline substitute and stay `deferred` until the user asks for platform evals.

### Coverage Map

| ID | Requirement (source) | Eval Type (platform, DEFERRED) | Offline substitute (build now) | Rationale | Priority | Severity | Tags |
|---|---|---|---|---|---|---|---|
| CUJ-01 | Main demo: cancelled COR->AEP leg, 2 pax, one checked in, extra bags; resolve in one conversation (PRD 5) | Sim (max_turns ~16 text) + Golden for the tool-call spine | `find_booking`, `search_alternatives`, `evaluate_rebooking`, `cancel_checkin`, `confirm_rebooking` YAML on `RMR4TX` incl. full happy path chained via `variables:`/`_sim_state` | Dialogue varies; tool spine deterministic | P0 | NO-GO | `demo, rebooking, PRD-5` |
| CUJ-02 | Explicit confirmation before any modification (PRD 4.D, 6 "Seguridad operativa") | Golden | `confirm_rebooking`/`cancel_checkin` with `confirmed=false` -> `confirmation_required`, overlay unchanged | Enforced in tool = deterministic | P0 | NO-GO | `safety, confirmation` |
| CUJ-03 | Duplicate confirmation prevention (PRD 7) | Golden | `confirm_rebooking` twice (same key) and with different key on `DP4N8S` -> `already_applied: true`, same `confirmation_code`; `MISSING_IDEMPOTENCY_KEY` | Deterministic | P0 | NO-GO | `idempotency, PRD-7` |
| CUJ-04 | Booking not found + recovery via fallback (PRD 7) | Sim | `find_booking` `QWE4RT` -> `BOOKING_NOT_FOUND`; wrong PNR + fallback on `LQ3W9D` -> ok | Recovery dialogue varies | P0 | HIGH | `identification, recovery` |
| CUJ-05 | Checked-in passenger requires check-in cancellation first (appendix) | Golden | `confirm_rebooking` on `RMR4TX` before `cancel_checkin` -> `CHECKIN_ACTIVE`; after -> ok | Deterministic rule | P0 | HIGH | `checkin, rules` |
| CUJ-06 | Ancillaries never assumed to transfer (PRD 4.E) | Golden | `evaluate_rebooking` `RMR4TX` option C -> bags `transfers`, seats `not_transferred`; `NV8C5R` voluntary -> bag `needs_review` | Data-driven rule | P0 | HIGH | `ancillaries, PRD-4E` |
| CUJ-07 | Two passengers with different conditions / party fit (PRD 7) | Sim | `search_alternatives` `RMR4TX`: A `fits_party:false`, B/C true; `evaluate_rebooking` per-pax differences | Reasoning over multiple constraints | P0 | HIGH | `multi-passenger` |
| CUJ-08 | No alternatives within deadline (PRD 7) | Sim | `search_alternatives` `TB6H1Y` -> `options: []`, `options_after_deadline`, no invented flights | Exception handling | P0 | HIGH | `no-alternatives` |
| CUJ-09 | Service outage recovery (PRD 7) | Sim | `get_flight_status`/`search_alternatives` `SV2T7K` -> `UPSTREAM_TIMEOUT`, `retryable:true`, `agent_action` present; other tools unaffected | Seeded failure | P1 | HIGH | `resilience` |
| CUJ-10 | Policy blocks the change (PRD 7) | Golden | `evaluate_rebooking` `PB9K4Z` -> `POLICY_FARE_NOT_CHANGEABLE`; `confirm_rebooking` refuses with same code | Deterministic rule | P0 | HIGH | `policy, compliance` |
| CUJ-11 | Destination change mid-conversation (PRD 7) | Sim | `search_alternatives` `NV8C5R` with `destination="USH"` -> `DESTINATION_CHANGE_NOT_SUPPORTED`; `active_pnr` retained | Context management is LLM-judged | P1 | MEDIUM | `context` |
| CUJ-12 | Human handoff with context (PRD 4.F, 7) | Sim | `create_handoff_case` happy path, repeat with same key -> `already_applied`, deterministic `case_id`, `session_outcome=handed_off`; requires non-empty `summary` | Request can happen anywhere | P0 | HIGH | `handoff` |
| CUJ-13 | Interruption for baggage question mid-flow (PRD 7) | Sim | `get_policy_snippet("extra_baggage")` shape; every snippet has `source_url`, `as_of`, `verified:false` | Continuity is LLM-judged | P1 | MEDIUM | `interruption, faq` |
| CUJ-14 | General FAQ grounded in snippets with uncertainty hedge (PRD 4.A) | Sim | `get_policy_snippet` for all 8 topics + `UNKNOWN_TOPIC` | Wording varies | P1 | MEDIUM | `faq, grounding` |
| CUJ-15 | Experimental disclaimer in first reply (appendix) | Golden | Callback test: `after_model` prepends disclaimer once, sets `_disclaimer_shown`, no double injection on multi-call turns, ignores responses without text | Callback-enforced | P1 | MEDIUM | `disclaimer, callback` |
| CUJ-16 | Reproducible simulated date (PRD 9) | - | Callback test: `before_agent` sets `sim_today=2026-11-12`, idempotent, does not overwrite `active_pnr` | Deterministic | P2 | LOW | `callback, determinism` |
| CUJ-17 | Spanish (AR, voseo), voice-friendly, concise (appendix) | Sim (voice modality deferred, +4-6 max_turns when run) | none | Style is LLM-judged | P1 | MEDIUM | `style, voice` |
| CUJ-18 | Session outcome set (`resolved`/`handed_off`/`failed`) (appendix "Metrics") | Golden | `set_session_outcome` valid/invalid values | Deterministic | P2 | LOW | `metrics` |
| CUJ-19 | Dataset integrity (all tools see identical dataset; PNRs match seeds) | - | Offline pytest asserting dataset hash equality across tool files and that every seed PNR resolves | Prevents drift of duplicated dataset | P1 | HIGH | `dataset` |

### Test Data

Seed bookings above are the profiles. Session parameters for platform evals when un-deferred: none required except optional `channel`. Never override `sim_today`, `_sim_state`, `_disclaimer_shown`.

| Profile | PNR / last name | Scenario |
|---|---|---|
| Main demo | `RMR4TX` / Romero (or Benítez) | CUJ-01, 02, 05, 06, 07, 12, 13 |
| Not found | `QWE4RT` / Pérez | CUJ-04 |
| Fallback lookup | wrong `LQ3W9B` -> fallback Ferreyra, 2026-11-14, AEP->MDZ | CUJ-04 |
| Destination change | `NV8C5R` / Sosa | CUJ-11, 06 (voluntary bag rule) |
| No alternatives | `TB6H1Y` / Molina | CUJ-08 |
| Service timeout | `SV2T7K` / Quiroga | CUJ-09 |
| Duplicate confirmation | `DP4N8S` / Luna | CUJ-03 |
| Policy block | `PB9K4Z` / Giménez | CUJ-10 |

Opening utterance for CUJ-01 (PRD 5, verbatim): "Hola, viajamos dos de Córdoba a Bariloche con escala en Aeroparque. Me cancelaron el primer vuelo y necesito llegar mañana como máximo. Mi pareja ya hizo el check-in y pagamos equipaje adicional. ¿Nos podés cambiar a los dos sin perder lo que pagamos?" Expected spine: identify (RMR4TX + surname) -> `find_booking` -> `search_alternatives(deadline 2026-11-13)` -> present A/B/C with limits -> user picks (B or C) -> `evaluate_rebooking` -> read back incl. P2 check-in cancellation, bags transfer, seats lost -> explicit yes -> `cancel_checkin(P2)` -> `confirm_rebooking` -> report result + pending (P2 redo check-in, seat reselection) -> `set_session_outcome(resolved)`.

---

## Build Steps

1. Create app skeleton: `root_agent`, `rebooking_agent` (`childAgents: ["rebooking_agent"]`), Spanish instructions.
2. Write the dataset module and the 8 Python tools (+ `set_session_outcome`), with docstrings listing failure schemas and `(REQUIRED)` markers.
3. Declare variables (`sim_today`, `channel`, `active_pnr`, `_sim_state`, `session_outcome`, `_disclaimer_shown`).
4. Implement callbacks (`before_agent` root; `after_model` both agents).
5. Offline tests first (TDD): tool-test YAML per tool + callback tests + dataset-integrity test; `uv run pytest`.
6. `uv run cxas lint --app-dir escala/cxas_app/escala` (offline, manual before every push).
7. `cxas push`; run `uv run cxas test-tools` once to confirm `{"result": ...}` shape matches platform (non-LLM).
8. Platform evals (goldens/sims, voice): **deferred**, only on explicit user request.

---

## Pass Rate History

| Date | Goldens | Sims | Tool Tests | Callback Tests | Notes |
|------|---------|------|------------|----------------|-------|

---

## Known Issues

- All policy snippets are placeholders: URLs are not real deep links and `[TBV]` figures are unfilled. The agent hedges; a human must verify against aerolineas.com.ar before any demo that quotes numbers.
- Dataset is duplicated per tool file (platform tools cannot share modules); mitigated by CUJ-19 hash test, but remains a maintenance cost.
- Idempotency ledger lives in session state: it prevents duplicates within a session only. Cross-session duplicate prevention is out of scope for the prototype (no persistent backend).
- `cancel_checkin` + `confirm_rebooking` are separate calls to match the appendix; a failure between them leaves check-in cancelled (reported honestly). Alternative (single wrapped tool) would be safer but diverges from the appendix wording.
- Rich UI (cards/comparisons) out of scope; options are presented as concise spoken-style text (appendix).
- Voice-specific risks not covered offline: PNR transcription errors, barge-in during read-backs, speech rate. Requires platform audio evals (deferred).
- Direct COR->BRC flight `AR1880` is a plausible synthetic route, not verified against the real network.

---

## Changelog

| Date | Change | Author |
|------|--------|--------|
| 2026-10-17 | Initial requirements-derived TDD draft (sources: escala/sources/prd.md, escala/sources/project-context.md) | tdd-writer |

Review and approve before scaffolding the agent.
