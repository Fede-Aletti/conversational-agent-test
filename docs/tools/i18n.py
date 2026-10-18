"""Per-language strings for the README diagrams and the demo GIF.

English is the source language: every user-visible string is written in English in the generators and passes
through `tr()`. The ES catalog below is the single place with the Spanish text. Technical identifiers (state
names, tool names, callbacks, code) are intentionally absent so they stay unchanged in every language.
"""

from __future__ import annotations

LANGS = ("en", "es")
_lang = "en"


def set_lang(lang: str) -> None:
    global _lang
    if lang not in LANGS:
        raise ValueError(f"unsupported language: {lang}")
    _lang = lang


def get_lang() -> str:
    return _lang


def suffix(lang: str | None = None) -> str:
    """File name suffix: '' for English (keeps current names), '.es' for Spanish."""
    return "" if (lang or _lang) == "en" else f".{lang or _lang}"


def tr(s: str) -> str:
    return s if _lang == "en" else ES.get(s, s)


ES: dict[str, str] = {
    # ---- FSM -------------------------------------------------------------------------------
    "ask PNR + surname": "pide PNR + apellido",
    "booking known": "reserva conocida",
    "wait for the choice": "espera la elección",
    "answer with sources": "responde con fuentes",
    "confirmation recorded": "confirm. registrada",
    "result + close": "resultado + cierre",
    "human case created": "caso humano creado",
    "apologize, offer human": "se disculpa, deriva",
    "lookupBooking ok": "lookupBooking ok",
    "ok · 1+ quotes": "ok · 1+ cotizaciones",
    "no quotes returned": "sin cotizaciones",
    "blocking error code": "código de error bloqueante",
    "2 retryable errors": "2 errores reintentables",
    "from any state": "desde cualquier estado",
    "start": "inicio",
    "State machine · track_state callback": "Máquina de estados · callback track_state",
    "Conversation FSM": "FSM de la conversación",
    "Eight states, one pure transition function. The model never sets the state.": "Ocho estados, una función de transición pura. El modelo nunca fija el estado.",
    "next_fsm(state, failures, tool, result) runs in the after_tool callback of both agents. Each transition": "next_fsm(state, failures, tool, result) corre en el callback after_tool de ambos agentes. Cada transición",
    "publishes that state's step text as {fsm_instructions}, so the very next model call sees it.": "publica el texto de paso de ese estado como {fsm_instructions}, así la siguiente llamada al modelo ya lo ve.",
    "lookupBooking ok → TRIAGE from any state · unlisted (tool, state) pairs keep the current state · DONE is the focal outcome": "lookupBooking ok → TRIAGE desde cualquier estado · pares (tool, estado) no listados: mismo estado · DONE es el foco",
    "Escala conversation state machine": "Máquina de estados de la conversación de Escala",
    "States IDENTIFY, TRIAGE, FAQ, OPTIONS, CONFIRM, DONE, HANDOFF and FAILURE with the tool results that trigger each transition.": "Estados IDENTIFY, TRIAGE, FAQ, OPTIONS, CONFIRM, DONE, HANDOFF y FAILURE con los resultados de herramientas que disparan cada transición.",
    # ---- Architecture ----------------------------------------------------------------------
    "Architecture · Escala prototype": "Arquitectura · prototipo Escala",
    "LLM understands and phrases, code decides": "El LLM entiende y redacta, el código decide",
    "Conversational layer on CX Agent Studio, deterministic backend on Firebase (simulated airline).": "Capa conversacional en CX Agent Studio, backend determinista en Firebase (aerolínea simulada).",
    "Passenger": "Pasajero",
    "text chat · voice": "chat de texto · voz",
    "message": "mensaje",
    "greet · disclaimer": "saluda · aviso legal",
    "identify · FAQ · triage": "identifica · FAQ · triage",
    "disruption options": "opciones ante disrupción",
    "read-back · confirm": "lectura · confirmación",
    "transfer": "traspaso",
    "Callbacks · guardrails written in code": "Callbacks · barreras escritas en código",
    "blocks unconsented writes": "bloquea sin permiso",
    "experimental-prototype notice": "aviso de prototipo experimental",
    "Python tools": "Herramientas Python",
    "REST/JSON, lean schemas": "REST/JSON, esquemas livianos",
    "escala_api_*  ·  6 operations": "escala_api_*  ·  6 operaciones",
    "HTTPS + ID token": "HTTPS + ID token",
    "HTTP layer": "Capa HTTP",
    "Express router · OpenAPI contract · validation": "Router Express · contrato OpenAPI · validación",
    "Bounded contexts · hexagonal": "Contextos acotados · hexagonal",
    "lookup · identity": "búsqueda · identidad",
    "status · alternatives": "estado · alternativas",
    "quotes · createRebooking": "cotiz. · createRebooking",
    "transfer outcomes": "resultados de traslado",
    "fees · FAQ rules": "tarifas · reglas de FAQ",
    "human cases": "casos humanos",
    "shared kernel": "núcleo compartido",
    "domain has no Firebase imports": "el dominio no importa Firebase",
    "in-memory (tests)  |  Firestore (runtime)": "en memoria (tests)  |  Firestore (runtime)",
    "Admin SDK · transactions": "Admin SDK · transacciones",
    "seeded flights, bookings": "vuelos y reservas de prueba",
    "quotes · rebookings · idempotency": "cotiz. · cambios · idempotencia",
    "optional FAQ": "FAQ opcional",
    "else curated snippets": "o fragmentos curados",
    "Legend": "Leyenda",
    "focal": "foco",
    "boundary / guardrail": "límite / barrera",
    "data store": "almacén de datos",
    "external call": "llamada externa",
    "Design principle: the LLM is the last resort.": "Principio de diseño: el LLM es el último recurso.",
    "LLM decides nothing about the business": "El LLM no decide nada del negocio",
    "understands the request · asks only for missing data": "entiende el pedido · pide solo los datos faltantes",
    "phrases backend results · collects the passenger's explicit yes": "redacta los resultados del backend · recoge el sí explícito del pasajero",
    "Code decides": "El código decide",
    "identification · eligible alternatives · fees · quote expiry": "identificación · alternativas elegibles · tarifas · vencimiento de cotización",
    "idempotency · FSM state · consent guard · simulated failures": "idempotencia · estado FSM · guarda de consentimiento · fallas simuladas",
    "Escala architecture": "Arquitectura de Escala",
    "Passenger talks to a CX Agent Studio app with two agents, callbacks and an OpenAPI toolset that calls a hexagonal Firebase Cloud Function backed by Firestore.": "El pasajero habla con una app de CX Agent Studio con dos agentes, callbacks y un toolset OpenAPI que llama a una Cloud Function de Firebase hexagonal respaldada por Firestore.",
    # ---- Confirmation sequence -------------------------------------------------------------
    "chat · voice": "chat · voz",
    "State + guard": "Estado + guarda",
    "Python tool · callbacks": "Tool Python · callbacks",
    "Backend api": "Backend api",
    "transactions": "transacciones",
    "Sequence · two-phase confirmation": "Secuencia · confirmación en dos fases",
    "No change without a confirmed quote": "Ningún cambio sin una cotización confirmada",
    "Phase 1 quotes and reads back, phase 2 records consent, phase 3 executes behind a guard and a transaction.": "La fase 1 cotiza y lee, la fase 2 registra el consentimiento, la fase 3 ejecuta detrás de una guarda y una transacción.",
    "Phase 1 · quote": "Fase 1 · cotización",
    "Phase 2 · consent": "Fase 2 · consentimiento",
    "Phase 3 · execute": "Fase 3 · ejecución",
    "persist quotes": "persiste cotizaciones",
    "options + quote_id + total_ars": "opciones + quote_id + total_ars",
    "read-back: flight, changes, total": "lectura: vuelo, cambios, total",
    "ends with «¿Lo confirmo?»": "termina con «¿Lo confirmo?»",
    "explicit «sí» (+ amount if cost)": "«sí» explícito (+ monto si hay costo)",
    "checks offered_quotes / offered_totals": "verifica offered_quotes / offered_totals",
    "sets confirmed_*  ·  FSM → CONFIRM": "fija confirmed_*  ·  FSM → CONFIRM",
    "quote offered? confirmed? total equal?": "¿ofrecida? ¿confirmada? ¿mismo total?",
    "else CONFIRMATION_REQUIRED, nothing runs": "si no: CONFIRMATION_REQUIRED, nada corre",
    "forward createRebooking": "reenvía createRebooking",
    "run transaction": "ejecuta la transacción",
    "verify quote: expiry · version · seats": "valida: vencimiento · versión · asientos",
    "idempotency ledger · write rebooking": "registro de idempotencia · escribe el recambio",
    "replay → same result, already_applied": "reintento → mismo resultado, already_applied",
    "committed": "confirmado (commit)",
    "new PNR + receipt (simulated payment)": "nuevo PNR + comprobante (pago simulado)",
    "clear confirmed_* state": "limpia el estado confirmed_*",
    "result + per-passenger follow-ups": "resultado + pendientes por pasajero",
    "only what the response states": "solo lo que indica la respuesta",
    "Two-phase confirmation sequence": "Secuencia de confirmación en dos fases",
    "Sequence of messages between passenger, agent, state and guard, backend and Firestore for a confirmed rebooking.": "Secuencia de mensajes entre pasajero, agente, estado y guarda, backend y Firestore para un recambio confirmado.",
    # ---- Demo GIF --------------------------------------------------------------------------
    "Replay of a resolved session": "Reproducción de una sesión resuelta",
    "turn": "turno",
    "Tool call that moved the state": "Llamada a herramienta que movió el estado",
    "Waiting for the next tool call": "Esperando la próxima llamada a herramienta",
    "The state only changes when a tool result arrives.": "El estado solo cambia cuando llega el resultado de una herramienta.",
    "Turn": "Turno",
    "tokens in / out": "tokens entrada / salida",
    "perceived latency": "latencia percibida",
    "Session result": "Resultado de la sesión",
    "Resolved: new flight booked at no cost, only after the passenger confirmed.": "Resuelto: nuevo vuelo reservado sin costo, solo después de que el pasajero confirmó.",
    "turns": "turnos",
    "tool calls": "llamadas a herramientas",
    "LLM calls": "llamadas al LLM",
    "perceived": "percibidos",
    "Input tokens (total)": "Tokens de entrada (total)",
    "Output tokens (total)": "Tokens de salida (total)",
    "Per LLM call (input)": "Por llamada al LLM (entrada)",
    "status ok · stays in IDENTIFY": "status ok · se mantiene en IDENTIFY",
    "status ok · cancellation, connection broken": "status ok · cancelación, conexión rota",
    "status ok · quotes Q-F8675A92, Q-CE92DEA3": "status ok · cotizaciones Q-F8675A92, Q-CE92DEA3",
    "status success · guard now armed": "status success · guarda ahora armada",
    "gate and check-in questions": "consultas de puerta y check-in",
    "status ok · state stays DONE": "status ok · el estado sigue en DONE",
    "no transition: read-only tools": "sin transición: herramientas de solo lectura",
    "session closed, no escalation": "sesión cerrada, sin escalamiento",
    "pnr: RMR4TX · deadline: tomorrow": "pnr: RMR4TX · límite: mañana",
    "outcome: resolved": "outcome: resolved",
    "simulated_paid ARS 0": "simulated_paid ARS 0",
}
