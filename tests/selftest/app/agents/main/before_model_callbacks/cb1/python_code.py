def before_model_callback(callback_context: CallbackContext, llm_request: LlmRequest):
    if callback_context.state.get("_action_trigger") == "escalate":
        callback_context.state["_action_trigger"] = ""
        tools.payload_update_tool({"reason": "test"})
        return LlmResponse.from_parts([Part(text="Transferring you now.")])
    return None
