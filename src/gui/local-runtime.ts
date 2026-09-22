import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getHomeDir } from "../platform/home.js";
import { confinePathToLocalHome } from "../platform/path-confinement.js";

const GUI_PROVIDER_TIMEOUT_MS = 20_000;
const MAX_SNAPSHOT_DEPTH = 6;
const MAX_SNAPSHOT_NODES = 500;
const MAX_ACTION_SCAN_NODES = 5_000;
const MAX_TEXT_LENGTH = 4_096;

export interface GuiBounds { x: number; y: number; width: number; height: number; }
export interface GuiPrimitiveProbe { available: boolean; evidence: string[]; }
export interface LocalGuiProbe {
  observedAt: string;
  platform: string;
  accessibility: GuiPrimitiveProbe;
  screen: GuiPrimitiveProbe & { bounds: GuiBounds | null };
  input: GuiPrimitiveProbe;
}
export interface GuiElementSnapshot {
  name: string;
  automationId: string;
  controlType: string;
  className: string;
  processId: number;
  enabled: boolean;
  offscreen: boolean;
  bounds: GuiBounds | null;
  patterns: string[];
  depth: number;
}
export interface GuiSnapshot {
  observedAt: string;
  truncated: boolean;
  maxDepth: number;
  maxNodes: number;
  elements: GuiElementSnapshot[];
}
export interface GuiSelector {
  name?: string;
  automationId?: string;
  controlType?: string;
  className?: string;
  processId?: number;
}
export type GuiSemanticAction = "focus" | "invoke" | "set_value" | "toggle" | "select" | "expand" | "collapse";
export type GuiInputRequest =
  | { action: "pointer_move"; x: number; y: number }
  | { action: "pointer_click"; x: number; y: number; button?: "left" | "right" | "middle" }
  | { action: "type_text"; text: string }
  | { action: "key_press"; key: string; modifiers?: Array<"CTRL" | "ALT" | "SHIFT" | "WIN"> };

interface WindowsProviderResult { ok: boolean; [key: string]: unknown; }

