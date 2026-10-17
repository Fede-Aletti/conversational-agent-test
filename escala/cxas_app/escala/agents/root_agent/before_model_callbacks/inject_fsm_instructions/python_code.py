"""before_model_callback - inject_fsm_instructions.

Publishes the step text of the current conversation state in `fsm_instructions`,
which the agent instruction references as {fsm_instructions}. The state itself
(`fsm_state`) is computed by the `track_state` after_tool callback, never by the
LLM. Missing or unknown state falls back to IDENTIFY. The variable is written
only when it changes, to avoid repeated state updates in the conversation.
"""

from typing import Optional

DEFAULT_STATE = "IDENTIFY"

_ROUTE = (
    "El trámite sobre la reserva lo lleva disruption_rebooking_agent: derivá a ese agente sin volver a pedir datos."
)

STEP_TEXTS = {
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
STEP_TEXTS["OPTIONS"] = _ROUTE
STEP_TEXTS["CONFIRM"] = _ROUTE
STEP_TEXTS["DONE"] = _ROUTE + " Si no necesita nada más, despedite en una oración y usá end_session."


def select_block(fsm_state) -> str:
    key = fsm_state if fsm_state in STEP_TEXTS else DEFAULT_STATE
    return STEP_TEXTS[key]


def before_model_callback(callback_context: CallbackContext, llm_request: LlmRequest) -> Optional[LlmResponse]:
    state = callback_context.state
    block = select_block(state.get("fsm_state"))
    if state.get("fsm_instructions") != block:
        state["fsm_instructions"] = block
    return None
