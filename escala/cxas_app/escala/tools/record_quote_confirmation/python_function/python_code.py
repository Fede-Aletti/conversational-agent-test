"""record_quote_confirmation - state-only tool.

Stores the quote the passenger explicitly confirmed, together with the total
they confirmed. The before-tool callback `guard_mutating_calls` compares these
values with the createRebooking arguments. Session state holds strings only.
"""

import json


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


def record_quote_confirmation(quote_id: str, total_ars: int) -> dict:
    """Record the passenger's explicit confirmation of an offered quote and its total.

    Args:
        quote_id: The quote_id of the option the passenger confirmed, from the latest rebooking options.
        total_ars: The total in ARS the passenger confirmed (0 for involuntary changes).

    Returns:
        dict: status success with the recorded values, or an error with agent_action.
    """
    offered = _as_dict(context.state.get("offered_quotes"))
    if quote_id not in offered:
        return {
            "status": "error",
            "error_code": "QUOTE_NOT_OFFERED",
            "agent_action": "Ese presupuesto no fue ofrecido en las opciones actuales. Pedí las opciones de nuevo, volvé a leer el detalle y a pedir la confirmación.",
        }

    totals = _as_dict(context.state.get("offered_totals"))
    if quote_id in totals and int(totals[quote_id]) != int(total_ars):
        return {
            "status": "error",
            "error_code": "TOTAL_MISMATCH",
            "agent_action": "El total no coincide con el ofrecido. Volvé a leer el total exacto de la opción y pedí la confirmación de nuevo.",
        }

    context.state["confirmed_quote_id"] = quote_id
    context.state["confirmed_total_ars"] = str(int(total_ars))
    return {
        "status": "success",
        "confirmed_quote_id": quote_id,
        "confirmed_total_ars": int(total_ars),
    }