const WINDOWS_GUI_PROVIDER = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Result([hashtable]$value) {
  $value['ok'] = $true
  $value | ConvertTo-Json -Compress -Depth 10
  exit 0
}
function Fail([string]$message) {
  @{ ok = $false; error = $message } | ConvertTo-Json -Compress -Depth 6
  exit 0
}
function Load-UiAutomation {
  Add-Type -AssemblyName UIAutomationClient
  Add-Type -AssemblyName UIAutomationTypes
}
function Load-Screen {
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
}
function Bounds-Object($rect) {
  if ($null -eq $rect) { return $null }
  if ([double]::IsNaN($rect.X) -or [double]::IsInfinity($rect.X)) { return $null }
  return @{ x = [int][Math]::Round($rect.X); y = [int][Math]::Round($rect.Y); width = [int][Math]::Round($rect.Width); height = [int][Math]::Round($rect.Height) }
}
function Element-Summary($element, [int]$depth) {
  try { $name = [string]$element.Current.Name } catch { $name = '' }
  try { $automationId = [string]$element.Current.AutomationId } catch { $automationId = '' }
  try { $controlType = [string]$element.Current.ControlType.ProgrammaticName } catch { $controlType = '' }
  try { $className = [string]$element.Current.ClassName } catch { $className = '' }
  try { $processId = [int]$element.Current.ProcessId } catch { $processId = 0 }
  try { $enabled = [bool]$element.Current.IsEnabled } catch { $enabled = $false }
  try { $offscreen = [bool]$element.Current.IsOffscreen } catch { $offscreen = $true }
  try { $bounds = Bounds-Object $element.Current.BoundingRectangle } catch { $bounds = $null }
  try { $patterns = @($element.GetSupportedPatterns() | ForEach-Object { [string]$_.ProgrammaticName }) } catch { $patterns = @() }
  return @{ name = $name; automationId = $automationId; controlType = $controlType; className = $className; processId = $processId; enabled = $enabled; offscreen = $offscreen; bounds = $bounds; patterns = $patterns; depth = $depth }
}
function Selector-HasField($selector) {
  return ($null -ne $selector) -and (
    -not [string]::IsNullOrWhiteSpace([string]$selector.name) -or
    -not [string]::IsNullOrWhiteSpace([string]$selector.automationId) -or
    -not [string]::IsNullOrWhiteSpace([string]$selector.controlType) -or
    -not [string]::IsNullOrWhiteSpace([string]$selector.className) -or
    $null -ne $selector.processId
  )
}
function Matches-Selector($element, $selector) {
  try {
    if (-not [string]::IsNullOrWhiteSpace([string]$selector.name) -and [string]$element.Current.Name -ne [string]$selector.name) { return $false }
    if (-not [string]::IsNullOrWhiteSpace([string]$selector.automationId) -and [string]$element.Current.AutomationId -ne [string]$selector.automationId) { return $false }
    if (-not [string]::IsNullOrWhiteSpace([string]$selector.className) -and [string]$element.Current.ClassName -ne [string]$selector.className) { return $false }
    if ($null -ne $selector.processId -and [int]$element.Current.ProcessId -ne [int]$selector.processId) { return $false }
    if (-not [string]::IsNullOrWhiteSpace([string]$selector.controlType)) {
      $actual = [string]$element.Current.ControlType.ProgrammaticName
      $expected = [string]$selector.controlType
      if ($expected -notlike 'ControlType.*') { $expected = "ControlType.$expected" }
      if ($actual -ne $expected) { return $false }
    }
    return $true
  } catch { return $false }
}
function Resolve-UniqueElement($selector, [int]$maxNodes) {
  if (-not (Selector-HasField $selector)) { throw 'semantic selector requires at least one field' }
  $root = [System.Windows.Automation.AutomationElement]::RootElement
  if ($null -eq $root) { throw 'UIAutomation root is unavailable' }
  $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
  $queue = New-Object System.Collections.Queue
  $queue.Enqueue($root)
  $matches = New-Object System.Collections.ArrayList
  $visited = 0
  while ($queue.Count -gt 0 -and $visited -lt $maxNodes) {
    $element = $queue.Dequeue(); $visited++
    if (Matches-Selector $element $selector) {
      [void]$matches.Add($element)
      if ($matches.Count -gt 1) { break }
    }
    try { $child = $walker.GetFirstChild($element) } catch { $child = $null }
    while ($null -ne $child) {
      $queue.Enqueue($child)
      try { $child = $walker.GetNextSibling($child) } catch { $child = $null }
    }
  }
  if ($matches.Count -eq 0) { throw "semantic selector matched zero elements (visited=$visited)" }
  if ($matches.Count -gt 1) {
    $first = Element-Summary $matches[0] 0; $second = Element-Summary $matches[1] 0
    throw "semantic selector is ambiguous; matched multiple elements: $($first.name) / $($second.name)"
  }
  return $matches[0]
}

