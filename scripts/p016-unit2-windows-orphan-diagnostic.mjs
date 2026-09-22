import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const shell = "C:/Program Files/Git/usr/bin/bash.exe";

const powerShellJobSource = String.raw`
$ErrorActionPreference = 'Stop'
$source = @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;

public static class AbosWindowsJobRunner
{
    private const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000;
    private const int JobObjectExtendedLimitInformation = 9;
    private const uint CREATE_SUSPENDED = 0x00000004;
    private const uint STARTF_USESTDHANDLES = 0x00000100;
    private const uint INFINITE = 0xFFFFFFFF;
    private const int STD_INPUT_HANDLE = -10;
    private const int STD_OUTPUT_HANDLE = -11;
    private const int STD_ERROR_HANDLE = -12;

    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_BASIC_LIMIT_INFORMATION
    {
        public long PerProcessUserTimeLimit;
        public long PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize;
        public UIntPtr MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass;
        public uint SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct IO_COUNTERS
    {
        public ulong ReadOperationCount;
        public ulong WriteOperationCount;
        public ulong OtherOperationCount;
        public ulong ReadTransferCount;
        public ulong WriteTransferCount;
        public ulong OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
    {
        public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
        public IO_COUNTERS IoInfo;
        public UIntPtr ProcessMemoryLimit;
        public UIntPtr JobMemoryLimit;
        public UIntPtr PeakProcessMemoryUsed;
        public UIntPtr PeakJobMemoryUsed;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct STARTUPINFO
    {
        public int cb;
        public string lpReserved;
        public string lpDesktop;
        public string lpTitle;
        public int dwX;
        public int dwY;
        public int dwXSize;
        public int dwYSize;
        public int dwXCountChars;
        public int dwYCountChars;
        public int dwFillAttribute;
        public int dwFlags;
        public short wShowWindow;
        public short cbReserved2;
        public IntPtr lpReserved2;
        public IntPtr hStdInput;
        public IntPtr hStdOutput;
        public IntPtr hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct PROCESS_INFORMATION
    {
        public IntPtr hProcess;
        public IntPtr hThread;
        public uint dwProcessId;
        public uint dwThreadId;
    }

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern IntPtr CreateJobObject(IntPtr lpJobAttributes, string lpName);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetInformationJobObject(IntPtr hJob, int infoClass, IntPtr lpJobObjectInfo, uint cbJobObjectInfoLength);

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool CreateProcessW(
        string lpApplicationName,
        StringBuilder lpCommandLine,
        IntPtr lpProcessAttributes,
        IntPtr lpThreadAttributes,
        bool bInheritHandles,
        uint dwCreationFlags,
        IntPtr lpEnvironment,
        string lpCurrentDirectory,
        ref STARTUPINFO lpStartupInfo,
        out PROCESS_INFORMATION lpProcessInformation);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool AssignProcessToJobObject(IntPtr hJob, IntPtr hProcess);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint ResumeThread(IntPtr hThread);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint WaitForSingleObject(IntPtr hHandle, uint dwMilliseconds);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetExitCodeProcess(IntPtr hProcess, out uint lpExitCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool TerminateProcess(IntPtr hProcess, uint uExitCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr hObject);

    [DllImport("kernel32.dll")]
    private static extern IntPtr GetStdHandle(int nStdHandle);

    private static string QuoteArgument(string value)
    {
        if (value.Length == 0) return "\"\"";
        if (value.IndexOfAny(new[] { ' ', '\t', '\n', '\v', '"' }) < 0) return value;
        var output = new StringBuilder("\"");
        var slashes = 0;
        foreach (var ch in value)
        {
            if (ch == '\\')
            {
                slashes++;
                continue;
            }
            if (ch == '"')
            {
                output.Append('\\', slashes * 2 + 1);
                output.Append('"');
                slashes = 0;
                continue;
            }
            output.Append('\\', slashes);
            slashes = 0;
            output.Append(ch);
        }
        output.Append('\\', slashes * 2);
        output.Append('"');
        return output.ToString();
    }

    public static int Run(string shell, string command, string cwd, bool diagnosticReady)
    {
        IntPtr job = IntPtr.Zero;
        PROCESS_INFORMATION pi = new PROCESS_INFORMATION();
        try
        {
            job = CreateJobObject(IntPtr.Zero, null);
            if (job == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error(), "CreateJobObject failed");

            var limits = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            var length = Marshal.SizeOf(limits);
            var ptr = Marshal.AllocHGlobal(length);
            try
            {
                Marshal.StructureToPtr(limits, ptr, false);
                if (!SetInformationJobObject(job, JobObjectExtendedLimitInformation, ptr, (uint)length))
                    throw new Win32Exception(Marshal.GetLastWin32Error(), "SetInformationJobObject failed");
            }
            finally
            {
                Marshal.FreeHGlobal(ptr);
            }

            var startup = new STARTUPINFO();
            startup.cb = Marshal.SizeOf(startup);
            startup.dwFlags = (int)STARTF_USESTDHANDLES;
            startup.hStdInput = GetStdHandle(STD_INPUT_HANDLE);
            startup.hStdOutput = GetStdHandle(STD_OUTPUT_HANDLE);
            startup.hStdError = GetStdHandle(STD_ERROR_HANDLE);

            var commandLine = new StringBuilder(QuoteArgument(shell) + " -lc " + QuoteArgument(command));
            if (!CreateProcessW(shell, commandLine, IntPtr.Zero, IntPtr.Zero, true, CREATE_SUSPENDED, IntPtr.Zero, cwd, ref startup, out pi))
                throw new Win32Exception(Marshal.GetLastWin32Error(), "CreateProcessW failed");

            if (!AssignProcessToJobObject(job, pi.hProcess))
            {
                var error = Marshal.GetLastWin32Error();
                TerminateProcess(pi.hProcess, 91);
                throw new Win32Exception(error, "AssignProcessToJobObject failed");
            }

            if (diagnosticReady)
            {
                Console.Error.WriteLine("ABOS_JOB_READY pid=" + pi.dwProcessId);
                Console.Error.Flush();
            }

            if (ResumeThread(pi.hThread) == 0xFFFFFFFF)
                throw new Win32Exception(Marshal.GetLastWin32Error(), "ResumeThread failed");

            CloseHandle(pi.hThread);
            pi.hThread = IntPtr.Zero;

            WaitForSingleObject(pi.hProcess, INFINITE);
            uint exitCode;
            if (!GetExitCodeProcess(pi.hProcess, out exitCode))
                throw new Win32Exception(Marshal.GetLastWin32Error(), "GetExitCodeProcess failed");
            return unchecked((int)exitCode);
        }
        finally
        {
            if (pi.hThread != IntPtr.Zero) CloseHandle(pi.hThread);
            if (pi.hProcess != IntPtr.Zero) CloseHandle(pi.hProcess);
            if (job != IntPtr.Zero) CloseHandle(job);
        }
    }
}
'@
Add-Type -TypeDefinition $source -Language CSharp
$shell = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:ABOS_JOB_SHELL_B64))
$command = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:ABOS_JOB_COMMAND_B64))
$ready = $env:ABOS_JOB_DIAGNOSTIC_READY -eq '1'
[Environment]::SetEnvironmentVariable('ABOS_JOB_SHELL_B64', $null, [EnvironmentVariableTarget]::Process)
[Environment]::SetEnvironmentVariable('ABOS_JOB_COMMAND_B64', $null, [EnvironmentVariableTarget]::Process)
[Environment]::SetEnvironmentVariable('ABOS_JOB_DIAGNOSTIC_READY', $null, [EnvironmentVariableTarget]::Process)
$code = [AbosWindowsJobRunner]::Run($shell, $command, [Environment]::CurrentDirectory, $ready)
exit $code
`;

