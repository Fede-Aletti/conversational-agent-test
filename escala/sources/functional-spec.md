# Escala — Functional Specification

> Requirements source for the `cxas-agent-foundry` build flow (gate 1).
> The TDD (`escala/tdd.md`) is derived from this document and must be approved before scaffolding.
> Status: **DRAFT — definitions pending**. Fill every `TODO` before starting the TDD.

## 1. Fixed decisions

| Item | Value |
|---|---|
| App | `projects/gen-lang-client-0907599903/locations/us/apps/escala` |
| GCP project | `gen-lang-client-0907599903` (`conversational-agent`) |
| Location | `us` |
| Channels | Text **and** voice |
| Time zone | `America/Argentina/Buenos_Aires` |
| Default eval modality | `text` (`escala/gecx-config.json`) |
| Credit policy | Platform evals and debug loops are **opt-in only**. Default verification is offline: `uv run pytest` + `cxas lint` (see `TESTING.md`). |

## 2. Purpose

- **What the agent does:** TODO
- **Who the users are:** TODO
- **Business goal / success metric:** TODO (e.g. containment rate, resolved requests)

## 3. Language and persona

- **Languages:** TODO (e.g. Spanish (es-AR) only, or multilingual)
- **Tone / persona:** TODO
- **Voice specifics:** TODO (greeting, voice, barge-in, DTMF needs)

## 4. Critical user journeys (intents)

| ID | Journey | Trigger examples | Expected outcome |
|---|---|---|---|
| CUJ-01 | TODO | TODO | TODO |

## 5. Tools and integrations

| Tool | Purpose | Backend / API | Inputs | Outputs | Mock available? |
|---|---|---|---|---|---|
| TODO | | | | | |

## 6. Authentication and data

- **Auth flow:** TODO (none, identifier lookup, OTP, ...)
- **Session variables:** TODO
- **Sensitive data (PII) handling:** TODO

## 7. Escalation and end of conversation

- **Escalation to a human:** TODO (when, and how: transfer, ticket, callback)
- **End-of-session rules:** TODO

## 8. Out of scope and guardrails

- **Must not do:** TODO
- **Topics to refuse or redirect:** TODO

## 9. Supporting material

- Sample conversations: TODO (save under `escala/sources/`)
- Customer profiles / mock data: TODO

## 10. Open questions

- TODO
