from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one anchor, found {count}: {old[:140]!r}")
    p.write_text(text.replace(old, new, 1), encoding="utf-8")


replace_once(
    "src/platform/local-computer-runtime.ts",
    '''  async wait(id: string, timeoutMs = DEFAULT_WAIT_TIMEOUT_MS): Promise<ManagedProcessSnapshot> {
    const entry = this.requireProcess(id);
    if (entry.state !== "running") return this.snapshot(entry, false);
    if (timeoutMs <= 0) return this.snapshot(entry, true);
    let timedOut = false;
    await Promise.race([
      entry.completion,
      new Promise<void>((resolve) => setTimeout(() => { timedOut = true; resolve(); }, timeoutMs)),
    ]);
    return this.snapshot(entry, timedOut && entry.state === "running");
  }
''',
    '''  async wait(id: string, timeoutMs = DEFAULT_WAIT_TIMEOUT_MS): Promise<ManagedProcessSnapshot> {
    const entry = this.requireProcess(id);
    if (entry.state !== "running") return this.snapshot(entry, false);
    if (timeoutMs <= 0) return this.snapshot(entry, true);
    const timedOut = await this.waitForCompletion(entry, timeoutMs);
    return this.snapshot(entry, timedOut);
  }
''',
)

replace_once(
    "src/platform/local-computer-runtime.ts",
    '''  private async observeTermination(entry: ManagedProcessEntry): Promise<void> {
    if (entry.state !== "running") return;
    await Promise.race([
      entry.completion,
      new Promise<void>((resolve) => setTimeout(resolve, TERMINATION_OBSERVE_MS)),
    ]);
  }

  private snapshot(entry: ManagedProcessEntry, waitTimedOut: boolean): ManagedProcessSnapshot {
''',
    '''  private async observeTermination(entry: ManagedProcessEntry): Promise<void> {
    if (entry.state !== "running") return;
    await this.waitForCompletion(entry, TERMINATION_OBSERVE_MS);
  }

  private async waitForCompletion(
    entry: ManagedProcessEntry,
    timeoutMs: number,
  ): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      const winner = await Promise.race([
        entry.completion.then(() => "completed" as const),
        new Promise<"timeout">((resolve) => {
          timer = setTimeout(() => resolve("timeout"), timeoutMs);
        }),
      ]);
      return winner === "timeout" && entry.state === "running";
    } finally {
      if (timer !== null) clearTimeout(timer);
    }
  }

  private snapshot(entry: ManagedProcessEntry, waitTimedOut: boolean): ManagedProcessSnapshot {
''',
)

replace_once(
    "src/environments/local.ts",
    '''    const evidence = [
      `platform=${process.platform}`,
      `arch=${process.arch}`,
      `node=${process.version}`,
      `cpus=${os.cpus().length}`,
      `freeMemoryBytes=${os.freemem()}`,
      ...browser.evidence.map((entry) => `browser:${entry}`),
      ...computer.evidence.map((entry) => `process:${entry}`),
    ];

    return {
''',
    '''    const evidence = [
      `platform=${process.platform}`,
      `arch=${process.arch}`,
      `node=${process.version}`,
      `cpus=${os.cpus().length}`,
      `freeMemoryBytes=${os.freemem()}`,
      ...browser.evidence.map((entry) => `browser:${entry}`),
      ...computer.evidence.map((entry) => `process:${entry}`),
    ];
    const constraints: string[] = [];
    if (!browser.available) {
      constraints.push(
        "Structured browser is currently unavailable on this host; other local capabilities are assessed independently.",
      );
    }
    if (!computer.available) {
      constraints.push(
        "Local process execution/lifecycle is currently unavailable on this host because no usable shell was observed.",
      );
    }

    return {
''',
)

replace_once(
    "src/environments/local.ts",
    '''      constraints: browser.available
        ? []
        : ["Structured browser is currently unavailable on this host; filesystem/process capabilities remain available."],
''',
    '''      constraints,
''',
)

replace_once(
    "src/__tests__/p016-local-computer-runtime.test.ts",
    '''import { LocalComputerRuntime } from "../platform/local-computer-runtime.js";
import { getHomeDir } from "../platform/home.js";
import { redactToolArgumentsForPersistence } from "../agent/sensitive-tool-arguments.js";
''',
    '''import { LocalComputerRuntime } from "../platform/local-computer-runtime.js";
import { getHomeDir } from "../platform/home.js";
import { LocalEnvironmentProvider } from "../environments/local.js";
import { redactToolArgumentsForPersistence } from "../agent/sensitive-tool-arguments.js";
''',
)

replace_once(
    "src/__tests__/p016-local-computer-runtime.test.ts",
    '''  it("reports timeout without fabricating termination", async () => {
''',
    '''  it("clears the losing wait timer when process completion wins", async () => {
    const runtime = new LocalComputerRuntime(() => "timer-cleanup");
    const originalSetTimeout = globalThis.setTimeout;
    const originalClearTimeout = globalThis.clearTimeout;
    const tracked = new Set<ReturnType<typeof setTimeout>>();
    globalThis.setTimeout = ((handler: (...args: any[]) => void, timeout?: number, ...args: any[]) => {
      const timer = originalSetTimeout(handler, timeout, ...args);
      if (timeout === 5_000) tracked.add(timer);
      return timer;
    }) as typeof setTimeout;
    globalThis.clearTimeout = ((timer: ReturnType<typeof setTimeout>) => {
      tracked.delete(timer);
      return originalClearTimeout(timer);
    }) as typeof clearTimeout;

    try {
      const started = await runtime.start(`node -e "process.stdout.write('done')"`);
      const finished = await runtime.wait(started.id, 5_000);
      expect(finished.state).toBe("exited");
      expect(finished.waitTimedOut).toBe(false);
      expect(tracked.size).toBe(0);
    } finally {
      globalThis.setTimeout = originalSetTimeout;
      globalThis.clearTimeout = originalClearTimeout;
      for (const timer of tracked) originalClearTimeout(timer);
    }
  });

  it("reports timeout without fabricating termination", async () => {
''',
)

replace_once(
    "src/__tests__/p016-local-computer-runtime.test.ts",
    '''  it("redacts env values from durable/model-facing arguments while preserving keys", () => {
''',
    '''  it("does not claim process availability when the process probe is unavailable", async () => {
    const provider = new LocalEnvironmentProvider(
      {
        probe: async () => ({
          available: false,
          observedAt: "2026-09-21T00:00:00.000Z",
          target: null,
          browserVersion: null,
          evidence: ["browser unavailable"],
        }),
      } as any,
      {
        probe: () => ({
          available: false,
          observedAt: "2026-09-21T00:00:00.000Z",
          shell: null,
          evidence: ["no shell"],
        }),
      } as any,
    );

    const snapshot = await provider.inspect();
    const processCapability = snapshot.capabilities.find((entry) => entry.id === "local:process");
    expect(processCapability?.available).toBe(false);
    expect(processCapability?.state).toBe("unavailable");
    expect(snapshot.constraints).toContain(
      "Local process execution/lifecycle is currently unavailable on this host because no usable shell was observed.",
    );
    expect(snapshot.constraints.join(" ")).not.toContain("process capabilities remain available");
  });

  it("redacts env values from durable/model-facing arguments while preserving keys", () => {
''',
)
