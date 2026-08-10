import { afterEach, beforeEach, vi } from "vitest";
import net from "node:net";
import tls from "node:tls";
import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import childProcess from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// Restricted-live tests use this shared setup and must exercise the guarded
// proposal paths without ever enabling real payment execution.
if (process.env.VITEST_RESTRICTED_LIVE === "true") {
  process.env.AUTOMATON_RESTRICTED_LIVE = "true";
  process.env.AUTOMATON_LIVE_DRY_RUN = "true";
}

const offline = process.env.AUTOMATON_OFFLINE_TEST === "true";
const denyFetch = vi.fn(async (input: string | URL | Request) => {
  throw new Error(`AUTOMATON_OFFLINE_TEST denied fetch: ${String(input)}`);
});

const deny = (kind: string) => { throw new Error(`AUTOMATON_OFFLINE_TEST denied ${kind}`); };
let testSequence = 0;

if (offline) {
  vi.stubGlobal("fetch", denyFetch);
  vi.spyOn(net, "connect").mockImplementation((() => deny("net.connect")) as any);
  vi.spyOn(net, "createConnection").mockImplementation((() => deny("net.createConnection")) as any);
  vi.spyOn(tls, "connect").mockImplementation((() => deny("tls.connect")) as any);
  vi.spyOn(dns, "lookup").mockImplementation((() => deny("dns.lookup")) as any);
  vi.spyOn(dns, "resolve").mockImplementation((() => deny("dns.resolve")) as any);
  vi.spyOn(http, "request").mockImplementation((() => deny("http.request")) as any);
  vi.spyOn(http, "get").mockImplementation((() => deny("http.get")) as any);
  vi.spyOn(https, "request").mockImplementation((() => deny("https.request")) as any);
  vi.spyOn(https, "get").mockImplementation((() => deny("https.get")) as any);
  vi.spyOn(childProcess, "exec").mockImplementation((() => deny("child_process.exec")) as any);
  vi.spyOn(childProcess, "execFile").mockImplementation((() => deny("child_process.execFile")) as any);
  vi.spyOn(childProcess, "execSync").mockImplementation((() => deny("child_process.execSync")) as any);
  vi.spyOn(childProcess, "execFileSync").mockImplementation((() => deny("child_process.execFileSync")) as any);
  vi.spyOn(childProcess, "fork").mockImplementation((() => deny("child_process.fork")) as any);
  vi.spyOn(childProcess, "spawn").mockImplementation((() => deny("child_process.spawn")) as any);
  vi.spyOn(childProcess, "spawnSync").mockImplementation((() => deny("child_process.spawnSync")) as any);
}

beforeEach(() => {
  if (offline) {
    vi.stubGlobal("fetch", denyFetch);
    testSequence += 1;
    const isolatedHome = path.join(process.cwd(), ".automaton-safe", "tests", `${process.pid}-${testSequence}`);
    fs.mkdirSync(isolatedHome, { recursive: true, mode: 0o700 });
    process.env.HOME = isolatedHome;
  }
});

afterEach(() => {
  if (offline) {
    vi.unstubAllGlobals();
    vi.stubGlobal("fetch", denyFetch);
  }
});
