
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright-core";
import { getHomeDir } from "../platform/home.js";
import { confinePathToLocalHome } from "../platform/path-confinement.js";
import { trustedHttpUrl } from "../network/url-trust.js";

export interface BrowserCandidate {
  label: string;
  launchOptions: Record<string, unknown>;
  evidence: string;
}

interface BrowserDownloadLike {
  suggestedFilename(): string;
  saveAs(filePath: string): Promise<void>;
}

interface BrowserLocatorLike {
  ariaSnapshot(options?: Record<string, unknown>): Promise<string>;
  click(options?: Record<string, unknown>): Promise<void>;
  fill(value: string, options?: Record<string, unknown>): Promise<void>;
  press(value: string, options?: Record<string, unknown>): Promise<void>;
  check(options?: Record<string, unknown>): Promise<void>;
  uncheck(options?: Record<string, unknown>): Promise<void>;
  selectOption(value: string | string[], options?: Record<string, unknown>): Promise<unknown>;
  setInputFiles(files: string[], options?: Record<string, unknown>): Promise<void>;
}

interface BrowserPageLike {
  goto(url: string, options?: Record<string, unknown>): Promise<unknown>;
  url(): string;
  title(): Promise<string>;
  locator(selector: string): BrowserLocatorLike;
  getByRole(role: string, options?: Record<string, unknown>): BrowserLocatorLike;
  getByLabel(text: string, options?: Record<string, unknown>): BrowserLocatorLike;
  getByText(text: string, options?: Record<string, unknown>): BrowserLocatorLike;
  getByPlaceholder(text: string, options?: Record<string, unknown>): BrowserLocatorLike;
  waitForEvent(event: "download", options?: Record<string, unknown>): Promise<BrowserDownloadLike>;
  setDefaultTimeout(timeout: number): void;
  setDefaultNavigationTimeout(timeout: number): void;
}

interface BrowserRequestLike {
  url(): string;
}

interface BrowserRouteLike {
  request(): BrowserRequestLike;
  continue(): Promise<void>;
  abort(errorCode?: string): Promise<void>;
}

interface BrowserContextLike {
  newPage(): Promise<BrowserPageLike>;
  route(url: string, handler: (route: BrowserRouteLike) => Promise<void>): Promise<void>;
  close(): Promise<void>;
}

interface BrowserLike {
  version(): string;
  newContext(options?: Record<string, unknown>): Promise<BrowserContextLike>;
  close(): Promise<void>;
}

export type BrowserLauncher = (
  launchOptions: Record<string, unknown>,
) => Promise<BrowserLike>;

export interface SemanticBrowserTarget {
  role?: string;
  name?: string;
  label?: string;
  text?: string;
  placeholder?: string;
  exact?: boolean;
}

export type SemanticBrowserAction =
  | "click"
  | "fill"
  | "press"
  | "check"
  | "uncheck"
  | "select";

export interface LocalBrowserProbe {
  available: boolean;
  observedAt: string;
  evidence: string[];
  target?: {
    label: string;
    launchOptions: Record<string, unknown>;
  };
  browserVersion?: string;
}

export interface BrowserSessionView {
  sessionId: string;
  url: string;
  title: string;
}

interface BrowserSession {
  id: string;
  browser: BrowserLike;
  context: BrowserContextLike;
  page: BrowserPageLike;
  createdAt: string;
}

export interface LocalBrowserRuntimeOptions {
  launch?: BrowserLauncher;
  candidates?: () => BrowserCandidate[];
  idFactory?: () => string;
  now?: () => Date;
  probeCacheMs?: number;
  downloadRoot?: string;
}

