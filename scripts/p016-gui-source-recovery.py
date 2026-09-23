from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    target = Path(path)
    text = target.read_text(encoding="utf-8")
    if old not in text:
        raise SystemExit(f"expected pattern not found in {path}: {old[:120]!r}")
    target.write_text(text.replace(old, new, 1), encoding="utf-8")


runtime = "src/gui/local-runtime.ts"
replace_once(
    runtime,
    'export interface GuiPrimitiveProbe { available: boolean; evidence: string[]; }',
    'export type GuiPrimitiveState = "verified_available" | "probed" | "unavailable";\nexport interface GuiPrimitiveProbe { available: boolean; state: GuiPrimitiveState; evidence: string[]; }',
)
replace_once(
    runtime,
    '    private const uint INPUT_KEYBOARD = 1;\n    private const uint KEYEVENTF_KEYUP = 0x0002;',
    '    private const uint INPUT_MOUSE = 0;\n    private const uint INPUT_KEYBOARD = 1;\n    private const uint KEYEVENTF_KEYUP = 0x0002;',
)
replace_once(
    runtime,
    '    [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extraInfo);\n    [DllImport("user32.dll", SetLastError = true)] private static extern uint SendInput(uint count, INPUT[] inputs, int size);',
    '    [DllImport("user32.dll", SetLastError = true)] private static extern uint SendInput(uint count, INPUT[] inputs, int size);',
)
replace_once(
    runtime,
    '''    public static bool SendVirtualKey(ushort key, bool keyUp) {
        var input = new INPUT { type = INPUT_KEYBOARD, U = new INPUTUNION { ki = new KEYBDINPUT { wVk = key, dwFlags = keyUp ? KEYEVENTF_KEYUP : 0 } } };
        return SendInput(1, new[] { input }, Marshal.SizeOf(typeof(INPUT))) == 1;
    }
}''',
    '''    public static bool SendVirtualKey(ushort key, bool keyUp) {
        var input = new INPUT { type = INPUT_KEYBOARD, U = new INPUTUNION { ki = new KEYBDINPUT { wVk = key, dwFlags = keyUp ? KEYEVENTF_KEYUP : 0 } } };
        return SendInput(1, new[] { input }, Marshal.SizeOf(typeof(INPUT))) == 1;
    }
    public static uint SendMouseClick(uint downFlag, uint upFlag) {
        var inputs = new[] {
            new INPUT { type = INPUT_MOUSE, U = new INPUTUNION { mi = new MOUSEINPUT { dwFlags = downFlag } } },
            new INPUT { type = INPUT_MOUSE, U = new INPUTUNION { mi = new MOUSEINPUT { dwFlags = upFlag } } },
        };
        return SendInput(2, inputs, Marshal.SizeOf(typeof(INPUT)));
    }
}''',
)
replace_once(
    runtime,
    '$accessibility = $false; $screen = $false; $input = $false; $bounds = $null',
    '$accessibility = $false; $screen = $false; $inputProviderReady = $false; $bounds = $null',
)
replace_once(
    runtime,
    'try { Load-Input; $point = New-Object AbosGuiInput+POINT; $desktop = [AbosGuiInput]::GetDesktopWindow(); $cursor = [AbosGuiInput]::GetCursorPos([ref]$point); $input = ($desktop -ne [IntPtr]::Zero) -and $cursor; [void]$inputEvidence.Add("user32 desktop=$($desktop -ne [IntPtr]::Zero); cursorReadable=$cursor; per-target UIPI may still deny an action") } catch { [void]$inputEvidence.Add("input probe failed: $($_.Exception.Message)") }',
    'try { Load-Input; $point = New-Object AbosGuiInput+POINT; $desktop = [AbosGuiInput]::GetDesktopWindow(); $cursor = [AbosGuiInput]::GetCursorPos([ref]$point); $inputProviderReady = ($desktop -ne [IntPtr]::Zero) -and $cursor; [void]$inputEvidence.Add("user32 providerReady=$inputProviderReady; desktop=$($desktop -ne [IntPtr]::Zero); cursorReadable=$cursor; no input emitted by probe; per-target UIPI may still deny an action") } catch { [void]$inputEvidence.Add("input probe failed: $($_.Exception.Message)") }',
)
replace_once(
    runtime,
    'Result @{ userInteractive = [Environment]::UserInteractive; accessibility = @{ available = $accessibility; evidence = @($accessibilityEvidence) }; screen = @{ available = $screen; bounds = $bounds; evidence = @($screenEvidence) }; input = @{ available = $input; evidence = @($inputEvidence) } }',
    'Result @{ userInteractive = [Environment]::UserInteractive; accessibility = @{ available = $accessibility; evidence = @($accessibilityEvidence) }; screen = @{ available = $screen; bounds = $bounds; evidence = @($screenEvidence) }; input = @{ providerReady = $inputProviderReady; evidence = @($inputEvidence) } }',
)
replace_once(
    runtime,
    '''          'left' { [AbosGuiInput]::mouse_event(0x0002,0,0,0,[UIntPtr]::Zero); [AbosGuiInput]::mouse_event(0x0004,0,0,0,[UIntPtr]::Zero) }
          'right' { [AbosGuiInput]::mouse_event(0x0008,0,0,0,[UIntPtr]::Zero); [AbosGuiInput]::mouse_event(0x0010,0,0,0,[UIntPtr]::Zero) }
          'middle' { [AbosGuiInput]::mouse_event(0x0020,0,0,0,[UIntPtr]::Zero); [AbosGuiInput]::mouse_event(0x0040,0,0,0,[UIntPtr]::Zero) }
          default { throw "unsupported pointer button: $button" }
        }''',
    '''          'left' { $sent = [AbosGuiInput]::SendMouseClick(0x0002,0x0004) }
          'right' { $sent = [AbosGuiInput]::SendMouseClick(0x0008,0x0010) }
          'middle' { $sent = [AbosGuiInput]::SendMouseClick(0x0020,0x0040) }
          default { throw "unsupported pointer button: $button" }
        }
        if ($sent -ne 2) { throw "SendInput accepted $sent of 2 mouse inputs" }''',
)
replace_once(
    runtime,
    '''    if ($action -eq 'key_press') {
      $key = Virtual-Key ([string]$protocol.key); $modifierMap = @{ CTRL = [ushort]0x11; ALT = [ushort]0x12; SHIFT = [ushort]0x10; WIN = [ushort]0x5B }; $mods = @($protocol.modifiers | ForEach-Object { ([string]$_).ToUpperInvariant() })
      foreach ($mod in $mods) { if (-not $modifierMap.ContainsKey($mod)) { throw "unsupported modifier: $mod" }; if (-not [AbosGuiInput]::SendVirtualKey($modifierMap[$mod], $false)) { throw "failed to press modifier: $mod" } }
      try { if (-not [AbosGuiInput]::SendVirtualKey($key, $false)) { throw 'failed to press key' }; if (-not [AbosGuiInput]::SendVirtualKey($key, $true)) { throw 'failed to release key' } } finally { [array]::Reverse($mods); foreach ($mod in $mods) { [void][AbosGuiInput]::SendVirtualKey($modifierMap[$mod], $true) } }
      Result @{ action = $action; key = [string]$protocol.key; modifiers = @($mods) }
    }''',
    '''    if ($action -eq 'key_press') {
      $key = Virtual-Key ([string]$protocol.key); $modifierMap = @{ CTRL = [ushort]0x11; ALT = [ushort]0x12; SHIFT = [ushort]0x10; WIN = [ushort]0x5B }; $mods = @($protocol.modifiers | ForEach-Object { ([string]$_).ToUpperInvariant() })
      $pressed = New-Object System.Collections.ArrayList; $keyDown = $false
      try {
        foreach ($mod in $mods) {
          if (-not $modifierMap.ContainsKey($mod)) { throw "unsupported modifier: $mod" }
          if (-not [AbosGuiInput]::SendVirtualKey($modifierMap[$mod], $false)) { throw "failed to press modifier: $mod" }
          [void]$pressed.Add($mod)
        }
        if (-not [AbosGuiInput]::SendVirtualKey($key, $false)) { throw 'failed to press key' }
        $keyDown = $true
        if (-not [AbosGuiInput]::SendVirtualKey($key, $true)) { throw 'failed to release key' }
        $keyDown = $false
      } finally {
        if ($keyDown) { [void][AbosGuiInput]::SendVirtualKey($key, $true) }
        $release = @($pressed); [array]::Reverse($release)
        foreach ($mod in $release) { [void][AbosGuiInput]::SendVirtualKey($modifierMap[$mod], $true) }
      }
      Result @{ action = $action; key = [string]$protocol.key; modifiers = @($mods) }
    }''',
)

