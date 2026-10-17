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
- [~] T4 Infra (done: Firebase added, APIs, Firestore us-central1, function deployed nodejs22 at https://api-nam423zy2q-uc.a.run.app, seeded 141 bookings, smoke test OK, unauth 403; commits 0f3601b, 43be5a5; pending: invoker IAM for CES service agent): add Firebase to GCP project, enable APIs, choose Firestore location, deploy function, seed, IAM for CES invoker — inline (state/CLI).
- [ ] T5 OpenAPI schema + scaffold CES app from TDD (agents, instructions, callbacks, toolset) — delegated scaffolder.
- [ ] T6 Offline tool YAML + callback tests; lint clean (lint-fixer) — delegated.
- [ ] T7 Manual lint + `cxas push`; verify the 4 open platform behaviors with `cxas test-tools` (non-LLM) — inline.

## Acceptance criteria
- Backend tests green; every TDD CUJ has a scenario fixture.
- `uv run pytest` green; `cxas lint` clean.
- App pushed; OpenAPI toolset reachable from CES.

## Progress / evidence
- 2026-10-17: TDD approved by product owner (Firebase mock backend, journey-based agents, voluntary changes ON).

## Next step
T5 scaffold, then CES invoker IAM, T3b, T6, T7.
