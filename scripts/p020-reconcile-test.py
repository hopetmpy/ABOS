from pathlib import Path

path = Path("src/__tests__/memory/context-manager.test.ts")
text = path.read_text()
old = '''    const assembled = manager.assembleContext({
      systemPrompt: "sys",
      todoMd: "todo",
      recentTurns: [makeTurn(1), makeTurn(2), makeTurn(3)],
      modelContextWindow: 80,
      reserveTokens: 40,
    });'''
new = '''    const assembled = manager.assembleContext({
      systemPrompt: "sys",
      todoMd: "todo",
      recentTurns: [makeTurn(1), makeTurn(2), makeTurn(3)],
      tailMessages: [{ role: "user", content: "mandatory-input" }],
      modelContextWindow: 80,
      reserveTokens: 40,
    });'''
count = text.count(old)
if count != 1:
    raise SystemExit(f"expected one emergency fixture, found {count}")
path.write_text(text.replace(old, new, 1))
