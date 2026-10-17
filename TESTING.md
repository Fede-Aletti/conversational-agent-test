# Testing the `escala` agent

Run the cheap layers first; billable ones sparingly.

## 1. Offline (default, free, no GCP)

```bash
uv run pytest            # everything below, billable excluded
uv run pytest -k selftest   # harness self-test only
```

- `tests/test_tools_yaml.py` runs every case in `escala/evals/tool_tests/*.yaml`
  against the tool code in `escala/cxas_app/escala/tools/<tool>/python_function/python_code.py`.
  Same YAML and expectation operators as `cxas test-tools` (reuses the SDK's
  `ToolEvals` checker). The tool sees a `context` global (`ToolContext`, state =
  `variables`); the response is shaped like the platform's
  (`{"response": {"result": ...}, "variables": ...}`), so `$.result.*` paths work unchanged.
  Divergence: `variables: {name: null}` (fetch app variable) cannot be resolved offline.
- `tests/test_callbacks.py` runs `escala/evals/callback_tests/tests/<agent>/<type>_callbacks/<base>/test.py`
  against the callback code read straight from the app dir, with the same
  `callback_libs` star-import prelude as `CallbackEvals`. It uses a subprocess pytest
  per test instead of the SDK's in-process runner because that one swallows output;
  no `sync-callbacks.py` step is needed locally.
- `tests/test_lint.py` runs `cxas lint --json` and fails on `severity=error`
  (skipped while the app has no `agents/`).

## 2. Platform, non-LLM (near-free; needs `cxas push` first)

```bash
uv run python .agents/skills/cxas-agent-foundry/scripts/sync-callbacks.py --from-local escala/cxas_app/escala  # untested here: the script imports a project-local config module
uv run cxas test-tools --app-name <APP_RESOURCE_NAME> --test-file escala/evals/tool_tests/<file>.yaml
```

`sync-callbacks.py` is only needed for `cxas test-callbacks` / SDK runners. Confirm exact
flags with `uv run cxas test-tools --help`.

## 3. Billable (Gemini credit, run sparingly)

Goldens, simulations, `cxas run`, `ci-test`, `run-session`, `llm-lint`. Any pytest test
that calls the platform must carry `@pytest.mark.billable`; run them with
`uv run pytest -m billable`.
