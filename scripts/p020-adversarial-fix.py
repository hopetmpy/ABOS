from pathlib import Path


def replace_one(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one match, found {count}: {old[:120]!r}")
    p.write_text(text.replace(old, new, 1))


path = "src/memory/context-manager.ts"
replace_one(
    path,
    '''      if (typeof turn?.thinking === "string" && turn.thinking.length > 0) {
        const assistantMessage: ChatMessage = {
          role: "assistant",
          content: turn.thinking,
        };

        if (Array.isArray(turn.toolCalls) && turn.toolCalls.length > 0) {''',
    '''      const hasThinking = typeof turn?.thinking === "string" && turn.thinking.length > 0;
      const hasToolCalls = Array.isArray(turn?.toolCalls) && turn.toolCalls.length > 0;

      if (hasThinking || hasToolCalls) {
        const assistantMessage: ChatMessage = {
          role: "assistant",
          content: hasThinking ? turn.thinking : "",
        };

        if (hasToolCalls) {''',
)

path = "src/__tests__/memory/context-manager.test.ts"
anchor = '''  it("keeps assistant tool calls adjacent to their tool results", () => {'''
addition = '''  it("emits an assistant tool-call envelope for tool-only turns", () => {
    const manager = new ContextManager(fixedTokenCounter(1));
    const turn = {
      id: "tool-only-turn",
      timestamp: new Date().toISOString(),
      state: "running",
      input: "inspect",
      thinking: "",
      toolCalls: [{ id: "call-only", name: "inspect", args: {}, result: "done" }],
      tokenUsage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      costCents: 0,
    };
    const assembled = manager.assembleContext({
      systemPrompt: "sys",
      recentTurns: [turn],
      tailMessages: [{ role: "user", content: "next" }],
      modelContextWindow: 100,
      reserveTokens: 10,
    });

    const assistantIndex = assembled.messages.findIndex((message) =>
      message.role === "assistant" && Array.isArray(message.tool_calls)
    );
    expect(assistantIndex).toBeGreaterThan(0);
    expect(assembled.messages[assistantIndex]?.content).toBe("");
    expect(assembled.messages[assistantIndex]?.tool_calls?.[0]?.id).toBe("call-only");
    expect(assembled.messages[assistantIndex + 1]?.role).toBe("tool");
    expect(assembled.messages[assistantIndex + 1]?.tool_call_id).toBe("call-only");
  });

'''
replace_one(path, anchor, addition + anchor)
