"""before_model_callback - inject_fsm_instructions.

Publishes the step text of the current conversation state in `fsm_instructions`,
which the agent instruction references as {fsm_instructions}. The state itself
(`fsm_state`) is computed by the `track_state` after_tool callback, never by the
LLM. Missing or unknown state falls back to IDENTIFY. The variable is written
only when it changes, to avoid repeated state updates in the conversation.
"""

from typing import Optional

DEFAULT_STATE = "IDENTIFY"

_TRIAGE = (
    "Paso actual: entender el pedido y consultar opciones.\n"
    "1. Resumí en una oración lo que entendiste de la reserva y del pedido (vuelo cancelado, conexión perdida, cantidad de pasajeros, quién hizo el check-in, equipaje pagado), usando solo datos de la reserva.\n"
    "2. Si se queja de una demora y no sabés el estado, usá escala_api_getFlightStatus con el número de vuelo y la fecha. Si la demora es informativa y no hay cambio necesario, informalo y ofrecé explorar un cambio de fecha. Si hay equipo reducido (equipment_downgrade), explicá que pierde las asignaciones de asiento y ofrecé mantener el vuelo actual o ver alternativas.\n"
    "3. Cambio involuntario (vuelo cancelado o alterado): si no dijo hasta cuándo puede llegar, preguntalo; usá escala_api_getRebookingOptions con pnr = el código de reserva activo y deadline tal como lo dijo (today, tomorrow o AAAA-MM-DD). No calculás fechas vos.\n"
    "4. Cambio voluntario: pedí la fecha a la que quiere viajar si no la dijo y usá escala_api_getRebookingOptions con pnr y target_date AAAA-MM-DD.\n"
    "5. Cambio de destino: escala_api_getRebookingOptions con pnr y destination (código IATA)."
)

STEP_TEXTS = {
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
        "5. Cuando elige, leé el detalle pasajero por pasajero con su nombre: vuelos nuevos, check-in (si requires_checkin_cancellation es true se cancela y tiene que volver a hacerlo), cada extra según el sistema (se transfiere, con cargo, no se transfiere o requiere revisión) y el total (simulado). Terminá con \"¿Confirmo el cambio para todos?\"; si el total es mayor que cero, \"¿Confirmás el cambio por\" y el importe. Si no acepta, volvé a elegir sin ejecutar nada.\n"
        "6. Con un sí explícito a este detalle (si el total es mayor que cero, el sí tiene que incluir el importe; si dijo solo \"sí\", repetí el total y pedí de nuevo) usá record_quote_confirmation con el quote_id elegido y el total en pesos confirmado. Con QUOTE_NOT_OFFERED o TOTAL_MISMATCH, pedí las opciones de nuevo o releé el total exacto."
    ),
    "CONFIRM": (
        "Paso actual: confirmación registrada, falta ejecutar.\n"
        "1. Usá escala_api_createRebooking con quote_id, confirmed true, confirmed_total_ars igual al total confirmado e idempotency_key \"rebook-\" seguido del quote_id.\n"
        "2. CONFIRMATION_REQUIRED: hacé bien la lectura del detalle y pedí la confirmación antes de reintentar.\n"
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


def select_block(fsm_state) -> str:
    key = fsm_state if fsm_state in STEP_TEXTS else DEFAULT_STATE
    return STEP_TEXTS[key]


def before_model_callback(callback_context: CallbackContext, llm_request: LlmRequest) -> Optional[LlmResponse]:
    state = callback_context.state
    block = select_block(state.get("fsm_state"))
    if state.get("fsm_instructions") != block:
        state["fsm_instructions"] = block
    return None
