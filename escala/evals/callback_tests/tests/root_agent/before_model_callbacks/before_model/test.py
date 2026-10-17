import pytest

from cxas_scrapi.utils.callback_libs import CallbackContext, LlmRequest

from python_code import STEP_TEXTS, before_model_callback, select_block

ALL_STATES = ["IDENTIFY", "TRIAGE", "FAQ", "OPTIONS", "CONFIRM", "DONE", "HANDOFF", "FAILURE"]


def run(state):
    ctx = CallbackContext(state=dict(state))
    result = before_model_callback(ctx, LlmRequest())
    assert result is None
    return ctx.state


def test_every_fsm_state_has_a_step_text():
    assert sorted(STEP_TEXTS) == sorted(ALL_STATES)
    assert all(STEP_TEXTS[s].strip() for s in ALL_STATES)


@pytest.mark.parametrize("fsm_state", ALL_STATES)
def test_injects_block_of_current_state(fsm_state):
    assert run({"fsm_state": fsm_state})["fsm_instructions"] == STEP_TEXTS[fsm_state]


@pytest.mark.parametrize("raw", [None, "", "BOGUS", "identify", 3])
def test_missing_or_unknown_state_defaults_to_identify(raw):
    state = {} if raw is None else {"fsm_state": raw}
    assert run(state)["fsm_instructions"] == STEP_TEXTS["IDENTIFY"]
    assert select_block(raw) == STEP_TEXTS["IDENTIFY"]


def test_does_not_touch_the_fsm_state_or_other_variables():
    state = run({"active_pnr": "RMR4TX"})
    assert "fsm_state" not in state
    assert state["active_pnr"] == "RMR4TX"


def test_is_idempotent_and_follows_state_changes():
    first = run({"fsm_state": "OPTIONS"})
    assert run(first) == first
    moved = dict(first, fsm_state="DONE")
    assert run(moved)["fsm_instructions"] == STEP_TEXTS["DONE"]


def test_blocks_have_no_unresolved_placeholders():
    # Injected text is not re-templated: placeholders would reach the model literally.
    assert all("{" not in text and "}" not in text for text in STEP_TEXTS.values())
