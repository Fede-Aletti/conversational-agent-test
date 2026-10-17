import json

from cxas_scrapi.utils.callback_libs import CallbackContext, Tool

from python_code import after_tool_callback


def tool(op):
    return Tool(name=f"escala_api_{op}", description="")


def run(op, response, state=None):
    ctx = CallbackContext(state=dict(state or {}))
    result = after_tool_callback(tool(op), {}, ctx, response)
    assert result is None
    return ctx.state


OPTIONS = {
    "status": "ok",
    "options": [
        {"option_id": "A", "executable": True, "quote_id": "Q-A", "expires_at": "t1", "payment": {"total_ars": 0}},
        {"option_id": "B", "executable": True, "quote_id": "Q-B", "expires_at": "t2", "payment": {"total_ars": 45000}},
        {"option_id": "C", "executable": False, "not_executable_reason": "INSUFFICIENT_SEATS"},
    ],
    "options_after_deadline": [
        {"option_id": "D", "executable": True, "quote_id": "Q-D", "expires_at": "t3", "payment": {"total_ars": 0}},
    ],
}


def test_lookup_ok_sets_active_pnr():
    state = run("lookupBooking", {"status": "ok", "pnr": "rmr4tx"})
    assert state["active_pnr"] == "RMR4TX"


def test_lookup_error_keeps_state():
    state = run(
        "lookupBooking",
        {"status": "error", "error_code": "BOOKING_NOT_FOUND"},
        {"active_pnr": "OLD123"},
    )
    assert state["active_pnr"] == "OLD123"


def test_options_store_quotes_and_totals_and_reset_confirmation():
    state = run(
        "getRebookingOptions",
        OPTIONS,
        {"confirmed_quote_id": "Q-OLD", "confirmed_total_ars": "10"},
    )
    assert json.loads(state["offered_quotes"]) == {"Q-A": "t1", "Q-B": "t2", "Q-D": "t3"}
    assert json.loads(state["offered_totals"]) == {"Q-A": 0, "Q-B": 45000, "Q-D": 0}
    assert state["confirmed_quote_id"] == ""
    assert state["confirmed_total_ars"] == ""


def test_new_options_replace_previous_quotes():
    state = run(
        "getRebookingOptions",
        {"status": "ok", "options": [], "blocking_reasons": ["POLICY_FARE_NOT_CHANGEABLE"]},
        {"offered_quotes": json.dumps({"Q-OLD": "t"}), "offered_totals": json.dumps({"Q-OLD": 0})},
    )
    assert json.loads(state["offered_quotes"]) == {}
    assert json.loads(state["offered_totals"]) == {}


def test_options_error_keeps_previous_quotes():
    prev = json.dumps({"Q-OLD": "t"})
    state = run(
        "getRebookingOptions",
        {"status": "error", "error_code": "UPSTREAM_TIMEOUT", "retryable": True},
        {"offered_quotes": prev},
    )
    assert state["offered_quotes"] == prev


def test_active_pnr_survives_options_call():
    state = run("getRebookingOptions", OPTIONS, {"active_pnr": "RMR4TX"})
    assert state["active_pnr"] == "RMR4TX"


def test_create_rebooking_ok_clears_confirmation():
    state = run(
        "createRebooking",
        {"status": "ok", "confirmation_code": "ABC"},
        {"confirmed_quote_id": "Q-A", "confirmed_total_ars": "0"},
    )
    assert state["confirmed_quote_id"] == ""
    assert state["confirmed_total_ars"] == ""


def test_create_rebooking_error_keeps_confirmation():
    state = run(
        "createRebooking",
        {"status": "error", "error_code": "QUOTE_STALE"},
        {"confirmed_quote_id": "Q-A"},
    )
    assert state["confirmed_quote_id"] == "Q-A"


def test_handoff_ok_sets_outcome():
    state = run("createHandoffCase", {"status": "ok", "case_id": "HC-1A2B3C"})
    assert state["session_outcome"] == "handed_off"


def test_handoff_error_does_not_set_outcome():
    state = run("createHandoffCase", {"status": "error", "error_code": "X"})
    assert "session_outcome" not in state


def test_unrelated_tool_is_noop():
    state = run("searchFaq", {"status": "ok", "answers": []}, {"active_pnr": "A"})
    assert state == {"active_pnr": "A"}


def test_wrapped_output_is_supported():
    state = run("lookupBooking", {"output": {"status": "ok", "pnr": "DP4N8S"}})
    assert state["active_pnr"] == "DP4N8S"