replace_once(
    runtime,
    'export class LocalGuiRuntime {',
    '''export function prepareGuiCaptureTarget(
  captureRoot = path.join(getHomeDir(), ".abos", "gui-captures"),
  idFactory: () => string = randomUUID,
): string {
  const lexicalRoot = confinePathToLocalHome(captureRoot, "gui capture root");
  if (typeof lexicalRoot === "object") throw new Error(lexicalRoot.error);
  fs.mkdirSync(lexicalRoot, { recursive: true });
  const realRoot = fs.realpathSync(lexicalRoot);
  const confinedRoot = confinePathToLocalHome(realRoot, "gui capture real root");
  if (typeof confinedRoot === "object") throw new Error(confinedRoot.error);
  const proposed = path.join(confinedRoot, `gui-${Date.now()}-${idFactory()}.png`);
  const confined = confinePathToLocalHome(proposed, "gui capture");
  if (typeof confined === "object") throw new Error(confined.error);
  if (fs.existsSync(confined)) throw new Error(`gui capture target already exists: ${confined}`);
  return confined;
}

export class LocalGuiRuntime {''',
)
replace_once(
    runtime,
    'export class LocalGuiRuntime {\n  private runWindows',
    'export class LocalGuiRuntime {\n  private inputVerifiedAt: string | null = null;\n\n  private runWindows',
)
old_unavailable = 'return { observedAt, platform: process.platform, accessibility: { available: false, evidence: [...evidence] }, screen: { available: false, bounds: null, evidence: [...evidence] }, input: { available: false, evidence: [...evidence] } };'
new_unavailable = 'return { observedAt, platform: process.platform, accessibility: { available: false, state: "unavailable", evidence: [...evidence] }, screen: { available: false, state: "unavailable", bounds: null, evidence: [...evidence] }, input: { available: false, state: "unavailable", evidence: [...evidence] } };'
replace_once(runtime, old_unavailable, new_unavailable)
replace_once(
    runtime,
    '''      return {
        observedAt, platform: process.platform,
        accessibility: { available: accessibility.available === true, evidence: asEvidence(accessibility.evidence) },
        screen: { available: screen.available === true, bounds: asBounds(screen.bounds), evidence: asEvidence(screen.evidence) },
        input: { available: input.available === true, evidence: asEvidence(input.evidence) },
      };''',
    '''      const accessibilityAvailable = accessibility.available === true;
      const screenAvailable = screen.available === true;
      const inputProviderReady = input.providerReady === true;
      const inputAvailable = inputProviderReady && this.inputVerifiedAt !== null;
      const inputEvidence = asEvidence(input.evidence);
      inputEvidence.push(inputAvailable
        ? `Low-level input was explicitly accepted at ${this.inputVerifiedAt}.`
        : inputProviderReady
          ? "Low-level input provider is present, but the side-effect-free probe emitted no input; readiness remains probed until an explicit gui_input succeeds."
          : "Low-level input provider was not observed ready.");
      return {
        observedAt, platform: process.platform,
        accessibility: { available: accessibilityAvailable, state: accessibilityAvailable ? "verified_available" : "unavailable", evidence: asEvidence(accessibility.evidence) },
        screen: { available: screenAvailable, state: screenAvailable ? "verified_available" : "unavailable", bounds: asBounds(screen.bounds), evidence: asEvidence(screen.evidence) },
        input: { available: inputAvailable, state: inputAvailable ? "verified_available" : inputProviderReady ? "probed" : "unavailable", evidence: inputEvidence },
      };''',
)
replace_once(runtime, old_unavailable, new_unavailable)
replace_once(
    runtime,
    '''    const dir = path.join(getHomeDir(), ".abos", "gui-captures"); fs.mkdirSync(dir, { recursive: true });
    const proposed = path.join(dir, `gui-${Date.now()}-${randomUUID()}.png`); const confined = confinePathToLocalHome(proposed, "gui capture");
    if (typeof confined === "object") throw new Error(confined.error);''',
    '''    const confined = prepareGuiCaptureTarget();''',
)
replace_once(
    runtime,
    '    if (!fs.existsSync(confined)) throw new Error("GUI capture provider did not materialize the PNG");\n    const signature = fs.readFileSync(confined).subarray(0, 8).toString("hex");',
    '    if (!fs.existsSync(confined)) throw new Error("GUI capture provider did not materialize the PNG");\n    const outputStat = fs.lstatSync(confined);\n    if (outputStat.isSymbolicLink() || !outputStat.isFile()) { fs.rmSync(confined, { force: true }); throw new Error("GUI capture output is not a regular file"); }\n    const signature = fs.readFileSync(confined).subarray(0, 8).toString("hex");',
)
replace_once(
    runtime,
    '    if (!probe.input.available) throw new Error(`GUI low-level input is unavailable: ${probe.input.evidence.join("; ")}`);',
    '    if (probe.input.state === "unavailable") throw new Error(`GUI low-level input provider is unavailable: ${probe.input.evidence.join("; ")}`);',
)
replace_once(
    runtime,
    '    const result = this.runWindows(protocol); const { ok: _ok, ...output } = result;\n    return { ...output, observedAt: new Date().toISOString() };',
    '    const result = this.runWindows(protocol); const { ok: _ok, ...output } = result;\n    const observedAt = new Date().toISOString();\n    this.inputVerifiedAt = observedAt;\n    return { ...output, observedAt };',
)