const encodedPowerShell = Buffer.from(powerShellJobSource, "utf16le").toString("base64");

function managed(command, cwd, diagnosticReady = false) {
  const env = {
    ...process.env,
    ABOS_JOB_SHELL_B64: Buffer.from(shell, "utf8").toString("base64"),
    ABOS_JOB_COMMAND_B64: Buffer.from(command, "utf8").toString("base64"),
    ABOS_JOB_DIAGNOSTIC_READY: diagnosticReady ? "1" : "0",
  };
  return spawn(
    "powershell.exe",
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encodedPowerShell],
    { cwd, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
  );
}

function waitClose(child, timeoutMs = 8_000) {
  return Promise.race([
    new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => resolve({ code, signal }));
    }),
    sleep(timeoutMs).then(() => { throw new Error(`wrapper ${child.pid} did not close within ${timeoutMs}ms`); }),
  ]);
}

function waitReady(child, timeoutMs = 8_000) {
  return new Promise((resolve, reject) => {
    let stderr = "";
    const timer = setTimeout(() => reject(new Error(`wrapper ${child.pid} did not publish ABOS_JOB_READY; stderr=${stderr}`)), timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
      const match = stderr.match(/ABOS_JOB_READY pid=(\d+)/);
      if (match) {
        clearTimeout(timer);
        resolve({ shellPid: Number(match[1]), stderr });
      }
    });
  });
}

