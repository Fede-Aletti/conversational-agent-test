@AGENTS.md

# Escala project rules

- Active project: `escala` (see `.active-project`). Requirements: `escala/sources/prd.md`. Fixed decisions and credit policy: `escala/sources/project-context.md`. Progress: `escala/todo.md`.
- Use the `cxas-agent-foundry` skill for building the bot. Start at the first unchecked step in `escala/todo.md`.
- Run the CLI as `uv run cxas ...`.
- Never run billable checks (platform evals, `cxas run`, `ci-test`, `run-session`, `llm-lint`, foundry debug loop) unless the user explicitly asks.
- Lint manually before every `cxas push`: the SCRAPI pre-push hook calls bare `cxas`, so it silently passes when `cxas` is not on `PATH`.
- Offline tests: `uv run pytest` (see `TESTING.md`).
