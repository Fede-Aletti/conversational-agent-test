# Feature: local-offline-tests

## Objective
Provide a local, credit-free test harness for the `escala` CX Agent Studio app that mirrors platform behavior as faithfully as possible.

## Problem / Why
Platform evals (goldens, simulations, `ci-test`, `llm-lint`, `run-session`) invoke Gemini and consume GCP credit. The user wants fast, faithful local iteration and to run billable checks only occasionally.

## Findings (exploration)
- Offline: `cxas lint` (deterministic), `cxas test-callbacks` (local pytest runner).
- Platform, non-LLM: `cxas test-tools` (`:executeTool`), `test-single-callback` (reads agent).
- Billable (Gemini): `run-session`, `ci-test`, `cxas run`, goldens/sims, `llm-lint`.
- Tool `python_code.py` relies on an injected `context` global; no local tool runner exists. `cxas_scrapi.utils.callback_libs` provides `ToolContext`, `CallbackContext`, `LlmRequest`, `LlmResponse`, `Part`, `Content`.
- Tool test YAML (`tests:` top-level, `ToolTestCase` schema, JSONPath expectations) is shared format with `cxas test-tools`.

## Scope
- pytest harness at repo level running tools and callbacks locally with platform-equivalent globals.
- Local runner for `escala/evals/tool_tests/*.yaml` reusing the same cases/operators as `cxas test-tools`.
- Offline structural lint as a test.
- `escala/evals/` layout from the foundry project template.
- Self-test fixtures proving the harness works before real agents exist.
- Short docs (TESTING.md) + Make-like commands.

## Constraints
- No Gemini/platform calls in the default test run. Billable checks opt-in only.
- Generated artifacts in English. ~400 changed lines per task is advisory only.
- TDD mode: not configured (source: no project/session config) -> disabled; ordinary functional checks. Runner: `uv run pytest`.

## Tasks
- [x] T1 Harness + offline tests + docs (route: delegated writer; trigger: 2+ non-trivial files)
- [x] T2 Verify: `uv run pytest` green offline; commit.

## Acceptance criteria
- `uv run pytest` passes with network disabled for GCP (no API calls).
- Dropping a tool/callback into `escala/cxas_app/escala` + a YAML case is picked up automatically.
- Lint test skips with a clear reason while the app has no agents, fails on lint errors otherwise.

## Progress / Evidence
- Timezone + remote done separately (commit 38a2cf7).
- T1/T2: `uv run pytest -q` -> 9 passed, 3 skipped (escala has no tools/callbacks/agents yet); same result with GCP creds disabled. Parent spot check re-ran pytest: identical. Commit: test: add offline pytest harness (branch chore/cxas-scrapi-setup). RDD off (global) -> no review.
- Known divergences: tool response shape `{"result": ...}` inferred from SDK ToolEvals, not checked against a real :executeTool; platform sandbox (import allow-list, timeouts) not emulated; `variables: {x: null}` unresolvable offline; sync-callbacks.py untested (imports missing project-local config).

## Next step
Feature complete. Next: when the first tool lands, run one `cxas test-tools` on the platform to confirm the response shape.