function executableInPath(names: string[]): Array<{ name: string; path: string }> {
  const pathValue = process.env.PATH ?? "";
  const directories = pathValue.split(path.delimiter).filter(Boolean);
  const extensions = process.platform === "win32"
    ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";")
    : [""];
  const found: Array<{ name: string; path: string }> = [];
  for (const name of names) {
    for (const directory of directories) {
      for (const extension of extensions) {
        const candidate = path.join(
          directory,
          process.platform === "win32" && !path.extname(name)
            ? `${name}${extension.toLowerCase()}`
            : name,
        );
        if (fs.existsSync(candidate)) {
          found.push({ name, path: candidate });
          break;
        }
      }
      if (found.some((entry) => entry.name === name)) break;
    }
  }
  return found;
}

function commonBrowserPaths(): string[] {
  if (process.platform === "darwin") {
    return [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    ];
  }
  if (process.platform === "win32") {
    const roots = [
      process.env.PROGRAMFILES,
      process.env["PROGRAMFILES(X86)"],
      process.env.LOCALAPPDATA,
    ].filter((value): value is string => Boolean(value));
    const relative = [
      ["Google", "Chrome", "Application", "chrome.exe"],
      ["Microsoft", "Edge", "Application", "msedge.exe"],
      ["BraveSoftware", "Brave-Browser", "Application", "brave.exe"],
    ];
    return roots.flatMap((root) => relative.map((parts) => path.join(root, ...parts)));
  }
  return [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/microsoft-edge",
    "/usr/bin/microsoft-edge-stable",
    "/usr/bin/brave-browser",
  ];
}

export function discoverLocalBrowserCandidates(): BrowserCandidate[] {
  const candidates: BrowserCandidate[] = [];
  const seen = new Set<string>();
  const addPath = (label: string, executablePath: string, evidence: string) => {
    const normalized = path.resolve(executablePath);
    if (seen.has(`path:${normalized}`) || !fs.existsSync(normalized)) return;
    seen.add(`path:${normalized}`);
    candidates.push({
      label,
      launchOptions: { executablePath: normalized, headless: true },
      evidence,
    });
  };

  const override = process.env.ABOS_BROWSER_EXECUTABLE_PATH?.trim();
  if (override) {
    addPath(
      "env:ABOS_BROWSER_EXECUTABLE_PATH",
      override,
      "Browser executable explicitly configured through ABOS_BROWSER_EXECUTABLE_PATH.",
    );
  }

  for (const entry of executableInPath([
    "google-chrome",
    "google-chrome-stable",
    "chromium",
    "chromium-browser",
    "microsoft-edge",
    "microsoft-edge-stable",
    "brave-browser",
    "chrome",
    "msedge",
  ])) {
    addPath(`path:${entry.name}`, entry.path, `Detected ${entry.name} on host PATH.`);
  }
  for (const browserPath of commonBrowserPaths()) {
    addPath(`host:${path.basename(browserPath)}`, browserPath, "Detected browser at a standard host installation path.");
  }

  // Playwright's branded channels are legitimate discovery paths for an
  // already-installed Chrome/Edge. They do not download or provision a browser.
  for (const channel of ["chrome", "msedge"]) {
    if (seen.has(`channel:${channel}`)) continue;
    seen.add(`channel:${channel}`);
    candidates.push({
      label: `channel:${channel}`,
      launchOptions: { channel, headless: true },
      evidence: `Probe Playwright channel ${channel}; channel launch uses an existing host installation only.`,
    });
  }

  return candidates;
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/g, " ").trim().slice(0, 240);
}

