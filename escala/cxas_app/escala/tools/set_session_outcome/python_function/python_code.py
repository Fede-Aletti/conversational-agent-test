"""set_session_outcome - state-only tool for analytics.

A handoff outcome is written by the after-tool callback `track_state`, and this
tool never overwrites it.
"""

VALID_OUTCOMES = ("resolved", "failed")


def set_session_outcome(outcome: str) -> dict:
    """Record the session outcome for analytics.

    Args:
        outcome: Either resolved (the request was completed) or failed (nothing resolved and no handoff).

    Returns:
        dict: status success with the stored outcome, or an error with agent_action.
    """
    value = (outcome or "").strip().lower()
    if value not in VALID_OUTCOMES:
        return {
            "status": "error",
            "error_code": "INVALID_OUTCOME",
            "agent_action": "El resultado debe ser resolved o failed. Reintentá con uno de esos valores.",
        }

    if context.state.get("session_outcome") == "handed_off":
        return {"status": "success", "session_outcome": "handed_off", "kept": True}

    context.state["session_outcome"] = value
    return {"status": "success", "session_outcome": value}
