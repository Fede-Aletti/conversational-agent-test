import json

from cxas_scrapi.utils.callback_libs import CallbackContext, Tool

from python_code import after_tool_callback, next_fsm


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


def test_unrelated_tool_leaves_bookkeeping_untouched():
    state = run("end_session", {"status": "ok"}, {"active_pnr": "A"})
    assert state["active_pnr"] == "A"
    assert "offered_quotes" not in state and "session_outcome" not in state
    assert state["fsm_state"] == "IDENTIFY"


def test_wrapped_output_is_supported():
    state = run("lookupBooking", {"output": {"status": "ok", "pnr": "DP4N8S"}})
    assert state["active_pnr"] == "DP4N8S"


# ---------------------------------------------------------------- FSM: pure transition table

import pytest

EXEC = {"status": "ok", "options": [{"executable": True, "quote_id": "Q-A", "payment": {"total_ars": 0}}]}
AFTER_DEADLINE_ONLY = {
    "status": "ok",
    "options": [],
    "options_after_deadline": [{"executable": True, "quote_id": "Q-D", "payment": {"total_ars": 0}}],
}
NOT_EXECUTABLE = {"status": "ok", "options": [{"executable": False, "not_executable_reason": "INSUFFICIENT_SEATS"}]}
BLOCKED = {"status": "ok", "options": [], "blocking_reasons": ["POLICY_FARE_NOT_CHANGEABLE"]}
RETRYABLE = {"status": "error", "error_code": "UPSTREAM_TIMEOUT", "retryable": True}


@pytest.mark.parametrize(
    "start, op, payload, expected",
    [
        ("IDENTIFY", "lookupBooking", {"status": "ok", "pnr": "A"}, "TRIAGE"),
        ("OPTIONS", "lookupBooking", {"status": "ok", "pnr": "B"}, "TRIAGE"),
        ("TRIAGE", "getRebookingOptions", EXEC, "OPTIONS"),
        ("TRIAGE", "getRebookingOptions", AFTER_DEADLINE_ONLY, "OPTIONS"),
        ("TRIAGE", "getRebookingOptions", NOT_EXECUTABLE, "FAILURE"),
        ("TRIAGE", "getRebookingOptions", BLOCKED, "FAILURE"),
        ("TRIAGE", "getRebookingOptions", {"status": "ok"}, "FAILURE"),
        ("OPTIONS", "record_quote_confirmation", {"status": "success", "confirmed_quote_id": "Q-A"}, "CONFIRM"),
        ("CONFIRM", "createRebooking", {"status": "ok", "already_applied": False}, "DONE"),
        ("CONFIRM", "createRebooking", {"status": "ok", "already_applied": True}, "DONE"),
        ("TRIAGE", "createHandoffCase", {"status": "ok", "case_id": "HC-1"}, "HANDOFF"),
        ("OPTIONS", "createHandoffCase", {"status": "ok", "case_id": "HC-1"}, "HANDOFF"),
        ("TRIAGE", "searchFaq", {"status": "ok", "answers": []}, "FAQ"),
        ("FAQ", "searchFaq", {"status": "ok", "answers": []}, "FAQ"),
        ("IDENTIFY", "searchFaq", {"status": "ok", "answers": []}, "IDENTIFY"),
        ("OPTIONS", "searchFaq", {"status": "ok", "answers": []}, "OPTIONS"),
        ("CONFIRM", "searchFaq", {"status": "ok", "answers": []}, "CONFIRM"),
        ("TRIAGE", "getFlightStatus", {"status": "ok"}, "TRIAGE"),
        # R4 corrections and new requests reset to OPTIONS
        ("CONFIRM", "getRebookingOptions", EXEC, "OPTIONS"),
        ("DONE", "getRebookingOptions", EXEC, "OPTIONS"),
        ("FAILURE", "getRebookingOptions", EXEC, "OPTIONS"),
        # non-retryable errors
        ("TRIAGE", "getRebookingOptions", {"status": "error", "error_code": "DESTINATION_CHANGE_NOT_SUPPORTED", "retryable": False}, "FAILURE"),
        ("TRIAGE", "getRebookingOptions", {"status": "error", "error_code": "VOLUNTARY_CHANGES_DISABLED"}, "FAILURE"),
        ("IDENTIFY", "lookupBooking", {"status": "error", "error_code": "BOOKING_NOT_FOUND", "retryable": False}, "IDENTIFY"),
        ("CONFIRM", "createRebooking", {"status": "error", "error_code": "QUOTE_STALE"}, "CONFIRM"),
        ("OPTIONS", "record_quote_confirmation", {"status": "error", "error_code": "TOTAL_MISMATCH"}, "OPTIONS"),
        # unknown inputs
        ("OPTIONS", "end_session", {"status": "ok"}, "OPTIONS"),
        ("OPTIONS", "", {"status": "ok"}, "OPTIONS"),
        ("OPTIONS", "lookupBooking", {"unexpected": True}, "OPTIONS"),
        ("OPTIONS", "lookupBooking", None, "OPTIONS"),
        ("BOGUS", "lookupBooking", {"status": "weird"}, "IDENTIFY"),
        ("", "end_session", {}, "IDENTIFY"),
        (None, "searchFaq", {"status": "ok"}, "IDENTIFY"),
    ],
)
def test_next_fsm_table(start, op, payload, expected):
    new_state, _ = next_fsm(start, 0, op, payload)
    assert new_state == expected


