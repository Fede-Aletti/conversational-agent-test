# Feature: escala-bot

## Objective
Build the `escala` GECX conversational agent (text + voice) for airline customer service, per `escala/sources/prd.md`, with an approved TDD at `escala/tdd.md`.

## Problem / why
Demonstrate an agent that resolves multi-domain passenger problems (cancellation + connection + multiple passengers + ancillaries) end to end, without inventing results or duplicating operations.

## Scope and constraints
- Principle: the LLM is the last resort. All deterministic decisions live in a mock backend (Firebase Cloud Functions 2nd gen, TypeScript, Firestore) with a broad deterministic scenario catalog.
- CES app: 3 journey-based agents (root, disruption_rebooking, handoff) over one OpenAPI toolset; confirmation guardrail in callbacks.
- Voluntary changes enabled behind `voluntary_changes_enabled` with simulated payment.
- Credit policy: no platform evals, `cxas run`, `run-session`, `llm-lint` unless the user asks. Manual lint before every `cxas push`.
- Product focus: conversational flows.

## TDD mode
- Mode: off (no project/session TDD configuration found). Ordinary functional checks per task.
- Runners: `uv run pytest` (offline CES harness), `npm test` (vitest) in `escala/backend/`.

## Delivery
- Strategy: `ask-on-risk` defaulting to `stacked-to-main` slices (one PR per work unit). Base branch: `feat/escala-tdd`.

## Tasks
- [x] T1 PRD saved + TDD drafted, revised and approved — inline/delegated (tdd-writer). Commits: e03c009, 759f1a7, rev 3 approved.
- [x] T2 Backend domain + scenario catalog (22 fixtures + 120 generated) + vitest — delegated writer. Commit bb41358. Evidence: npm test 219 passed.
- [x] T3 HTTP API + Firestore adapter + seed + emulator tests + OpenAPI schema — delegated writer. Commit 272f051. Evidence: integration 11 passed (emulator, JDK 21). Risk tier high (RDD off) -> independent verifier: PASS_WITH_ISSUES, no blockers.
- [ ] T3b Verifier follow-ups: emulator rollback test; TOTAL_MISMATCH side-effect asserts; /scenarios default-off test; check TOTAL_MISMATCH before executed-quote early return; hash idempotency keys for Firestore doc ids.
- [x] T4 Infra (done: Firebase added, APIs, Firestore us-central1, function deployed nodejs22 at https://api-nam423zy2q-uc.a.run.app, seeded 141 bookings, smoke test OK, unauth 403; commits 0f3601b, 43be5a5; roles/run.invoker granted to service-836062363380@gcp-sa-ces; audio bucket gs://escala-audio-gen-lang-client-0907599903 (30d lifecycle)): add Firebase to GCP project, enable APIs, choose Firestore location, deploy function, seed, IAM for CES invoker — inline (state/CLI).
- [x] T5 Scaffold CES app — delegated scaffolder. Commit bb254c9. Evidence: pytest 25 passed, 1 failed (lint test: S007 handoff_agent two parents, V001).
- [x] T6 Replaced handoff_agent with deterministic createHandoffCase tool in both agents (S007) + lint clean — delegated writer. Commit bc0bf36. Evidence: lint 0/0, pytest 24 passed.
- [x] T7 Manual lint + `cxas push` (language es-AR rejected by CES -> es-419). Verified non-LLM: OpenAPI tool names are `escala_api_<operationId>`; service-agent ID-token auth to the private function works (execute_tool lookupBooking RMR4TX ok); domain errors use HTTP 200 envelope. Pending (needs an LLM session, billable): before_tool short-circuit of an OpenAPI tool, after_tool response shape in live sessions.
- [x] T8 FSM-driven dynamic instructions (token cut) — delegated writer, route: delegated (writer, 2+ non-trivial files). Pure `next_fsm` in `track_state` (both agents) computes `fsm_state`; `before_model` `inject_fsm_instructions` publishes the state's Spanish step text in `{fsm_instructions}` (variable placeholder, api-reference.md "Referencing Variables in Instructions"); instruction.txt shortened to a core. Per-turn instruction text now 25-38% of the original (root core 1,913 chars + 110-1,101 step vs 7,873; rebooking core 3,441 + 203-1,724 step vs 14,443). Evidence: `uv run cxas lint --app-dir escala/cxas_app/escala` 0 errors/0 warnings; `uv run pytest -q` 31 passed. Platform behavior of the placeholder is NOT yet verified (needs a billable session); no `cxas push` done.

## Acceptance criteria
- Backend tests green; every TDD CUJ has a scenario fixture.
- `uv run pytest` green; `cxas lint` clean.
- App pushed; OpenAPI toolset reachable from CES.

## Progress / evidence
- 2026-10-17: TDD approved by product owner (Firebase mock backend, journey-based agents, voluntary changes ON).

## Next step
T3b backend follow-ups. Optional (billable, user opt-in): voice/text session of F-01 demo to verify callback guard and collect recordings.
