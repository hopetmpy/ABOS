import { spawn, type ChildProcess } from "node:child_process";
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
