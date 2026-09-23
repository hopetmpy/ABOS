from pathlib import Path

p = Path("src/gui/local-runtime.ts")
text = p.read_text(encoding="utf-8")

old_import = 'import fs from "node:fs";\nimport path from "node:path";'
new_import = 'import fs from "node:fs";\nimport os from "node:os";\nimport path from "node:path";'
if old_import not in text:
    raise SystemExit("expected import block not found")
text = text.replace(old_import, new_import, 1)

encoded = 'const WINDOWS_GUI_PROVIDER_ENCODED = Buffer.from(WINDOWS_GUI_PROVIDER, "utf16le").toString("base64");\n\n'
if encoded not in text:
    raise SystemExit("encoded provider constant not found")
text = text.replace(encoded, "", 1)

old = '''  private runWindows(protocol: Record<string, unknown>, timeoutMs = GUI_PROVIDER_TIMEOUT_MS): WindowsProviderResult {
    if (process.platform !== "win32") throw new Error(`Local GUI provider is unavailable on platform ${process.platform}`);
    const result = spawnSync("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", WINDOWS_GUI_PROVIDER_ENCODED], {
      input: JSON.stringify(protocol), encoding: "utf8", windowsHide: true, timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024,
    });
    if (result.error) throw new Error(`Windows GUI provider launch failed: ${result.error.message}`);
    if (typeof result.status === "number" && result.status !== 0) throw new Error(`Windows GUI provider exited ${result.status}: ${result.stderr || "no stderr"}`);
    return parseProviderJson(result.stdout || "");
  }'''
new = '''  private runWindows(protocol: Record<string, unknown>, timeoutMs = GUI_PROVIDER_TIMEOUT_MS): WindowsProviderResult {
    if (process.platform !== "win32") throw new Error(`Local GUI provider is unavailable on platform ${process.platform}`);
    const invocationDir = fs.mkdtempSync(path.join(os.tmpdir(), "abos-gui-provider-"));
    const scriptPath = path.join(invocationDir, "provider.ps1");
    fs.writeFileSync(scriptPath, WINDOWS_GUI_PROVIDER, { encoding: "utf8", flag: "wx", mode: 0o600 });
    try {
      const result = spawnSync("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptPath], {
        input: JSON.stringify(protocol), encoding: "utf8", windowsHide: true, timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024,
      });
      if (result.error) throw new Error(`Windows GUI provider launch failed: ${result.error.message}`);
      if (typeof result.status === "number" && result.status !== 0) throw new Error(`Windows GUI provider exited ${result.status}: ${result.stderr || "no stderr"}`);
      return parseProviderJson(result.stdout || "");
    } finally {
      fs.rmSync(invocationDir, { recursive: true, force: true });
    }
  }'''
if old not in text:
    raise SystemExit("runWindows block not found")
text = text.replace(old, new, 1)

p.write_text(text, encoding="utf-8")