replace_once(
    "src/gui/tools.ts",
    '''          const modifiers = Array.isArray(args.modifiers)
            ? args.modifiers.filter((entry): entry is "CTRL" | "ALT" | "SHIFT" | "WIN" => ["CTRL", "ALT", "SHIFT", "WIN"].includes(String(entry)))
            : undefined;
          return encode(runtime.input({ action, key: args.key, modifiers }));''',
    '''          let modifiers: Array<"CTRL" | "ALT" | "SHIFT" | "WIN"> | undefined;
          if (Array.isArray(args.modifiers)) {
            const allowed = new Set(["CTRL", "ALT", "SHIFT", "WIN"]);
            if (args.modifiers.some((entry) => typeof entry !== "string" || !allowed.has(entry))) {
              throw new Error("gui_input key_press received an unsupported modifier");
            }
            modifiers = args.modifiers as Array<"CTRL" | "ALT" | "SHIFT" | "WIN">;
          }
          return encode(runtime.input({ action, key: args.key, modifiers }));''',
)

replace_once(
    "src/environments/local.ts",
    '''    if (!gui.input.available) {
      constraints.push(
        "Local low-level GUI input is currently unavailable or not authorized on this host.",
      );
    }''',
    '''    if (gui.input.state === "probed") {
      constraints.push(
        "Local low-level GUI input provider is present, but execution readiness is not verified until an explicit input action succeeds.",
      );
    } else if (!gui.input.available) {
      constraints.push(
        "Local low-level GUI input is currently unavailable on this host.",
      );
    }''',
)
replace_once(
    "src/environments/local.ts",
    '        guiInputAvailable: gui.input.available,\n        guiObservedAt: gui.observedAt,',
    '        guiInputAvailable: gui.input.available,\n        guiInputState: gui.input.state,\n        guiObservedAt: gui.observedAt,',
)
replace_once("src/environments/local.ts", '          state: gui.accessibility.available ? "verified_available" : "unavailable",', '          state: gui.accessibility.state,')
replace_once("src/environments/local.ts", '          state: gui.screen.available ? "verified_available" : "unavailable",', '          state: gui.screen.state,')
replace_once("src/environments/local.ts", '          state: gui.input.available ? "verified_available" : "unavailable",', '          state: gui.input.state,')

