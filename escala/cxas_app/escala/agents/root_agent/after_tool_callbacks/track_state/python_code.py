"""after_tool_callback - track_state.

State bookkeeping that code can do: active_pnr, offered quotes (with totals),
confirmation reset and handoff outcome. Session state holds strings only, so
JSON objects are stored as strings. Always returns None (response untouched).
"""

import json
from typing import Any, Optional


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


def after_tool_callback(tool: Tool, input: dict[str, Any], callback_context: CallbackContext, tool_response: dict[str, Any]) -> Optional[dict[str, Any]]:
    payload = _payload(tool_response)
    if payload.get("status") != "ok":
        return None

    state = callback_context.state
    name = tool.name

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
