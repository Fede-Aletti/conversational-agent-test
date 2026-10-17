"""Cross-file invariants of the FSM that no single callback test can see.

Callbacks cannot share code, so the transition table is duplicated byte for
byte in both agents and the default of `fsm_instructions` repeats the root
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
        texts = _load(agent, "before_model_callbacks", "inject_fsm_instructions")["STEP_TEXTS"]
        assert sorted(texts) == sorted(states), agent


def test_app_default_of_fsm_instructions_is_root_identify_step():
    app = json.loads((ESCALA_APP_DIR / "app.json").read_text(encoding="utf-8"))
    declared = {v["name"]: v for v in app["variableDeclarations"]}
    for name in ("fsm_state", "fsm_failures", "fsm_instructions"):
        assert declared[name]["schema"]["required"] == []
        assert declared[name]["description"]
    root = _load("root_agent", "before_model_callbacks", "inject_fsm_instructions")["STEP_TEXTS"]
    assert declared["fsm_instructions"]["schema"]["default"] == root["IDENTIFY"]


def test_instructions_reference_the_placeholder_once():
    for agent in AGENTS:
        text = (ESCALA_APP_DIR / "agents" / agent / "instruction.txt").read_text(encoding="utf-8")
        assert text.count("{fsm_instructions}") == 1, agent


def test_agents_register_the_before_model_callback():
    for agent in AGENTS:
        config = json.loads((ESCALA_APP_DIR / "agents" / agent / f"{agent}.json").read_text(encoding="utf-8"))
        paths = [c["pythonCode"] for c in config["beforeModelCallbacks"]]
        assert paths == [f"agents/{agent}/before_model_callbacks/inject_fsm_instructions/python_code.py"]
