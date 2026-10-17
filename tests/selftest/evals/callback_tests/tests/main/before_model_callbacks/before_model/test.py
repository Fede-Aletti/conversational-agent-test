from unittest.mock import MagicMock

import python_code
from cxas_scrapi.utils.callback_libs import CallbackContext, LlmRequest

python_code.tools = MagicMock()
from python_code import before_model_callback


def test_noop_without_trigger():
    ctx = CallbackContext(state={})
    assert before_model_callback(ctx, LlmRequest()) is None


def test_escalate_clears_trigger_and_calls_tool():
    ctx = CallbackContext(state={"_action_trigger": "escalate"})
    result = before_model_callback(ctx, LlmRequest())
    assert result.content.parts[0].text == "Transferring you now."
    assert ctx.state["_action_trigger"] == ""
    python_code.tools.payload_update_tool.assert_called_once()
