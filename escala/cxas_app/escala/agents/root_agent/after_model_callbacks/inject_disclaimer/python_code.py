"""after_model_callback - inject_disclaimer.

Prepends the fixed experimental disclaimer once per session, on the first
model response that has text. The state flag prevents double injection when a
turn spans several model calls or the passenger is transferred between agents.
"""

from typing import Optional

DISCLAIMER_TEXT = (
    "Aviso: soy un asistente experimental de Escala, un prototipo que no está "
    "afiliado a Aerolíneas Argentinas. Los datos y los cambios son simulados."
)


def after_model_callback(callback_context: CallbackContext, llm_response: LlmResponse) -> Optional[LlmResponse]:
    state = callback_context.state
    if str(state.get("_disclaimer_shown", "false")).lower() == "true":
        return None

    if llm_response is None or llm_response.content is None:
        return None

    has_text = False
    for part in llm_response.content.parts:
        text = part.text_or_transcript()
        if text and len(text.strip()) > 0:
            has_text = True
            break
    if not has_text:
        return None

    state["_disclaimer_shown"] = "true"
    new_parts = [Part.from_text(text=DISCLAIMER_TEXT)]
    new_parts.extend(llm_response.content.parts)
    return LlmResponse.from_parts(parts=new_parts)
