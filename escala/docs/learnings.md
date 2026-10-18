# Escala — Learnings from manual simulator sessions

Source sessions (CES simulator, text): `simulator-17c0c674`, `simulator-f9efbac9`, `simulator-70834326`, `simulator-6fdcb2ef`, `simulator-b4030042` (first fully resolved run).

## Platform

- Default CES token quota is 1,000 tokens/min per base model; any real session exceeds it on turn 1. Quota is per physical region (`us-central1`, `us-east1`), not `us`.
- `es-AR` is rejected as a language code; use `es-419` and keep voseo in the instructions.
- OpenAPI toolset tools are exposed as `escala_api_<operationId>`; `Tools.execute_tool` runs them without an LLM (cheap contract check).
- Minimal response schemas in the toolset do not truncate tool responses.
- Instruction variables (`{fsm_instructions}`) must be updated in `after_tool`, not `before_model`: the request is already built when `before_model` runs (one-call lag).

## Model behavior

- Tool args arrive as floats for JSON numbers (`0.0`). Never parse with `int(str(x))`.
- A filler ("Estoy consultando, un momento") emitted together with a tool call makes the model return an empty reply after the result. Do not instruct fillers.
- FAQ snippets leak into booking-specific answers (invented "undo check-in on the web"). Booking facts must come only from booking/option responses.
- Turn 0 calls `searchFaq` on a disruption message before identifying the booking: wasted call (~1 extra LLM round trip).
- Codes are read letter by letter even in text chat; the voice-only rule is not respected.

## Cost and latency (resolved run `simulator-b4030042`)

| Metric | Value |
|---|---|
| Turns | 6 |
| Perceived latency | 19.2 s total |
| Input tokens | 88,870 (~14.8k per turn) |
| Heaviest turns | tool turns with 3+ LLM calls (17–23k) |

Per-call input dropped from ~12k to ~2.5–7k after the lean toolset schema and FSM instructions; remaining weight is history plus large tool payloads (`getRebookingOptions`).

## Next levers

1. Compact backend responses (agent-facing summary fields) to shrink history.
2. Root agent: go straight to identification on disruption messages (no FAQ call).
3. Respect `channel` for letter-by-letter reading.
