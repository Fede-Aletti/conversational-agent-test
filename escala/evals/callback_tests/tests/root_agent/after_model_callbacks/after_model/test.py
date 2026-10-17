from cxas_scrapi.utils.callback_libs import CallbackContext, LlmResponse, Part

from python_code import DISCLAIMER_TEXT, after_model_callback


def texts(response):
    return [p.text for p in response.content.parts]


def test_prepends_disclaimer_once_and_sets_flag():
    ctx = CallbackContext(state={})
    resp = LlmResponse.from_parts(parts=[Part.from_text(text="Hola, ¿en qué te ayudo?")])
    out = after_model_callback(ctx, resp)
    assert texts(out) == [DISCLAIMER_TEXT, "Hola, ¿en qué te ayudo?"]
    assert ctx.state["_disclaimer_shown"] == "true"


def test_no_double_injection_on_next_call():
    ctx = CallbackContext(state={"_disclaimer_shown": "true"})
    resp = LlmResponse.from_parts(parts=[Part.from_text(text="Seguimos.")])
    assert after_model_callback(ctx, resp) is None


def test_no_double_injection_in_same_session_sequence():
    ctx = CallbackContext(state={})
    first = after_model_callback(ctx, LlmResponse.from_parts(parts=[Part.from_text(text="Uno")]))
    second = after_model_callback(ctx, LlmResponse.from_parts(parts=[Part.from_text(text="Dos")]))
    assert first is not None
    assert second is None


def test_skips_responses_without_text():
    ctx = CallbackContext(state={})
    resp = LlmResponse.from_parts(
        parts=[Part.from_function_call(name="end_session", args={})]
    )
    assert after_model_callback(ctx, resp) is None
    assert "_disclaimer_shown" not in ctx.state


def test_skips_blank_text_and_keeps_flag_unset():
    ctx = CallbackContext(state={})
    resp = LlmResponse.from_parts(parts=[Part.from_text(text="   ")])
    assert after_model_callback(ctx, resp) is None
    assert "_disclaimer_shown" not in ctx.state


def test_keeps_function_call_after_disclaimer():
    ctx = CallbackContext(state={})
    resp = LlmResponse.from_parts(
        parts=[
            Part.from_text(text="Un momento."),
            Part.from_function_call(name="escala_api_lookupBooking", args={}),
        ]
    )
    out = after_model_callback(ctx, resp)
    assert len(out.content.parts) == 3
    assert out.content.parts[0].text == DISCLAIMER_TEXT
    assert out.content.parts[2].has_function_call("escala_api_lookupBooking")
