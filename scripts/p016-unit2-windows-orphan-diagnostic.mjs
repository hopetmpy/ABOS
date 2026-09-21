import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { LocalComputerRuntime } from "../dist/platform/local-computer-runtime.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function allProcesses() {
  const ps = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Json -Compress",
    ],
    { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  );
  if (ps.status !== 0) {
    throw new Error(`process inventory failed rc=${ps.status} stderr=${ps.stderr}`);
  }
  const raw = ps.stdout.replace(/^\uFEFF/, "").trim();
  if (!raw) return [];
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : [parsed];
}

function descendants(processes, rootPid) {
  const byParent = new Map();
  for (const proc of processes) {
    const parent = Number(proc.ParentProcessId);
    if (!byParent.has(parent)) byParent.set(parent, []);
    byParent.get(parent).push(proc);
  }
  const found = [];
  const queue = [Number(rootPid)];
  const seen = new Set(queue);
  while (queue.length > 0) {
    const parent = queue.shift();
    for (const child of byParent.get(parent) ?? []) {
      const pid = Number(child.ProcessId);
      if (seen.has(pid)) continue;
      seen.add(pid);
      found.push(child);
      queue.push(pid);
    }
  }
  return found;
}

function compact(proc) {
  return {
    pid: Number(proc.ProcessId),
    ppid: Number(proc.ParentProcessId),
    name: proc.Name,
    command: proc.CommandLine,
  };
}

function forceCleanup(pids) {
  for (const pid of [...new Set(pids.map(Number).filter(Number.isFinite))]) {
    spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { encoding: "utf8" });
    spawnSync("powershell.exe", ["-NoProfile", "-Command", `Stop-Process -Id ${pid} -Force -ErrorAction SilentlyContinue`], { encoding: "utf8" });
  }
}

let anomalies = 0;
for (const mode of ["kill", "cancel"]) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const runtime = new LocalComputerRuntime(() => `diag-${mode}-${attempt}`);
    const cwd = fs.mkdtempSync(path.join(os.homedir(), `.abos-orphan-${mode}-${attempt}-`));
    const markerName = `marker-${mode}-${attempt}.txt`;
    const marker = path.join(cwd, markerName);
    const started = await runtime.start(
      `node -e "setTimeout(()=>require('fs').writeFileSync('${markerName}','alive'),700);setTimeout(()=>{},5000)" >/dev/null 2>&1 & wait`,
      { cwd },
    );
    await sleep(150);

    const before = allProcesses();
    const beforeTree = descendants(before, started.pid).map(compact);
    const outcome = mode === "kill" ? await runtime.kill(started.id) : await runtime.cancel(started.id);
    await sleep(1_000);
    const after = allProcesses();
    const afterByPid = new Map(after.map((proc) => [Number(proc.ProcessId), proc]));
    const survivingKnown = beforeTree
      .map((proc) => afterByPid.get(proc.pid))
      .filter(Boolean)
      .map(compact);
    const relatedAfter = after
      .filter((proc) => String(proc.CommandLine ?? "").includes(markerName))
      .map(compact);
    const rootAfter = afterByPid.get(Number(started.pid));
    const markerExists = fs.existsSync(marker);

    const record = {
      mode,
      attempt,
      rootPid: started.pid,
      outcome: {
        state: outcome.state,
        waitTimedOut: outcome.waitTimedOut,
        exitCode: outcome.exitCode,
        signal: outcome.signal,
      },
      markerExists,
      beforeTree,
      rootAfter: rootAfter ? compact(rootAfter) : null,
      survivingKnown,
      relatedAfter,
    };
    console.log(`ABOS_ORPHAN_DIAG ${JSON.stringify(record)}`);

    if (outcome.waitTimedOut || outcome.state === "running" || markerExists || survivingKnown.length || relatedAfter.length) {
      anomalies += 1;
      console.log(`ABOS_ORPHAN_ANOMALY mode=${mode} attempt=${attempt}`);
    }

    forceCleanup([
      Number(started.pid),
      ...beforeTree.map((proc) => proc.pid),
      ...relatedAfter.map((proc) => proc.pid),
    ]);

    if (anomalies >= 3) break;
  }
  if (anomalies >= 3) break;
}

console.log(`ABOS_ORPHAN_DIAG_ANOMALIES=${anomalies}`);
