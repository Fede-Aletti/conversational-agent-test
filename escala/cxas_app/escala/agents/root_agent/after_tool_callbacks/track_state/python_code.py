"""after_tool_callback - track_state.

State bookkeeping that code can do: active_pnr, offered quotes (with totals),
confirmation reset, handoff outcome and the conversation FSM (`fsm_state`,
`fsm_failures`). The FSM transition table is the single pure function
`next_fsm`; the LLM never sets the state. Session state holds strings only, so
JSON objects are stored as strings. Always returns None (response untouched).
Keep this file byte-identical across both agents (callbacks cannot share code).
"""

import json
from typing import Any, Optional


FSM_STATES = ("IDENTIFY", "TRIAGE", "FAQ", "OPTIONS", "CONFIRM", "DONE", "HANDOFF", "FAILURE")
KNOWN_OPERATIONS = (
    "lookupBooking",
    "getFlightStatus",
    "getRebookingOptions",
    "createRebooking",
    "searchFaq",
    "createHandoffCase",
    "record_quote_confirmation",
)
# Non-retryable getRebookingOptions errors that end the self-service path.
BLOCKING_ERROR_CODES = ("DESTINATION_CHANGE_NOT_SUPPORTED", "VOLUNTARY_CHANGES_DISABLED")
MAX_RETRYABLE_FAILURES = 2


def _is_operation(tool_name: str, operation: str) -> bool:
    # Toolset tools are named {toolset}_{operationId}; verify at push.
    return tool_name == operation or tool_name.endswith("_" + operation)


def _payload(tool_response: dict[str, Any]) -> dict[str, Any]:
    # Tolerate a wrapped response ({"output": {...}}) until verified on the platform.
    if isinstance(tool_response, dict) and "status" not in tool_response:
        inner = tool_response.get("output")
        if isinstance(inner, dict):
            return inner
    return tool_response if isinstance(tool_response, dict) else {}


def _collect_quotes(payload: dict[str, Any]) -> tuple[dict, dict]:
    quotes: dict = {}
    totals: dict = {}
    for key in ("options", "options_after_deadline"):
        for option in payload.get(key) or []:
            quote_id = option.get("quote_id")
            if not quote_id or option.get("executable") is False:
                continue
            quotes[quote_id] = option.get("expires_at", "")
            totals[quote_id] = int((option.get("payment") or {}).get("total_ars") or 0)
    return quotes, totals


def _operation(tool_name: str) -> str:
    for operation in KNOWN_OPERATIONS:
        if _is_operation(tool_name, operation):
            return operation
    return ""


def next_fsm(fsm_state: str, failures: int, operation: str, payload: dict[str, Any]) -> tuple[str, int]:
    """Pure transition function: (state, consecutive retryable failures, tool, result) -> (state, failures).

    Unknown state falls back to IDENTIFY; unknown tools and unknown results leave the state unchanged.
    """
    current = fsm_state if fsm_state in FSM_STATES else "IDENTIFY"
    if operation not in KNOWN_OPERATIONS or not isinstance(payload, dict):
        return current, failures

    if payload.get("status") in ("ok", "success"):
        if operation == "lookupBooking":
            return "TRIAGE", 0
        if operation == "getRebookingOptions":
            quotes, _ = _collect_quotes(payload)
            return ("OPTIONS" if quotes else "FAILURE"), 0
        if operation == "record_quote_confirmation":
            return "CONFIRM", 0
        if operation == "createRebooking":
            return "DONE", 0
        if operation == "createHandoffCase":
            return "HANDOFF", 0
        if operation == "searchFaq" and current in ("TRIAGE", "FAQ"):
            return "FAQ", 0
        return current, 0

    if payload.get("status") == "error":
        if payload.get("retryable") is True:
            failures += 1
            return ("FAILURE" if failures >= MAX_RETRYABLE_FAILURES else current), failures
        if operation == "getRebookingOptions" and payload.get("error_code") in BLOCKING_ERROR_CODES:
            return "FAILURE", 0
        return current, 0

    return current, failures


def _to_count(raw: Any) -> int:
    try:
        return max(int(str(raw or "0").strip()), 0)
    except ValueError:
        return 0


def after_tool_callback(tool: Tool, input: dict[str, Any], callback_context: CallbackContext, tool_response: dict[str, Any]) -> Optional[dict[str, Any]]:
    payload = _payload(tool_response)
    state = callback_context.state
    name = tool.name

    new_state, new_failures = next_fsm(
        state.get("fsm_state") or "IDENTIFY", _to_count(state.get("fsm_failures")), _operation(name), payload
    )
    state["fsm_state"] = new_state
    state["fsm_failures"] = str(new_failures)

    if payload.get("status") != "ok":
        return None

    if _is_operation(name, "lookupBooking"):
        pnr = payload.get("pnr")
        if pnr:
            state["active_pnr"] = str(pnr).upper()
    elif _is_operation(name, "getRebookingOptions"):
        quotes, totals = _collect_quotes(payload)
        state["offered_quotes"] = json.dumps(quotes)
        state["offered_totals"] = json.dumps(totals)
        state["confirmed_quote_id"] = ""
        state["confirmed_total_ars"] = ""
    elif _is_operation(name, "createRebooking"):
        state["confirmed_quote_id"] = ""
        state["confirmed_total_ars"] = ""
    elif _is_operation(name, "createHandoffCase"):
        state["session_outcome"] = "handed_off"

    return None
