"""after_tool_callback - track_state.

State bookkeeping that code can do: active_pnr, offered quotes (with totals),
confirmation reset, handoff outcome and the conversation FSM (`fsm_state`,
`fsm_failures`). The FSM transition table is the single pure function
`next_fsm`; the LLM never sets the state. Session state holds strings only, so
JSON objects are stored as strings. Always returns None (response untouched).

It also publishes the step text of the new state in `fsm_instructions` (the
agent instructions reference it as {fsm_instructions}) right after the
transition, so the very next model call already sees the current step. The
Spanish step texts of both agents live here, keyed by (agent, state), and are
the single source of truth. After `transfer_to_agent` the TARGET agent's text
is published.
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

ROOT_AGENT = "root_agent"
REBOOKING_AGENT = "disruption_rebooking_agent"
AGENTS = (ROOT_AGENT, REBOOKING_AGENT)
# Tools that only the rebooking agent owns; used when the platform gives no agent name.
REBOOKING_ONLY_OPERATIONS = ("getFlightStatus", "getRebookingOptions", "createRebooking", "record_quote_confirmation")

_ROUTE = (
    "El trámite sobre la reserva lo lleva disruption_rebooking_agent: derivá a ese agente sin volver a pedir datos."
)

_ROOT_TEXTS = {
    "IDENTIFY": (
        "Paso actual: identificar la reserva.\n"
        "1. Primer mensaje: saludá brevemente y preguntá en qué lo podés ayudar; si ya contó su situación, retomala sin pedírsela de nuevo.\n"
        "2. Si habla de su reserva, un vuelo cancelado o demorado, un cambio o su equipaje y el código de reserva activo está vacío: pedí código de reserva y apellido de cualquier pasajero en la misma pregunta y usá escala_api_lookupBooking con last_name y pnr tal como los dijo. Si el código activo ya tiene valor, derivá a disruption_rebooking_agent.\n"
        "3. BOOKING_NOT_FOUND: pedile que revise el código una vez. Si sigue sin aparecer, pedí de a una cosa apellido, fecha del vuelo y ruta, y usá escala_api_lookupBooking con last_name, flight_date, origin y destination. Si tampoco aparece, ofrecé una persona (reason user_request, sin pnr). Si corrige un dato, avisá y repetí la consulta.\n"
        "4. Pregunta general: escala_api_searchFaq en español; respondé en una a tres oraciones con la fuente; si verified es false, agregá que hay que confirmarlo en aerolineas.com.ar; sin resultados, decí que no tenés información confiable y ofrecé una persona."
    ),
    "TRIAGE": (
        "Paso actual: reserva identificada.\n"
        "1. Si quiere resolver una cancelación, demora, pérdida de conexión, cambio de fecha o de vuelo, o preguntó por los extras de su reserva, derivá a disruption_rebooking_agent sin volver a pedir datos. Las preguntas sobre los extras de una reserva concreta también van a ese agente.\n"
        "2. Si solo tiene una consulta general: escala_api_searchFaq con la pregunta en español; respondé en una a tres oraciones y nombrá la fuente; si verified es false, agregá que hay que confirmarlo en aerolineas.com.ar; sin resultados, decí que no tenés información confiable y ofrecé una persona.\n"
        "3. Si corrige el código o el apellido, repetí escala_api_lookupBooking con el dato corregido."
    ),
    "FAQ": (
        "Paso actual: consulta general respondida.\n"
        "1. Si hace otra pregunta general, usá escala_api_searchFaq y respondé en una a tres oraciones con la fuente; si verified es false, aclará que hay que confirmarlo en aerolineas.com.ar.\n"
        "2. Si ahora quiere resolver algo de su reserva (cancelación, demora, cambio, extras), derivá a disruption_rebooking_agent sin volver a pedir datos.\n"
        "3. Si no necesita nada más, despedite en una oración y usá end_session."
    ),
    "HANDOFF": (
        "Paso actual: derivación registrada.\n"
        "Informá el case_id despacio y por partes, y decí que una persona va a retomar el caso con todo el contexto, por lo que no va a tener que repetir nada. Despedite en una oración y usá end_session. Si pide otra derivación, repetí la misma idempotency_key para obtener el mismo caso."
    ),
    "FAILURE": (
        "Paso actual: falla del sistema o bloqueo.\n"
        "Explicá con claridad qué queda pendiente y por qué, sin adivinar ningún dato, y ofrecé la derivación a una persona. Si acepta, createHandoffCase con el reason que corresponda (upstream_failure si el sistema no responde). "
        "Si createHandoffCase falla dos veces, usá set_session_outcome con outcome failed, decí que no pudiste registrar la derivación y que lo intente más tarde, y despedite."
    ),
}
_ROOT_TEXTS["OPTIONS"] = _ROUTE
_ROOT_TEXTS["CONFIRM"] = _ROUTE
_ROOT_TEXTS["DONE"] = _ROUTE + " Si no necesita nada más, despedite en una oración y usá end_session."


_TRIAGE = (
    "Paso actual: entender el pedido y consultar opciones.\n"
    "1. Resumí en una oración lo que entendiste de la reserva y del pedido (vuelo cancelado, conexión perdida, cantidad de pasajeros, quién hizo el check-in, equipaje pagado), usando solo datos de la reserva.\n"
    "2. Si se queja de una demora y no sabés el estado, usá escala_api_getFlightStatus con el número de vuelo y la fecha. Si la demora es informativa y no hay cambio necesario, informalo y ofrecé explorar un cambio de fecha. Si hay equipo reducido (equipment_downgrade), explicá que pierde las asignaciones de asiento y ofrecé mantener el vuelo actual o ver alternativas.\n"
    "3. Cambio involuntario (vuelo cancelado o alterado): si no dijo hasta cuándo puede llegar, preguntalo; usá escala_api_getRebookingOptions con pnr = el código de reserva activo y deadline tal como lo dijo (today, tomorrow o AAAA-MM-DD). No calculás fechas vos.\n"
    "4. Cambio voluntario: pedí la fecha a la que quiere viajar si no la dijo y usá escala_api_getRebookingOptions con pnr y target_date AAAA-MM-DD.\n"
    "5. Cambio de destino: escala_api_getRebookingOptions con pnr y destination (código IATA)."
)

_REBOOKING_TEXTS = {
    "IDENTIFY": (
        "Paso actual: la reserva todavía no está identificada. Usá escala_api_lookupBooking con el código y el apellido que dio el pasajero (si faltan, pedilos en una sola pregunta) y después seguí con el pedido."
    ),
    "TRIAGE": _TRIAGE,
    "FAQ": "Acabás de responder una consulta general; retomá el pedido pendiente.\n" + _TRIAGE,
    "OPTIONS": (
        "Paso actual: opciones consultadas, esperando la elección.\n"
        "1. Presentá solo las opciones ejecutables con sus diferencias (directo o con escala, llegada) y por qué alguna no entra (por ejemplo asientos para el grupo). Si options viene vacío y hay options_after_deadline, decí que nada llega a la fecha límite, nombrá la primera disponible con su fecha aclarando que NO cumple la fecha límite y preguntá si la quiere.\n"
        "2. Cambio voluntario: explicá que tiene costo; abrí cargo, diferencia de tarifa y reemisión de extras, y el total, aclarando que es simulado y no se cobra nada real.\n"
        "3. Solo una parte del grupo: no se puede acá; ofrecé opciones para todos o derivar (reason partial_party).\n"
        "4. Esperá que elija una ejecutable; si duda, resumí la diferencia principal. Si rechaza todas, no se ejecuta nada: ofrecé las posteriores (options_after_deadline) si las hay y, si tampoco las quiere, ofrecé derivar (reason no_alternatives).\n"
        "5. Cuando elige, hacé un resumen corto (máximo 3 frases, sin listas): el vuelo nuevo; solo lo que cambia para cada pasajero (por ejemplo, a quién se le cancela el check-in y debe rehacerlo, qué extra no se transfiere o tiene cargo); agrupá lo que es igual para todos (\"el equipaje de los dos se transfiere sin costo\"). Si el total es cero, decí \"sin costo\"; si es mayor, el importe (simulado). Terminá con \"¿Lo confirmo?\" o, si hay costo, \"¿Confirmás por\" y el importe. Si el pasajero pide más detalle, dáselo. Si no acepta, volvé a elegir sin ejecutar nada.\n"
        "6. Con un sí explícito a este detalle (si el total es cero alcanza con un \"sí\"; si es mayor, el sí tiene que incluir el importe, y si dijo solo \"sí\" repetí el importe una vez) usá record_quote_confirmation con el quote_id elegido y el total en pesos confirmado. Con QUOTE_NOT_OFFERED o TOTAL_MISMATCH, pedí las opciones de nuevo o releé el total exacto."
    ),
    "CONFIRM": (
        "Paso actual: confirmación registrada, falta ejecutar.\n"
        "1. Usá escala_api_createRebooking con quote_id, confirmed true, confirmed_total_ars igual al total confirmado e idempotency_key \"rebook-\" seguido del quote_id.\n"
        "2. CONFIRMATION_REQUIRED: no le pidas al pasajero que repita lo que ya confirmó. Registrá de nuevo con record_quote_confirmation y reintentá una sola vez; si vuelve a fallar, decí que hubo un problema técnico, que no se cambió nada, y ofrecé derivar (reason technical_issue).\n"
        "3. QUOTE_EXPIRED o QUOTE_STALE: nada cambió; pedí las opciones de nuevo con escala_api_getRebookingOptions, leé el detalle otra vez y pedí confirmar de nuevo.\n"
        "4. TOTAL_MISMATCH: nada cambió; releé el total exacto y pedí confirmar."
    ),
    "DONE": (
        "Paso actual: cambio ejecutado.\n"
        "1. Informá el nuevo itinerario, el código de confirmación y el comprobante (simulado). Informá por pasajero el resultado de los extras y lo que queda pendiente según el sistema (volver a hacer el check-in, volver a elegir asiento). Si already_applied es true, decí que ya estaba hecho y repetí el mismo código. No afirmes nada que la respuesta no diga.\n"
        "2. Si repite \"sí\" o \"confirmá\": respondé con el resultado ya informado y el mismo código; solo si no estás seguro del estado, repetí escala_api_createRebooking con la misma idempotency_key.\n"
        "3. Un pedido nuevo sobre esta reserva es un cambio nuevo: consultá escala_api_getRebookingOptions con el dato nuevo; si no hay más opciones, explicalo y ofrecé derivar a una persona.\n"
        "4. Si no necesita nada más: resumí en dos oraciones qué cambió y qué queda pendiente, usá set_session_outcome con outcome resolved, despedite y usá end_session."
    ),
    "HANDOFF": (
        "Paso actual: derivación registrada.\n"
        "Informá el case_id despacio y por partes, y decí que una persona va a retomar el caso con todo el contexto, por lo que no va a tener que repetir nada. Despedite en una oración y usá end_session. Si pide otra derivación, repetí la misma idempotency_key para obtener el mismo caso."
    ),
    "FAILURE": (
        "Paso actual: bloqueo o falla; no se ejecuta nada por este camino.\n"
        "1. POLICY_FARE_NOT_CHANGEABLE: explicá que la tarifa no permite cambios voluntarios, apoyate en escala_api_searchFaq con \"cambios tarifa\" citando la fuente y ofrecé derivar (reason policy_block). No intentes ejecutar nada.\n"
        "2. DESTINATION_CHANGE_NOT_SUPPORTED: mantené el contexto (misma reserva, mismos pasajeros), explicá que el destino no se puede cambiar por acá y ofrecé seguir con el cambio de fecha (consultá de nuevo escala_api_getRebookingOptions con target_date; el presupuesto anterior ya no vale) o derivar (reason destination_change). VOLUNTARY_CHANGES_DISABLED: explicalo y ofrecé derivar.\n"
        "3. Sin opciones ni posteriores: explicalo y ofrecé derivar (reason no_alternatives). Opción con ANCILLARY_NEEDS_REVIEW: explicá por qué y ofrecé derivar (reason ancillary_review).\n"
        "4. El sistema no responde (falló dos veces): decilo con claridad, no adivines estado ni disponibilidad y ofrecé derivar (reason upstream_failure) o intentar más tarde.\n"
        "5. Si acepta la derivación, usá createHandoffCase. Si createHandoffCase falla dos veces, usá set_session_outcome con outcome failed, decí que no pudiste registrar la derivación y que lo intente más tarde, y despedite."
    ),
}


STEP_TEXTS = {
    ROOT_AGENT: _ROOT_TEXTS,
    REBOOKING_AGENT: _REBOOKING_TEXTS,
}


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


def step_text(agent: str, fsm_state: str) -> str:
    """Step text for (agent, state); unknown agent -> root, unknown state -> IDENTIFY."""
    texts = STEP_TEXTS.get(agent, STEP_TEXTS[ROOT_AGENT])
    return texts.get(fsm_state) or texts["IDENTIFY"]


def _agent_of(name: Any) -> str:
    # Accepts a short name or a full resource path (".../agents/<name>").
    tail = str(name or "").rstrip("/").split("/")[-1]
    return tail if tail in AGENTS else ""


def _transfer_target(args: Any) -> str:
    # The args key of transfer_to_agent is not documented; scan every value.
    if not isinstance(args, dict):
        return ""
    for value in args.values():
        target = _agent_of(value)
        if target:
            return target
    return ""


def _current_agent(callback_context: Any, operation: str) -> str:
    agent = _agent_of(getattr(callback_context, "agent_name", ""))
    if agent:
        return agent
    return REBOOKING_AGENT if operation in REBOOKING_ONLY_OPERATIONS else ""


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

    # Publish the step text now: {fsm_instructions} is resolved before before_model runs.
    if name == "transfer_to_agent":
        agent = _transfer_target(input)
    else:
        agent = _current_agent(callback_context, _operation(name))
    if agent:
        text = step_text(agent, new_state)
        if state.get("fsm_instructions") != text:
            state["fsm_instructions"] = text

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
