def echo_tool(name: str, count: int = 1) -> dict:
    """Greet a caller and record the greeting in session state."""
    if not context.state.get("auth_status") == "authenticated":
        return {"status": "error", "agent_action": "Ask the user to verify."}
    context.state["last_name"] = name
    return {"status": "success", "greeting": f"hello {name}", "items": ["x"] * count}