$inputSource = @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class AbosGuiInput
{
    private const uint INPUT_KEYBOARD = 1;
    private const uint KEYEVENTF_KEYUP = 0x0002;
    private const uint KEYEVENTF_UNICODE = 0x0004;
    [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
    [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
    [StructLayout(LayoutKind.Explicit)] public struct INPUTUNION { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
    [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public INPUTUNION U; }
    [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
    [DllImport("user32.dll", SetLastError = true)] public static extern bool SetCursorPos(int X, int Y);
    [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT point);
    [DllImport("user32.dll")] public static extern IntPtr GetDesktopWindow();
    [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extraInfo);
    [DllImport("user32.dll", SetLastError = true)] private static extern uint SendInput(uint count, INPUT[] inputs, int size);
    public static uint SendUnicode(string text) {
        var inputs = new List<INPUT>(text.Length * 2);
        foreach (var ch in text) {
            inputs.Add(new INPUT { type = INPUT_KEYBOARD, U = new INPUTUNION { ki = new KEYBDINPUT { wScan = (ushort)ch, dwFlags = KEYEVENTF_UNICODE } } });
            inputs.Add(new INPUT { type = INPUT_KEYBOARD, U = new INPUTUNION { ki = new KEYBDINPUT { wScan = (ushort)ch, dwFlags = KEYEVENTF_UNICODE | KEYEVENTF_KEYUP } } });
        }
        if (inputs.Count == 0) return 0;
        return SendInput((uint)inputs.Count, inputs.ToArray(), Marshal.SizeOf(typeof(INPUT)));
    }
    public static bool SendVirtualKey(ushort key, bool keyUp) {
        var input = new INPUT { type = INPUT_KEYBOARD, U = new INPUTUNION { ki = new KEYBDINPUT { wVk = key, dwFlags = keyUp ? KEYEVENTF_KEYUP : 0 } } };
        return SendInput(1, new[] { input }, Marshal.SizeOf(typeof(INPUT))) == 1;
    }
}
'@
function Load-Input { Add-Type -TypeDefinition $inputSource -Language CSharp }
function Virtual-Key([string]$key) {
  $upper = $key.ToUpperInvariant()
  $named = @{ ENTER = 0x0D; TAB = 0x09; ESC = 0x1B; ESCAPE = 0x1B; BACKSPACE = 0x08; DELETE = 0x2E; LEFT = 0x25; UP = 0x26; RIGHT = 0x27; DOWN = 0x28; HOME = 0x24; END = 0x23; PAGEUP = 0x21; PAGEDOWN = 0x22; SPACE = 0x20; F1 = 0x70; F2 = 0x71; F3 = 0x72; F4 = 0x73; F5 = 0x74; F6 = 0x75; F7 = 0x76; F8 = 0x77; F9 = 0x78; F10 = 0x79; F11 = 0x7A; F12 = 0x7B }
  if ($named.ContainsKey($upper)) { return [ushort]$named[$upper] }
  if ($upper.Length -eq 1) {
    $code = [int][char]$upper[0]
    if (($code -ge 0x30 -and $code -le 0x39) -or ($code -ge 0x41 -and $code -le 0x5A)) { return [ushort]$code }
  }
  throw "unsupported key: $key"
}

try {
  $protocolText = [Console]::In.ReadToEnd()
  if ([string]::IsNullOrWhiteSpace($protocolText)) { Fail 'missing provider protocol' }
  $protocol = $protocolText | ConvertFrom-Json

  if ($protocol.op -eq 'probe') {
    $accessibilityEvidence = New-Object System.Collections.ArrayList; $screenEvidence = New-Object System.Collections.ArrayList; $inputEvidence = New-Object System.Collections.ArrayList
    $accessibility = $false; $screen = $false; $input = $false; $bounds = $null
    if (-not [Environment]::UserInteractive) {
      [void]$accessibilityEvidence.Add('Environment.UserInteractive=false'); [void]$screenEvidence.Add('Environment.UserInteractive=false'); [void]$inputEvidence.Add('Environment.UserInteractive=false')
    } else {
      try { Load-UiAutomation; $root = [System.Windows.Automation.AutomationElement]::RootElement; $accessibility = $null -ne $root; [void]$accessibilityEvidence.Add("UIAutomation RootElement=$accessibility") } catch { [void]$accessibilityEvidence.Add("UIAutomation probe failed: $($_.Exception.Message)") }
      try {
        Load-Screen; $virtual = [System.Windows.Forms.SystemInformation]::VirtualScreen; $bounds = @{ x = $virtual.X; y = $virtual.Y; width = $virtual.Width; height = $virtual.Height }
        if ($virtual.Width -gt 0 -and $virtual.Height -gt 0) {
          $bmp = New-Object System.Drawing.Bitmap 1,1; $graphics = [System.Drawing.Graphics]::FromImage($bmp)
          try { $graphics.CopyFromScreen($virtual.X, $virtual.Y, 0, 0, (New-Object System.Drawing.Size 1,1)); $screen = $true } finally { $graphics.Dispose(); $bmp.Dispose() }
        }
        [void]$screenEvidence.Add("virtualScreen=$($virtual.X),$($virtual.Y),$($virtual.Width),$($virtual.Height); CopyFromScreen=$screen")
      } catch { [void]$screenEvidence.Add("screen probe failed: $($_.Exception.Message)") }
      try { Load-Input; $point = New-Object AbosGuiInput+POINT; $desktop = [AbosGuiInput]::GetDesktopWindow(); $cursor = [AbosGuiInput]::GetCursorPos([ref]$point); $input = ($desktop -ne [IntPtr]::Zero) -and $cursor; [void]$inputEvidence.Add("user32 desktop=$($desktop -ne [IntPtr]::Zero); cursorReadable=$cursor; per-target UIPI may still deny an action") } catch { [void]$inputEvidence.Add("input probe failed: $($_.Exception.Message)") }
    }
    Result @{ userInteractive = [Environment]::UserInteractive; accessibility = @{ available = $accessibility; evidence = @($accessibilityEvidence) }; screen = @{ available = $screen; bounds = $bounds; evidence = @($screenEvidence) }; input = @{ available = $input; evidence = @($inputEvidence) } }
  }

  if ($protocol.op -eq 'snapshot') {
    Load-UiAutomation; $root = [System.Windows.Automation.AutomationElement]::RootElement; if ($null -eq $root) { throw 'UIAutomation root is unavailable' }
    $maxDepth = [Math]::Max(0, [Math]::Min([int]$protocol.maxDepth, 6)); $maxNodes = [Math]::Max(1, [Math]::Min([int]$protocol.maxNodes, 500))
    $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker; $queue = New-Object System.Collections.Queue; $queue.Enqueue([pscustomobject]@{ element = $root; depth = 0 }); $elements = New-Object System.Collections.ArrayList; $truncated = $false
    while ($queue.Count -gt 0) {
      if ($elements.Count -ge $maxNodes) { $truncated = $true; break }
      $item = $queue.Dequeue(); [void]$elements.Add((Element-Summary $item.element $item.depth)); if ($item.depth -ge $maxDepth) { continue }
      try { $child = $walker.GetFirstChild($item.element) } catch { $child = $null }
      while ($null -ne $child) { $queue.Enqueue([pscustomobject]@{ element = $child; depth = $item.depth + 1 }); try { $child = $walker.GetNextSibling($child) } catch { $child = $null } }
    }
    Result @{ truncated = $truncated; elements = @($elements) }
  }

  if ($protocol.op -eq 'act') {
    Load-UiAutomation; $element = Resolve-UniqueElement $protocol.selector $protocol.maxNodes; $action = [string]$protocol.action
    switch ($action) {
      'focus' { $element.SetFocus() }
      'invoke' { $pattern = $element.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern); ([System.Windows.Automation.InvokePattern]$pattern).Invoke() }
      'set_value' { $pattern = $element.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern); ([System.Windows.Automation.ValuePattern]$pattern).SetValue([string]$protocol.value) }
      'toggle' { $pattern = $element.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern); ([System.Windows.Automation.TogglePattern]$pattern).Toggle() }
      'select' { $pattern = $element.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern); ([System.Windows.Automation.SelectionItemPattern]$pattern).Select() }
      'expand' { $pattern = $element.GetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern); ([System.Windows.Automation.ExpandCollapsePattern]$pattern).Expand() }
      'collapse' { $pattern = $element.GetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern); ([System.Windows.Automation.ExpandCollapsePattern]$pattern).Collapse() }
      default { throw "unsupported semantic action: $action" }
    }
    Result @{ action = $action; element = (Element-Summary $element 0) }
  }

  if ($protocol.op -eq 'capture') {
    Load-Screen; $virtual = [System.Windows.Forms.SystemInformation]::VirtualScreen; if ($virtual.Width -le 0 -or $virtual.Height -le 0) { throw 'virtual screen has no drawable bounds' }
    $bmp = New-Object System.Drawing.Bitmap $virtual.Width,$virtual.Height; $graphics = [System.Drawing.Graphics]::FromImage($bmp)
    try { $graphics.CopyFromScreen($virtual.X, $virtual.Y, 0, 0, (New-Object System.Drawing.Size $virtual.Width,$virtual.Height)); $bmp.Save([string]$protocol.path, [System.Drawing.Imaging.ImageFormat]::Png) } finally { $graphics.Dispose(); $bmp.Dispose() }
    Result @{ path = [string]$protocol.path; bounds = @{ x = $virtual.X; y = $virtual.Y; width = $virtual.Width; height = $virtual.Height } }
  }

  if ($protocol.op -eq 'input') {
    if (-not [Environment]::UserInteractive) { throw 'interactive desktop is unavailable' }
    Load-Screen; Load-Input; $virtual = [System.Windows.Forms.SystemInformation]::VirtualScreen; $action = [string]$protocol.action
    if ($action -eq 'pointer_move' -or $action -eq 'pointer_click') {
      $x = [int]$protocol.x; $y = [int]$protocol.y
      if ($x -lt $virtual.X -or $y -lt $virtual.Y -or $x -ge ($virtual.X + $virtual.Width) -or $y -ge ($virtual.Y + $virtual.Height)) { throw "pointer coordinates outside observed virtual screen: $x,$y" }
      if (-not [AbosGuiInput]::SetCursorPos($x, $y)) { throw 'SetCursorPos failed' }
      if ($action -eq 'pointer_click') {
        $button = [string]$protocol.button; if ([string]::IsNullOrWhiteSpace($button)) { $button = 'left' }
        switch ($button) {
          'left' { [AbosGuiInput]::mouse_event(0x0002,0,0,0,[UIntPtr]::Zero); [AbosGuiInput]::mouse_event(0x0004,0,0,0,[UIntPtr]::Zero) }
          'right' { [AbosGuiInput]::mouse_event(0x0008,0,0,0,[UIntPtr]::Zero); [AbosGuiInput]::mouse_event(0x0010,0,0,0,[UIntPtr]::Zero) }
          'middle' { [AbosGuiInput]::mouse_event(0x0020,0,0,0,[UIntPtr]::Zero); [AbosGuiInput]::mouse_event(0x0040,0,0,0,[UIntPtr]::Zero) }
          default { throw "unsupported pointer button: $button" }
        }
      }
      $point = New-Object AbosGuiInput+POINT; [void][AbosGuiInput]::GetCursorPos([ref]$point); Result @{ action = $action; cursor = @{ x = $point.X; y = $point.Y }; button = $protocol.button }
    }
    if ($action -eq 'type_text') {
      $text = [string]$protocol.text; $expected = [uint32]($text.Length * 2); $sent = [AbosGuiInput]::SendUnicode($text)
      if ($sent -ne $expected) { throw "SendInput accepted $sent of $expected unicode keyboard inputs" }
      Result @{ action = $action; characters = $text.Length; inputEvents = $sent }
    }
    if ($action -eq 'key_press') {
      $key = Virtual-Key ([string]$protocol.key); $modifierMap = @{ CTRL = [ushort]0x11; ALT = [ushort]0x12; SHIFT = [ushort]0x10; WIN = [ushort]0x5B }; $mods = @($protocol.modifiers | ForEach-Object { ([string]$_).ToUpperInvariant() })
      foreach ($mod in $mods) { if (-not $modifierMap.ContainsKey($mod)) { throw "unsupported modifier: $mod" }; if (-not [AbosGuiInput]::SendVirtualKey($modifierMap[$mod], $false)) { throw "failed to press modifier: $mod" } }
      try { if (-not [AbosGuiInput]::SendVirtualKey($key, $false)) { throw 'failed to press key' }; if (-not [AbosGuiInput]::SendVirtualKey($key, $true)) { throw 'failed to release key' } } finally { [array]::Reverse($mods); foreach ($mod in $mods) { [void][AbosGuiInput]::SendVirtualKey($modifierMap[$mod], $true) } }
      Result @{ action = $action; key = [string]$protocol.key; modifiers = @($mods) }
    }
    throw "unsupported input action: $action"
  }
  Fail "unsupported provider operation: $($protocol.op)"
} catch { Fail $_.Exception.Message }
`;

const WINDOWS_GUI_PROVIDER_ENCODED = Buffer.from(WINDOWS_GUI_PROVIDER, "utf16le").toString("base64");

function asEvidence(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}
function asBounds(value: unknown): GuiBounds | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const x = Number(candidate.x); const y = Number(candidate.y); const width = Number(candidate.width); const height = Number(candidate.height);
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null;
  return { x, y, width, height };
}
function normalizeElement(value: unknown): GuiElementSnapshot {
  const record = (value && typeof value === "object" && !Array.isArray(value)) ? value as Record<string, unknown> : {};
  return {
    name: typeof record.name === "string" ? record.name : "",
    automationId: typeof record.automationId === "string" ? record.automationId : "",
    controlType: typeof record.controlType === "string" ? record.controlType : "",
    className: typeof record.className === "string" ? record.className : "",
    processId: Number.isFinite(Number(record.processId)) ? Number(record.processId) : 0,
    enabled: record.enabled === true,
    offscreen: record.offscreen === true,
    bounds: asBounds(record.bounds),
    patterns: Array.isArray(record.patterns) ? record.patterns.filter((entry): entry is string => typeof entry === "string") : [],
    depth: Number.isFinite(Number(record.depth)) ? Number(record.depth) : 0,
  };
}
function requireFiniteInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || !Number.isFinite(value)) throw new Error(`${label} must be a finite integer`);
  return value;
}
function validateSelector(selector: GuiSelector): GuiSelector {
  const entries = Object.entries(selector).filter(([, value]) => value !== undefined && value !== null && value !== "");
  if (entries.length === 0) throw new Error("gui semantic selector requires at least one field");
  const normalized: GuiSelector = {};
  for (const [key, value] of entries) {
    if (key === "processId") { normalized.processId = requireFiniteInteger(Number(value), "selector.processId"); continue; }
    if (!["name", "automationId", "controlType", "className"].includes(key) || typeof value !== "string") throw new Error(`unsupported gui selector field: ${key}`);
    if (value.length > 512) throw new Error(`gui selector field ${key} is too long`);
    (normalized as Record<string, unknown>)[key] = value;
  }
  return normalized;
}
function parseProviderJson(stdout: string): WindowsProviderResult {
  const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) throw new Error("Windows GUI provider returned no result");
  let parsed: unknown;
  try { parsed = JSON.parse(lines.at(-1)!); } catch { throw new Error(`Windows GUI provider returned invalid JSON: ${lines.at(-1)}`); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Windows GUI provider result was not an object");
  const result = parsed as WindowsProviderResult;
  if (result.ok !== true) throw new Error(typeof result.error === "string" ? result.error : "Windows GUI provider failed");
  return result;
}

export class LocalGuiRuntime {
  private runWindows(protocol: Record<string, unknown>, timeoutMs = GUI_PROVIDER_TIMEOUT_MS): WindowsProviderResult {
    if (process.platform !== "win32") throw new Error(`Local GUI provider is unavailable on platform ${process.platform}`);
    const result = spawnSync("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", WINDOWS_GUI_PROVIDER_ENCODED], {
      input: JSON.stringify(protocol), encoding: "utf8", windowsHide: true, timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024,
    });
    if (result.error) throw new Error(`Windows GUI provider launch failed: ${result.error.message}`);
    if (typeof result.status === "number" && result.status !== 0) throw new Error(`Windows GUI provider exited ${result.status}: ${result.stderr || "no stderr"}`);
    return parseProviderJson(result.stdout || "");
  }

  probe(): LocalGuiProbe {
    const observedAt = new Date().toISOString();
    if (process.platform !== "win32") {
      const evidence = [`No validated provider-native GUI adapter is installed for platform=${process.platform}.`];
      return { observedAt, platform: process.platform, accessibility: { available: false, evidence: [...evidence] }, screen: { available: false, bounds: null, evidence: [...evidence] }, input: { available: false, evidence: [...evidence] } };
    }
    try {
      const result = this.runWindows({ op: "probe" });
      const accessibility = (result.accessibility ?? {}) as Record<string, unknown>; const screen = (result.screen ?? {}) as Record<string, unknown>; const input = (result.input ?? {}) as Record<string, unknown>;
      return {
        observedAt, platform: process.platform,
        accessibility: { available: accessibility.available === true, evidence: asEvidence(accessibility.evidence) },
        screen: { available: screen.available === true, bounds: asBounds(screen.bounds), evidence: asEvidence(screen.evidence) },
        input: { available: input.available === true, evidence: asEvidence(input.evidence) },
      };
    } catch (error) {
      const evidence = [`Windows GUI probe failed: ${error instanceof Error ? error.message : String(error)}`];
      return { observedAt, platform: process.platform, accessibility: { available: false, evidence: [...evidence] }, screen: { available: false, bounds: null, evidence: [...evidence] }, input: { available: false, evidence: [...evidence] } };
    }
  }

  snapshot(options: { maxDepth?: number; maxNodes?: number } = {}): GuiSnapshot {
    const maxDepth = Math.max(0, Math.min(MAX_SNAPSHOT_DEPTH, requireFiniteInteger(options.maxDepth ?? 4, "maxDepth")));
    const maxNodes = Math.max(1, Math.min(MAX_SNAPSHOT_NODES, requireFiniteInteger(options.maxNodes ?? 200, "maxNodes")));
    const probe = this.probe();
    if (!probe.accessibility.available) throw new Error(`GUI accessibility is unavailable: ${probe.accessibility.evidence.join("; ")}`);
    const result = this.runWindows({ op: "snapshot", maxDepth, maxNodes });
    return { observedAt: new Date().toISOString(), truncated: result.truncated === true, maxDepth, maxNodes, elements: Array.isArray(result.elements) ? result.elements.map(normalizeElement) : [] };
  }

  act(action: GuiSemanticAction, selector: GuiSelector, value?: string): { action: GuiSemanticAction; element: GuiElementSnapshot; observedAt: string } {
    const probe = this.probe();
    if (!probe.accessibility.available) throw new Error(`GUI accessibility is unavailable: ${probe.accessibility.evidence.join("; ")}`);
    if (action === "set_value" && typeof value !== "string") throw new Error("set_value requires value");
    if (typeof value === "string" && value.length > MAX_TEXT_LENGTH) throw new Error(`GUI action value exceeds ${MAX_TEXT_LENGTH} characters`);
    const result = this.runWindows({ op: "act", action, selector: validateSelector(selector), value, maxNodes: MAX_ACTION_SCAN_NODES });
    return { action, element: normalizeElement(result.element), observedAt: new Date().toISOString() };
  }

  capture(): { path: string; bounds: GuiBounds; observedAt: string } {
    const probe = this.probe();
    if (!probe.screen.available) throw new Error(`GUI screen capture is unavailable: ${probe.screen.evidence.join("; ")}`);
    const dir = path.join(getHomeDir(), ".abos", "gui-captures"); fs.mkdirSync(dir, { recursive: true });
    const proposed = path.join(dir, `gui-${Date.now()}-${randomUUID()}.png`); const confined = confinePathToLocalHome(proposed, "gui capture");
    if (typeof confined === "object") throw new Error(confined.error);
    const result = this.runWindows({ op: "capture", path: confined }); const bounds = asBounds(result.bounds);
    if (!bounds) throw new Error("GUI capture provider returned invalid screen bounds");
    if (!fs.existsSync(confined)) throw new Error("GUI capture provider did not materialize the PNG");
    const signature = fs.readFileSync(confined).subarray(0, 8).toString("hex");
    if (signature !== "89504e470d0a1a0a") { fs.rmSync(confined, { force: true }); throw new Error("GUI capture output is not a PNG"); }
    return { path: confined, bounds, observedAt: new Date().toISOString() };
  }

  input(request: GuiInputRequest): Record<string, unknown> {
    const probe = this.probe();
    if (!probe.input.available) throw new Error(`GUI low-level input is unavailable: ${probe.input.evidence.join("; ")}`);
    const protocol: Record<string, unknown> = { op: "input", ...request };
    if (request.action === "pointer_move" || request.action === "pointer_click") {
      requireFiniteInteger(request.x, "x"); requireFiniteInteger(request.y, "y"); const bounds = probe.screen.bounds;
      if (!bounds || request.x < bounds.x || request.y < bounds.y || request.x >= bounds.x + bounds.width || request.y >= bounds.y + bounds.height) throw new Error(`GUI pointer coordinates are outside observed screen bounds: ${request.x},${request.y}`);
    }
    if (request.action === "type_text" && request.text.length > MAX_TEXT_LENGTH) throw new Error(`GUI input text exceeds ${MAX_TEXT_LENGTH} characters`);
    if (request.action === "key_press") {
      if (!request.key.trim() || request.key.length > 32) throw new Error("GUI key must be a non-empty supported key name");
      const modifiers = request.modifiers ?? []; if (new Set(modifiers).size !== modifiers.length) throw new Error("GUI key modifiers must be unique");
    }
    const result = this.runWindows(protocol); const { ok: _ok, ...output } = result;
    return { ...output, observedAt: new Date().toISOString() };
  }
}

let singleton: LocalGuiRuntime | null = null;
export function getLocalGuiRuntime(): LocalGuiRuntime { singleton ??= new LocalGuiRuntime(); return singleton; }
