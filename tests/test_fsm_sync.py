"""Cross-file invariants of the FSM that no single callback test can see.

Callbacks cannot share code, so the transition table is duplicated byte for
byte in both agents (together with the step texts of both agents) and the default of `fsm_instructions` repeats the root
IDENTIFY step. These tests keep the copies from drifting.
"""

import json

from conftest import ESCALA_APP_DIR

from cxas_local.callbacks import PRELUDE

AGENTS = ("root_agent", "disruption_rebooking_agent")


def _code(agent: str, kind: str, name: str) -> str:
    return (ESCALA_APP_DIR / "agents" / agent / kind / name / "python_code.py").read_text(encoding="utf-8")


def _load(agent: str, kind: str, name: str) -> dict:
    namespace: dict = {}
    exec(PRELUDE + _code(agent, kind, name), namespace)
    return namespace


def test_track_state_is_identical_in_both_agents():
    root, rebooking = (_code(a, "after_tool_callbacks", "track_state") for a in AGENTS)
    assert root == rebooking


def test_both_agents_cover_every_fsm_state():
    states = _load(AGENTS[0], "after_tool_callbacks", "track_state")["FSM_STATES"]
    for agent in AGENTS:
        table = _load(agent, "after_tool_callbacks", "track_state")["STEP_TEXTS"]
        assert sorted(table) == sorted(AGENTS)
        for owner, texts in table.items():
            assert sorted(texts) == sorted(states), (agent, owner)


def test_app_default_of_fsm_instructions_is_root_identify_step():
    app = json.loads((ESCALA_APP_DIR / "app.json").read_text(encoding="utf-8"))
    declared = {v["name"]: v for v in app["variableDeclarations"]}
    for name in ("fsm_state", "fsm_failures", "fsm_instructions"):
        assert declared[name]["schema"]["required"] == []
        assert declared[name]["description"]
    root = _load("root_agent", "after_tool_callbacks", "track_state")["STEP_TEXTS"]["root_agent"]
    assert declared["fsm_instructions"]["schema"]["default"] == root["IDENTIFY"]


def test_instructions_reference_the_placeholder_once():
    for agent in AGENTS:
        text = (ESCALA_APP_DIR / "agents" / agent / "instruction.txt").read_text(encoding="utf-8")
        assert text.count("{fsm_instructions}") == 1, agent


def test_agents_register_only_track_state_for_the_step_text():
    # The step text is published by the after_tool callback; no before_model callback may overwrite it.
    for agent in AGENTS:
        config = json.loads((ESCALA_APP_DIR / "agents" / agent / f"{agent}.json").read_text(encoding="utf-8"))
        assert "beforeModelCallbacks" not in config
        paths = [c["pythonCode"] for c in config["afterToolCallbacks"]]
        assert paths == [f"agents/{agent}/after_tool_callbacks/track_state/python_code.py"]


def test_step_texts_have_no_unresolved_placeholders():
    # Injected text is not re-templated: placeholders would reach the model literally.
    table = _load(AGENTS[0], "after_tool_callbacks", "track_state")["STEP_TEXTS"]
    for texts in table.values():
        assert all("{" not in t and "}" not in t for t in texts.values())


def test_no_filler_before_tool_calls():
    # A filler emitted with the tool call made the model return an empty reply after the
    # result (simulator-70834326, simulator-6fdcb2ef). The rule must forbid announcing.
    text = (ESCALA_APP_DIR / "agents" / "disruption_rebooking_agent" / "instruction.txt").read_text(encoding="utf-8")
    assert "Estoy consultando" not in text
    assert "No anuncies que vas a consultar" in text
