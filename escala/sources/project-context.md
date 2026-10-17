# Escala — Project Context

Fixed technical decisions for the `escala` bot. Business requirements live in `prd.md` (provided by the product owner).

| Item | Value |
|---|---|
| App | `projects/gen-lang-client-0907599903/locations/us/apps/escala` (exists, empty) |
| GCP project | `gen-lang-client-0907599903` (`conversational-agent`) |
| Location | `us` |
| Channels | Text **and** voice |
| Time zone | `America/Argentina/Buenos_Aires` |
| Default eval modality | `text` (`escala/gecx-config.json`) |
| Local app dir | `escala/cxas_app/escala/` |

## Credit policy

Platform evals (goldens, simulations, `cxas run`, `ci-test`), `run-session`, `llm-lint` and the foundry debug loop call Gemini and consume credit. They are **opt-in only**: run them only when the user explicitly asks.

Default verification:

1. `uv run cxas lint --app-dir escala/cxas_app/escala` (offline)
2. `uv run pytest` (offline harness, see `TESTING.md`)
3. `uv run cxas test-tools ...` (platform, no LLM) only occasionally. Run it once when the first tool exists to confirm the local response shape `{"result": ...}` matches the platform.
