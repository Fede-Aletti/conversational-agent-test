import json

from cxas_scrapi.utils.callback_libs import CallbackContext, Tool

from python_code import before_tool_callback

TOOL = Tool(name="escala_api_createRebooking", description="")
QUOTE = "Q-A1"


def make_state(**overrides):
    state = {
        "offered_quotes": json.dumps({QUOTE: "2026-11-12T15:00:00Z"}),
        "offered_totals": json.dumps({QUOTE: 45000}),
        "confirmed_quote_id": QUOTE,
        "confirmed_total_ars": "45000",
    }
    state.update(overrides)
    return state


def args(**overrides):
    base = {
        "quote_id": QUOTE,
        "confirmed": True,
        "confirmed_total_ars": 45000,
        "idempotency_key": f"rebook-{QUOTE}",
    }
    base.update(overrides)
    return base


def run(state, input_args, tool=TOOL):
    return before_tool_callback(tool, input_args, CallbackContext(state=state))


def assert_blocked(result):
    assert result["status"] == "error"
    assert result["error_code"] == "CONFIRMATION_REQUIRED"
    assert result["agent_action"]


def test_passes_when_confirmed_current_quote_and_total():
    assert run(make_state(), args()) is None


def test_passes_involuntary_zero_total():
    state = make_state(
        offered_totals=json.dumps({QUOTE: 0}), confirmed_total_ars="0"
    )
    assert run(state, args(confirmed_total_ars=0)) is None


def test_ignores_other_tools():
    other = Tool(name="escala_api_lookupBooking", description="")
    assert run({}, {"last_name": "Romero"}, other) is None


def test_blocks_without_confirmation_recorded():
    assert_blocked(run(make_state(confirmed_quote_id=""), args()))


def test_blocks_when_confirmed_quote_differs():
    assert_blocked(run(make_state(confirmed_quote_id="Q-OTHER"), args()))


def test_blocks_quote_not_offered():
    state = make_state(offered_quotes=json.dumps({"Q-X": "t"}))
    assert_blocked(run(state, args()))


def test_blocks_when_nothing_offered():
    assert_blocked(run({}, args()))


def test_blocks_when_confirmed_is_not_true():
    assert_blocked(run(make_state(), args(confirmed=False)))
    assert_blocked(run(make_state(), args(confirmed="true")))


def test_blocks_when_amount_differs_from_offered_total():
    assert_blocked(run(make_state(), args(confirmed_total_ars=1000)))


def test_blocks_when_confirmed_total_differs_from_sent():
    assert_blocked(run(make_state(confirmed_total_ars="10"), args()))


def test_blocks_when_total_missing():
    inp = args()
    del inp["confirmed_total_ars"]
    assert_blocked(run(make_state(), inp))


def test_accepts_dict_state_values():
    state = make_state(
        offered_quotes={QUOTE: "t"}, offered_totals={QUOTE: 45000}
    )
    assert run(state, args()) is None