replace_once(
    "src/capabilities/registry.ts",
    '''  if (snapshot.availability === "available") {
    return capability.available ? "verified_available" : "unavailable";
  }''',
    '''  if (snapshot.availability === "available") {
    const explicitState = typeof capability.state === "string" && capability.state.trim()
      ? capability.state.trim()
      : null;
    if (explicitState) {
      if (explicitState === "verified_available" && !capability.available) return "probed";
      return explicitState;
    }
    return capability.available ? "verified_available" : "unavailable";
  }''',
)

replace_once(
    "src/agent/tools.ts",
    'import { applyP012ToolRouting } from "./tools-p012-adapter.js";',
    'import { applyP012ToolRouting } from "./tools-p012-adapter.js";\nimport { createGuiTools } from "../gui/tools.js";',
)
replace_once(
    "src/agent/tools.ts",
    '  return applyP012ToolRouting(createCoreBuiltinTools(sandboxId), sandboxId);',
    '  return applyP012ToolRouting([\n    ...createCoreBuiltinTools(sandboxId),\n    ...createGuiTools(),\n  ], sandboxId);',
)

Path("src/__tests__/p016-local-gui-runtime.test.ts").write_text(r'''import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createBuiltinTools } from "../agent/tools.js";
import { CapabilityRegistry } from "../capabilities/registry.js";
import { LocalEnvironmentProvider } from "../environments/local.js";
import { LocalGuiRuntime, prepareGuiCaptureTarget } from "../gui/local-runtime.js";
import { createGuiTools } from "../gui/tools.js";
import { getHomeDir } from "../platform/home.js";

const cleanupPaths: string[] = [];
const cleanupProcesses: ChildProcess[] = [];

afterEach(() => {
  for (const child of cleanupProcesses.splice(0)) {
    try { child.kill(); } catch {}
  }
  for (const entry of cleanupPaths.splice(0)) {
    try { fs.rmSync(entry, { recursive: true, force: true }); } catch {}
  }
});

async function waitUntil<T>(probe: () => T | null | undefined, timeoutMs = 15_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = probe();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("condition not observed before timeout");
}

describe("P016 local GUI runtime", () => {
  it("wires GUI tools through the canonical builtin tool pipeline", () => {
    const names = new Set(createBuiltinTools("").map((tool) => tool.name));
    for (const name of ["gui_snapshot", "gui_capture", "gui_act", "gui_input"]) {
      expect(names.has(name)).toBe(true);
    }
  });

  it("preserves a probed per-capability state from an available environment", () => {
    const registry = new CapabilityRegistry();
    const observedAt = new Date().toISOString();
    registry.registerEnvironmentSnapshot({
      id: "local",
      label: "Local",
      availability: "available",
      observedAt,
      evidence: ["host observed"],
      constraints: [],
      capabilities: [{
        id: "local:gui-input",
        type: "executor",
        provider: "local-gui",
        description: "input provider",
        requirements: ["gui input"],
        provides: ["gui input"],
        permissions: ["desktop-input"],
        available: false,
        state: "probed",
        observedAt,
        authority: "local-gui-runtime:input-probe",
        evidence: ["provider present; no input emitted"],
      }],
    });
    expect(registry.get("local:gui-input")?.state).toBe("probed");
    expect(registry.get("local:gui-input")?.available).toBe(false);
  });

  it("projects split GUI primitive state without fabricating input readiness", async () => {
    const provider = new LocalEnvironmentProvider(
      { probe: async () => ({ available: false, observedAt: new Date().toISOString(), target: null, browserVersion: null, evidence: ["no browser"] }) } as never,
      { probe: () => ({ available: true, observedAt: new Date().toISOString(), shell: "shell", evidence: ["shell ready"] }) } as never,
      { probe: () => ({
        observedAt: new Date().toISOString(), platform: "win32",
        accessibility: { available: true, state: "verified_available", evidence: ["uia root"] },
        screen: { available: true, state: "verified_available", bounds: { x: 0, y: 0, width: 100, height: 100 }, evidence: ["capture works"] },
        input: { available: false, state: "probed", evidence: ["provider only"] },
      }) } as never,
    );
    const snapshot = await provider.inspect();
    expect(snapshot.capabilities.find((entry) => entry.id === "local:gui-accessibility")?.state).toBe("verified_available");
    expect(snapshot.capabilities.find((entry) => entry.id === "local:gui-screen")?.state).toBe("verified_available");
    expect(snapshot.capabilities.find((entry) => entry.id === "local:gui-input")?.state).toBe("probed");
    expect(snapshot.constraints.join(" ")).toContain("not verified until an explicit input action succeeds");
  });

  it("rejects unsupported modifiers instead of silently dropping them", async () => {
    const runtime = { input: () => ({ ok: true }) } as never;
    const tool = createGuiTools(runtime).find((entry) => entry.name === "gui_input")!;
    await expect(tool.execute({ action: "key_press", key: "A", modifiers: ["CTRL", "NOPE"] } as never, {} as never))
      .rejects.toThrow("unsupported modifier");
  });

  if (process.platform !== "win32") {
    it("classifies unsupported host GUI primitives as unavailable, not impossible", () => {
      const probe = new LocalGuiRuntime().probe();
      expect(probe.accessibility.state).toBe("unavailable");
      expect(probe.screen.state).toBe("unavailable");
      expect(probe.input.state).toBe("unavailable");
      expect(probe.input.evidence.join(" ")).toContain("No validated provider-native GUI adapter");
    });

    it("rejects a capture root whose materialized realpath escapes HOME", () => {
      const inside = fs.mkdtempSync(path.join(getHomeDir(), ".abos-gui-path-"));
      const outside = fs.mkdtempSync(path.join(os.tmpdir(), "abos-gui-outside-"));
      cleanupPaths.push(inside, outside);
      const link = path.join(inside, "capture-link");
      fs.symlinkSync(outside, link, "dir");
      expect(() => prepareGuiCaptureTarget(link, () => "fixed-id"))
        .toThrow("outside the allowed directory");
    });
  }

  if (process.platform === "win32") {
    it("observes and controls a real Windows UI through semantic and explicit low-level paths", async () => {
      const runtime = new LocalGuiRuntime();
      const initial = runtime.probe();
      expect(initial.accessibility.state).toBe("verified_available");
      expect(initial.screen.state).toBe("verified_available");
      expect(initial.input.state).toBe("probed");
      expect(initial.input.available).toBe(false);
      expect(initial.screen.bounds).not.toBeNull();

      const token = randomUUID().replace(/-/g, "");
      const title = `ABOS GUI ${token}`;
      const semanticName = `ABOS Semantic ${token}`;
      const inputName = `ABOS Input ${token}`;
      const semanticMarker = path.join(getHomeDir(), `.abos-gui-semantic-${token}.txt`);
      const inputMarker = path.join(getHomeDir(), `.abos-gui-input-${token}.txt`);
      cleanupPaths.push(semanticMarker, inputMarker);
      const quote = (value: string) => `'${value.replace(/'/g, "''")}'`;
      const script = [
        "Add-Type -AssemblyName System.Windows.Forms",
        "$form = New-Object System.Windows.Forms.Form",
        `$form.Text = ${quote(title)}`,
        "$form.Width = 500; $form.Height = 280; $form.StartPosition = 'CenterScreen'; $form.TopMost = $true",
        "$semantic = New-Object System.Windows.Forms.Button",
        `$semantic.Text = ${quote(semanticName)}`,
        "$semantic.Left = 50; $semantic.Top = 50; $semantic.Width = 350; $semantic.Height = 55",
        `$semantic.Add_Click({ [System.IO.File]::WriteAllText(${quote(semanticMarker)}, 'semantic') })`,
        "$input = New-Object System.Windows.Forms.Button",
        `$input.Text = ${quote(inputName)}`,
        "$input.Left = 50; $input.Top = 130; $input.Width = 350; $input.Height = 55",
        `$input.Add_Click({ [System.IO.File]::WriteAllText(${quote(inputMarker)}, 'input') })`,
        "$form.Controls.Add($semantic); $form.Controls.Add($input)",
        "$form.Add_Shown({ $form.Activate() })",
        "[void]$form.ShowDialog()",
      ].join("; ");
      const child = spawn("powershell.exe", ["-NoLogo", "-NoProfile", "-STA", "-Command", script], { windowsHide: false, stdio: "ignore" });
      cleanupProcesses.push(child);

      const formElement = await waitUntil(() => {
        try {
          const snapshot = runtime.snapshot({ maxDepth: 6, maxNodes: 500 });
          return snapshot.elements.find((entry) => entry.name === title) ?? null;
        } catch {
          return null;
        }
      });
      expect(formElement.processId).toBeGreaterThan(0);

      runtime.act("invoke", { name: semanticName, processId: formElement.processId });
      await waitUntil(() => fs.existsSync(semanticMarker) ? true : null);
      expect(fs.readFileSync(semanticMarker, "utf8")).toBe("semantic");

      const inputElement = await waitUntil(() => {
        const snapshot = runtime.snapshot({ maxDepth: 6, maxNodes: 500 });
        return snapshot.elements.find((entry) => entry.name === inputName && entry.processId === formElement.processId) ?? null;
      });
      expect(inputElement.bounds).not.toBeNull();
      runtime.act("focus", { name: title, processId: formElement.processId });
      const b = inputElement.bounds!;
      const lowLevel = runtime.input({
        action: "pointer_click",
        x: Math.floor(b.x + b.width / 2),
        y: Math.floor(b.y + b.height / 2),
        button: "left",
      });
      expect(lowLevel.action).toBe("pointer_click");
      await waitUntil(() => fs.existsSync(inputMarker) ? true : null);
      expect(fs.readFileSync(inputMarker, "utf8")).toBe("input");

      const afterInput = runtime.probe();
      expect(afterInput.input.state).toBe("verified_available");
      expect(afterInput.input.available).toBe(true);

      const capture = runtime.capture();
      cleanupPaths.push(capture.path);
      expect(fs.readFileSync(capture.path).subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
      expect(path.resolve(capture.path).startsWith(path.resolve(getHomeDir()) + path.sep)).toBe(true);
    }, 60_000);
  }
});
''', encoding="utf-8")