function processesContaining(token) {
  const escaped = token.replace(/'/g, "''");
  const ps = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-Command", `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${escaped}*' } | Select-Object ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Json -Compress`],
    { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  );
  if (ps.status !== 0) throw new Error(`process inventory failed rc=${ps.status} stderr=${ps.stderr}`);
  const raw = ps.stdout.replace(/^\uFEFF/, "").trim();
  if (!raw) return [];
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : [parsed];
}

function cleanup(procs) {
  for (const proc of procs) {
    const pid = Number(proc.ProcessId);
    if (!Number.isFinite(pid) || pid <= 0) continue;
    spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { encoding: "utf8" });
  }
}

if (!fs.existsSync(shell)) throw new Error(`canonical Git Bash missing: ${shell}`);

const probeDir = fs.mkdtempSync(path.join(os.homedir(), ".abos-job-probe-"));
const probe = managed("printf 'ABOS_JOB_STDOUT\\n'; printf 'ABOS_JOB_STDERR\\n' >&2", probeDir);
let probeOut = "";
let probeErr = "";
probe.stdout.on("data", (chunk) => { probeOut += chunk.toString("utf8"); });
probe.stderr.on("data", (chunk) => { probeErr += chunk.toString("utf8"); });
const probeResult = await waitClose(probe);
console.log(`ABOS_JOB_OUTPUT_PROBE ${JSON.stringify({ probeResult, probeOut, probeErr })}`);
if (probeResult.code !== 0 || !probeOut.includes("ABOS_JOB_STDOUT") || !probeErr.includes("ABOS_JOB_STDERR")) {
  throw new Error("job wrapper did not preserve managed stdout/stderr");
}

for (let attempt = 0; attempt < 16; attempt += 1) {
  const cwd = fs.mkdtempSync(path.join(os.homedir(), `.abos-job-kill-${attempt}-`));
  const markerName = `abos-job-kill-${attempt}-${Date.now()}.txt`;
  const marker = path.join(cwd, markerName);
  const markerPosix = marker.replace(/\\/g, "/");
  const command = `node -e "setTimeout(()=>require('fs').writeFileSync('${markerPosix}','alive'),900);setTimeout(()=>{},5000)" >/dev/null 2>&1 & wait`;
  const child = managed(command, cwd, true);
  const ready = await waitReady(child);
  const killed = child.kill();
  const closed = await waitClose(child, 5_000);
  await sleep(1_100);
  const related = processesContaining(markerName);
  const record = { attempt, wrapperPid: child.pid, shellPid: ready.shellPid, killed, closed, marker: fs.existsSync(marker), related };
  console.log(`ABOS_JOB_KILL ${JSON.stringify(record)}`);
  if (!killed || fs.existsSync(marker) || related.length > 0) {
    cleanup(related);
    throw new Error(`job-object kill containment failed at attempt ${attempt}`);
  }
}

for (let attempt = 0; attempt < 8; attempt += 1) {
  const cwd = fs.mkdtempSync(path.join(os.homedir(), `.abos-job-natural-${attempt}-`));
  const markerName = `abos-job-natural-${attempt}-${Date.now()}.txt`;
  const marker = path.join(cwd, markerName);
  const markerPosix = marker.replace(/\\/g, "/");
  const command = `node -e "setTimeout(()=>require('fs').writeFileSync('${markerPosix}','alive'),900);setTimeout(()=>{},5000)" >/dev/null 2>&1 & exit 0`;
  const child = managed(command, cwd, true);
  const ready = await waitReady(child);
  const closed = await waitClose(child, 5_000);
  await sleep(1_100);
  const related = processesContaining(markerName);
  const record = { attempt, wrapperPid: child.pid, shellPid: ready.shellPid, closed, marker: fs.existsSync(marker), related };
  console.log(`ABOS_JOB_NATURAL ${JSON.stringify(record)}`);
  if (closed.code !== 0 || fs.existsSync(marker) || related.length > 0) {
    cleanup(related);
    throw new Error(`job-object natural-close containment failed at attempt ${attempt}`);
  }
}

console.log("ABOS_WINDOWS_JOB_OBJECT_DIAGNOSTIC=PASS");
