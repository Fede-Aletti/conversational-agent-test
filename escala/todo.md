# Escala — Build Steps

Checklist from `.agents/skills/cxas-agent-foundry/references/build.md` → "Full Build" (gates 0-6).
Eval and debug steps are skipped by default per the credit policy in `sources/project-context.md`.

- [x] 0. Initialize `escala/todo.md` (gate 0)
- [x] 1. Gather requirements from `sources/prd.md` + `sources/project-context.md`; post a one-message summary of purpose, modality, intents, tools and auth flow (gate 1)
- [ ] 2. TDD (`escala/tdd.md`) + explicit user approval (gate 2) — draft written, awaiting user approval
- [ ] 3. Scaffold app into `cxas_app/escala/` (gate 3)
- [ ] 4. Lint clean + offline tests (`uv run pytest`) green (gate 4)
- [~] 5. Generate platform evals — SKIPPED (credit policy). Write offline tool YAML cases and callback tests instead.
- [ ] 6. Push (`cxas push`) after a manual lint; `gate-check.py` only if the user approves platform checks (gate 6)
