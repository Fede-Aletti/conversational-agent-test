"""before_tool_callback - guard_mutating_calls (defense in depth).

Blocks createRebooking unless the passenger confirmed the CURRENT quote and its
total. The backend stays authoritative (confirmed flag, quote, total, idempotency);
this narrows the model-skips-consent risk but record_quote_confirmation is itself
LLM-called, so it is a seatbelt and not proof of consent.
"""

import json
from typing import Any, Optional

TOOL_OPERATION = "createRebooking"


def _is_operation(tool_name: str, operation: str) -> bool:
    # Toolset tools are named {toolset}_{operationId}; verify at push.
    return tool_name == operation or tool_name.endswith("_" + operation)


def _as_dict(raw) -> dict:
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str) and raw.strip():
        try:
            parsed = json.loads(raw)
        except ValueError:
            return {}
        return parsed if isinstance(parsed, dict) else {}
    return {}


def _to_int(value) -> Optional[int]:
    # Models send JSON numbers as floats (0.0, 45000.0); accept integral values only.
    if isinstance(value, bool) or value is None:
        return None
    try:
        number = float(str(value).strip())
    except (TypeError, ValueError):
        return None
    return int(number) if number.is_integer() else None


def _blocked(reason: str) -> dict:
    return {
        "status": "error",
        "error_code": "CONFIRMATION_REQUIRED",
        "retryable": False,
        "agent_action": (
            "No se ejecutó nada. " + reason + " Si el pasajero todavía no confirmó, resumí el cambio "
            "y pedí su sí. Si ya confirmó, registralo con record_quote_confirmation y reintentá una "
            "sola vez, sin pedirle que repita nada."
        ),
    }


def before_tool_callback(tool: Tool, input: dict[str, Any], callback_context: CallbackContext) -> Optional[dict[str, Any]]:
    if not _is_operation(tool.name, TOOL_OPERATION):
        return None

    state = callback_context.state
    quote_id = input.get("quote_id")
    offered = _as_dict(state.get("offered_quotes"))
    totals = _as_dict(state.get("offered_totals"))

    if not quote_id or quote_id not in offered:
        return _blocked("El presupuesto no corresponde a las opciones vigentes.")
    if state.get("confirmed_quote_id") != quote_id:
        return _blocked("El pasajero todavía no confirmó este presupuesto.")
    if input.get("confirmed") is not True:
        return _blocked("Falta la confirmación explícita (confirmed=true).")

    sent_total = _to_int(input.get("confirmed_total_ars"))
    confirmed_total = _to_int(state.get("confirmed_total_ars"))
    offered_total = _to_int(totals.get(quote_id))
    if sent_total is None or sent_total != confirmed_total or sent_total != offered_total:
        return _blocked("El total enviado no coincide con el total ofrecido y confirmado.")

    return None