def test_next_fsm_retryable_twice_goes_to_failure():
    state, failures = next_fsm("TRIAGE", 0, "getRebookingOptions", RETRYABLE)
    assert (state, failures) == ("TRIAGE", 1)
    state, failures = next_fsm(state, failures, "getRebookingOptions", RETRYABLE)
    assert (state, failures) == ("FAILURE", 2)


def test_next_fsm_success_or_non_retryable_resets_failures():
    assert next_fsm("TRIAGE", 1, "getRebookingOptions", EXEC) == ("OPTIONS", 0)
    assert next_fsm("TRIAGE", 1, "lookupBooking", {"status": "error", "retryable": False}) == ("TRIAGE", 0)


def test_next_fsm_failure_recovers_via_new_options():
    state, failures = next_fsm("FAILURE", 2, "getRebookingOptions", EXEC)
    assert (state, failures) == ("OPTIONS", 0)


# ---------------------------------------------------------------- FSM: callback wiring

def test_callback_walks_the_happy_path():
    ctx = CallbackContext(state={})
    steps = [
        ("lookupBooking", {"status": "ok", "pnr": "rmr4tx"}, "TRIAGE"),
        ("getRebookingOptions", EXEC, "OPTIONS"),
        ("record_quote_confirmation", {"status": "success"}, "CONFIRM"),
        ("createRebooking", {"status": "ok"}, "DONE"),
    ]
    for op, response, expected in steps:
        name = op if op == "record_quote_confirmation" else f"escala_api_{op}"
        assert after_tool_callback(Tool(name=name, description=""), {}, ctx, response) is None
        assert ctx.state["fsm_state"] == expected
    assert ctx.state["fsm_failures"] == "0"


def test_callback_counts_retryable_errors_in_state():
    ctx = CallbackContext(state={"fsm_state": "TRIAGE"})
    for expected_state, expected_count in (("TRIAGE", "1"), ("FAILURE", "2")):
        after_tool_callback(tool("getRebookingOptions"), {}, ctx, RETRYABLE)
        assert (ctx.state["fsm_state"], ctx.state["fsm_failures"]) == (expected_state, expected_count)


def test_callback_tolerates_garbage_counter_and_state():
    ctx = CallbackContext(state={"fsm_state": "NOPE", "fsm_failures": "abc"})
    after_tool_callback(tool("lookupBooking"), {}, ctx, {"status": "ok", "pnr": "A"})
    assert (ctx.state["fsm_state"], ctx.state["fsm_failures"]) == ("TRIAGE", "0")


def test_callback_wrapped_output_drives_fsm():
    ctx = CallbackContext(state={})
    after_tool_callback(tool("getRebookingOptions"), {}, ctx, {"output": EXEC})
    assert ctx.state["fsm_state"] == "OPTIONS"