function assertTrustedBrowserRequestUrl(rawUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid browser request URL: ${rawUrl}`);
  }

  if (parsed.protocol === "http:" || parsed.protocol === "https:") {
    trustedHttpUrl(rawUrl, {
      allowHttpOnLoopback: true,
      rejectEmbeddedCredentials: true,
      stripHash: false,
    });
    return;
  }

  if (parsed.protocol === "data:" || parsed.protocol === "blob:" || parsed.protocol === "about:") {
    return;
  }

  throw new Error(`Unsupported browser request scheme: ${parsed.protocol}`);
}

function semanticLocator(page: BrowserPageLike, target: SemanticBrowserTarget): BrowserLocatorLike {
  const selectors = [target.role, target.label, target.text, target.placeholder].filter(
    (value) => typeof value === "string" && value.trim().length > 0,
  );
  if (selectors.length !== 1) {
    throw new Error(
      "Semantic browser target must specify exactly one of role, label, text, or placeholder.",
    );
  }
  const exact = target.exact ?? true;
  if (target.role?.trim()) {
    return page.getByRole(target.role.trim(), {
      ...(target.name?.trim() ? { name: target.name.trim() } : {}),
      exact,
    });
  }
  if (target.label?.trim()) return page.getByLabel(target.label.trim(), { exact });
  if (target.text?.trim()) return page.getByText(target.text.trim(), { exact });
  return page.getByPlaceholder(target.placeholder!.trim(), { exact });
}

export class LocalBrowserRuntime {
  private readonly sessions = new Map<string, BrowserSession>();
  private readonly launch: BrowserLauncher;
  private readonly candidateProvider: () => BrowserCandidate[];
  private readonly idFactory: () => string;
  private readonly now: () => Date;
  private readonly probeCacheMs: number;
  private readonly downloadRoot: string;
  private selectedCandidate: BrowserCandidate | null = null;
  private lastProbe: LocalBrowserProbe | null = null;
  private lastProbeAt = 0;

  constructor(options: LocalBrowserRuntimeOptions = {}) {
    this.launch = options.launch ?? (async (launchOptions) =>
      chromium.launch(launchOptions as Parameters<typeof chromium.launch>[0]) as unknown as BrowserLike);
    this.candidateProvider = options.candidates ?? discoverLocalBrowserCandidates;
    this.idFactory = options.idFactory ?? randomUUID;
    this.now = options.now ?? (() => new Date());
    this.probeCacheMs = options.probeCacheMs ?? 30_000;
    this.downloadRoot = options.downloadRoot ?? path.join(getHomeDir(), "Downloads", "ABOS");
  }

  async probe(options: { force?: boolean } = {}): Promise<LocalBrowserProbe> {
    const nowMs = this.now().getTime();
    if (
      !options.force &&
      this.lastProbe &&
      nowMs - this.lastProbeAt < this.probeCacheMs
    ) {
      return { ...this.lastProbe, evidence: [...this.lastProbe.evidence] };
    }

    const observedAt = this.now().toISOString();
    const evidence: string[] = [];
    this.selectedCandidate = null;

    const candidates = this.candidateProvider();
    if (candidates.length === 0) {
      const result: LocalBrowserProbe = {
        available: false,
        observedAt,
        evidence: ["No already-installed supported browser candidate was discovered on the local host."],
      };
      this.lastProbe = result;
      this.lastProbeAt = nowMs;
      return { ...result, evidence: [...result.evidence] };
    }

    for (const candidate of candidates) {
      let browser: BrowserLike | null = null;
      try {
        browser = await this.launch(candidate.launchOptions);
        const browserVersion = browser.version();
        await browser.close();
        browser = null;
        this.selectedCandidate = candidate;
        const result: LocalBrowserProbe = {
          available: true,
          observedAt,
          evidence: [
            candidate.evidence,
            `Browser launch probe succeeded via ${candidate.label}.`,
            `browserVersion=${browserVersion}`,
          ],
          target: {
            label: candidate.label,
            launchOptions: { ...candidate.launchOptions },
          },
          browserVersion,
        };
        this.lastProbe = result;
        this.lastProbeAt = nowMs;
        return { ...result, evidence: [...result.evidence] };
      } catch (error) {
        evidence.push(`Probe ${candidate.label} failed: ${safeError(error)}`);
        try {
          await browser?.close();
        } catch {
          // Probe failure remains the primary evidence.
        }
      }
    }

    const result: LocalBrowserProbe = {
      available: false,
      observedAt,
      evidence: [
        "Supported browser candidates were discovered/probed but none could be launched by Playwright.",
        ...evidence,
      ],
    };
    this.lastProbe = result;
    this.lastProbeAt = nowMs;
    return { ...result, evidence: [...result.evidence] };
  }

  private async launchForSession(): Promise<BrowserLike> {
    if (!this.selectedCandidate) {
      const probe = await this.probe();
      if (!probe.available || !this.selectedCandidate) {
        throw new Error(`BROWSER_UNAVAILABLE: ${probe.evidence.join(" | ")}`);
      }
    }

    try {
      return await this.launch(this.selectedCandidate.launchOptions);
    } catch (firstError) {
      // A once-valid host browser may have moved or become unavailable. Invalidate
      // the cached readiness claim and perform one fresh discriminating probe.
      this.selectedCandidate = null;
      this.lastProbe = null;
      const probe = await this.probe({ force: true });
      if (!probe.available || !probe.target) {
        throw new Error(
          `BROWSER_UNAVAILABLE_AFTER_REPROBE: ${safeError(firstError)} | ${probe.evidence.join(" | ")}`,
        );
      }
      return this.launch(probe.target.launchOptions);
    }
  }

  private session(sessionId: string): BrowserSession {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(
        `STALE_OR_UNKNOWN_BROWSER_SESSION: ${sessionId}. Browser handles are process-local and are invalid after close or restart.`,
      );
    }
    return session;
  }

  private async view(session: BrowserSession): Promise<BrowserSessionView> {
    return {
      sessionId: session.id,
      url: session.page.url(),
      title: await session.page.title(),
    };
  }

  async open(url?: string): Promise<BrowserSessionView> {
    const browser = await this.launchForSession();
    let context: BrowserContextLike | null = null;
    let registeredSessionId: string | null = null;
    try {
      context = await browser.newContext({ acceptDownloads: true });
      await context.route("**/*", async (route) => {
        try {
          assertTrustedBrowserRequestUrl(route.request().url());
          await route.continue();
        } catch {
          await route.abort("blockedbyclient");
        }
      });
      const page = await context.newPage();
      page.setDefaultTimeout(15_000);
      page.setDefaultNavigationTimeout(30_000);
      const id = `browser_${this.idFactory()}`;
      const session: BrowserSession = {
        id,
        browser,
        context,
        page,
        createdAt: this.now().toISOString(),
      };
      this.sessions.set(id, session);
      registeredSessionId = id;
      if (url?.trim()) {
        await this.navigate(id, url);
      }
      return await this.view(session);
    } catch (error) {
      if (registeredSessionId) this.sessions.delete(registeredSessionId);
      try {
        await context?.close();
      } catch {}
      try {
        await browser.close();
      } catch {}
      throw error;
    }
  }

  async navigate(sessionId: string, rawUrl: string): Promise<BrowserSessionView> {
    const session = this.session(sessionId);
    const url = trustedHttpUrl(rawUrl, {
      allowHttpOnLoopback: true,
      rejectEmbeddedCredentials: true,
      stripHash: false,
    });
    await session.page.goto(url, { waitUntil: "domcontentloaded" });
    return this.view(session);
  }

  async snapshot(sessionId: string): Promise<{ view: BrowserSessionView; snapshot: string }> {
    const session = this.session(sessionId);
    const snapshot = await session.page.locator("html").ariaSnapshot({
      mode: "ai",
      timeout: 10_000,
    });
    return { view: await this.view(session), snapshot };
  }

  async act(
    sessionId: string,
    action: SemanticBrowserAction,
    target: SemanticBrowserTarget,
    value?: string,
  ): Promise<BrowserSessionView> {
    const session = this.session(sessionId);
    const locator = semanticLocator(session.page, target);
    switch (action) {
      case "click":
        await locator.click();
        break;
      case "fill":
        if (typeof value !== "string") throw new Error("browser fill requires value");
        await locator.fill(value);
        break;
      case "press":
        if (typeof value !== "string" || !value.trim()) throw new Error("browser press requires value");
        await locator.press(value);
        break;
      case "check":
        await locator.check();
        break;
      case "uncheck":
        await locator.uncheck();
        break;
      case "select":
        if (typeof value !== "string") throw new Error("browser select requires value");
        await locator.selectOption(value);
        break;
      default: {
        const neverAction: never = action;
        throw new Error(`Unsupported semantic browser action: ${neverAction}`);
      }
    }
    return this.view(session);
  }

  async upload(
    sessionId: string,
    target: SemanticBrowserTarget,
    filePaths: string[],
  ): Promise<BrowserSessionView> {
    if (filePaths.length === 0) throw new Error("browser upload requires at least one path");
    const confined: string[] = [];
    for (const filePath of filePaths) {
      const resolved = confinePathToLocalHome(filePath, "browser_upload");
      if (typeof resolved === "object") throw new Error(resolved.error);
      const lexicalStat = fs.lstatSync(resolved);
      if (lexicalStat.isSymbolicLink()) {
        throw new Error(`browser_upload refuses symbolic links: ${resolved}`);
      }
      if (!lexicalStat.isFile()) throw new Error(`browser_upload requires a regular file: ${resolved}`);
      const realPath = fs.realpathSync(resolved);
      const realConfined = confinePathToLocalHome(realPath, "browser_upload_realpath");
      if (typeof realConfined === "object") throw new Error(realConfined.error);
      confined.push(realConfined);
    }
    const session = this.session(sessionId);
    await semanticLocator(session.page, target).setInputFiles(confined);
    return this.view(session);
  }

  async download(
    sessionId: string,
    target: SemanticBrowserTarget,
    requestedFilename?: string,
  ): Promise<{ view: BrowserSessionView; path: string; sizeBytes: number }> {
    const session = this.session(sessionId);
    const downloadPromise = session.page.waitForEvent("download", { timeout: 30_000 });
    await semanticLocator(session.page, target).click();
    const download = await downloadPromise;
    const rawName = requestedFilename?.trim() || download.suggestedFilename() || "download.bin";
    const basename = path.basename(rawName).replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 160);
    if (!basename || basename === "." || basename === "..") {
      throw new Error("browser_download filename is invalid");
    }
    fs.mkdirSync(this.downloadRoot, { recursive: true });
    const realOutputDir = fs.realpathSync(this.downloadRoot);
    const confinedOutputDir = confinePathToLocalHome(realOutputDir, "browser_download_root");
    if (typeof confinedOutputDir === "object") throw new Error(confinedOutputDir.error);
    const uniqueName = `${Date.now()}-${this.idFactory().slice(0, 12)}-${basename}`;
    const candidatePath = path.join(confinedOutputDir, uniqueName);
    if (fs.existsSync(candidatePath)) {
      throw new Error(`browser_download target already exists: ${candidatePath}`);
    }
    const confined = confinePathToLocalHome(candidatePath, "browser_download");
    if (typeof confined === "object") throw new Error(confined.error);
    await download.saveAs(confined);
    const stat = fs.statSync(confined);
    if (!stat.isFile()) throw new Error("browser_download did not materialize a regular file");
    return {
      view: await this.view(session),
      path: confined,
      sizeBytes: stat.size,
    };
  }

  async close(sessionId: string): Promise<void> {
    const session = this.session(sessionId);
    this.sessions.delete(sessionId);
    try {
      await session.context.close();
    } finally {
      await session.browser.close();
    }
  }

  async closeAll(): Promise<void> {
    const ids = [...this.sessions.keys()];
    for (const id of ids) {
      try {
        await this.close(id);
      } catch {
        this.sessions.delete(id);
      }
    }
  }

  sessionCount(): number {
    return this.sessions.size;
  }
}

let processLocalBrowserRuntime: LocalBrowserRuntime | null = null;

export function getLocalBrowserRuntime(): LocalBrowserRuntime {
  processLocalBrowserRuntime ??= new LocalBrowserRuntime();
  return processLocalBrowserRuntime;
}

export async function closeProcessLocalBrowserRuntime(): Promise<void> {
  if (!processLocalBrowserRuntime) return;
  await processLocalBrowserRuntime.closeAll();
  processLocalBrowserRuntime = null;
}
