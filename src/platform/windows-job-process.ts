import { spawn, spawnSync, type ChildProcess } from "node:child_process";

const WINDOWS_JOB_READY_PREFIX = "ABOS_JOB_READY pid=";
const WINDOWS_JOB_BOOTSTRAP_GRACE_MS = 20_000;

const WINDOWS_JOB_OWNER_SOURCE = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
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
    private const uint WAIT_OBJECT_0 = 0x00000000;
    private const uint WAIT_TIMEOUT = 0x00000102;
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

    public static int Run(string shell, string command, string cwd, uint timeoutMs, bool publishReady)
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

            if (publishReady)
            {
                Console.Error.WriteLine("ABOS_JOB_READY pid=" + pi.dwProcessId);
                Console.Error.Flush();
            }

            if (ResumeThread(pi.hThread) == 0xFFFFFFFF)
                throw new Win32Exception(Marshal.GetLastWin32Error(), "ResumeThread failed");

            CloseHandle(pi.hThread);
            pi.hThread = IntPtr.Zero;

            var waitResult = WaitForSingleObject(pi.hProcess, timeoutMs == 0 ? INFINITE : timeoutMs);
            if (waitResult == WAIT_TIMEOUT) return 124;
            if (waitResult != WAIT_OBJECT_0)
                throw new Win32Exception(Marshal.GetLastWin32Error(), "WaitForSingleObject failed");

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
$protocol = [Console]::In.ReadToEnd() | ConvertFrom-Json
$code = [AbosWindowsJobRunner]::Run(
  [string]$protocol.shell,
  [string]$protocol.command,
  [string]$protocol.cwd,
  [uint32]$protocol.timeoutMs,
  [bool]$protocol.publishReady
)
exit $code
`;

const ENCODED_WINDOWS_JOB_OWNER_SOURCE = Buffer.from(WINDOWS_JOB_OWNER_SOURCE, "utf16le").toString("base64");
const POWERSHELL_ARGS = [
  "-NoLogo",
  "-NoProfile",
  "-NonInteractive",
  "-ExecutionPolicy",
  "Bypass",
  "-EncodedCommand",
  ENCODED_WINDOWS_JOB_OWNER_SOURCE,
];

function protocol(options: {
  shell: string;
  command: string;
  cwd: string;
  timeoutMs: number;
  publishReady: boolean;
}): string {
  return JSON.stringify({
    shell: options.shell,
    command: options.command,
    cwd: options.cwd,
    timeoutMs: Math.max(0, Math.min(options.timeoutMs, 0xffffffff)),
    publishReady: options.publishReady,
  });
}

export interface WindowsJobSyncResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  providerTimedOut: boolean;
}

export function runWindowsJobProcessSync(options: {
  shell: string;
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
}): WindowsJobSyncResult {
  const commandTimeout = Math.max(1, options.timeoutMs);
  const result = spawnSync("powershell.exe", POWERSHELL_ARGS, {
    cwd: options.cwd,
    env: options.env,
    input: protocol({ ...options, timeoutMs: commandTimeout, publishReady: false }),
    windowsHide: true,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    timeout: commandTimeout + WINDOWS_JOB_BOOTSTRAP_GRACE_MS,
  });

  const providerTimedOut = Boolean(result.error && (result.error as NodeJS.ErrnoException).code === "ETIMEDOUT");
  return {
    stdout: result.stdout || "",
    stderr: result.stderr || result.error?.message || "",
    exitCode: providerTimedOut ? 124 : typeof result.status === "number" ? result.status : 1,
    providerTimedOut,
  };
}

export interface WindowsJobProcess {
  child: ChildProcess;
  ready: Promise<number>;
}

export function spawnWindowsJobProcess(options: {
  shell: string;
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  onStderr: (chunk: Buffer) => void;
}): WindowsJobProcess {
  const child = spawn("powershell.exe", POWERSHELL_ARGS, {
    cwd: options.cwd,
    env: options.env,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdin?.end(protocol({ ...options, timeoutMs: 0, publishReady: true }));

  let settled = false;
  let pending = "";
  let resolveReady!: (pid: number) => void;
  let rejectReady!: (error: Error) => void;
  const ready = new Promise<number>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  const consume = (flush: boolean): void => {
    while (true) {
      const newline = pending.indexOf("\n");
      if (newline < 0) break;
      const rawLine = pending.slice(0, newline + 1);
      pending = pending.slice(newline + 1);
      const line = rawLine.replace(/\r?\n$/, "");
      const match = !settled ? line.match(/^ABOS_JOB_READY pid=(\d+)$/) : null;
      if (match) {
        settled = true;
        resolveReady(Number(match[1]));
      } else {
        options.onStderr(Buffer.from(rawLine, "utf8"));
      }
    }
    if (flush && pending) {
      options.onStderr(Buffer.from(pending, "utf8"));
      pending = "";
    }
  };

  child.stderr?.on("data", (chunk: Buffer | string) => {
    pending += chunk.toString();
    consume(false);
  });
  child.stderr?.once("end", () => consume(true));
  child.once("error", (error) => {
    if (!settled) {
      settled = true;
      rejectReady(error);
    }
  });
  child.once("close", (code, signal) => {
    consume(true);
    if (!settled) {
      settled = true;
      rejectReady(new Error(`Windows Job Object owner exited before readiness (code=${code ?? "null"}, signal=${signal ?? "null"})`));
    }
  });

  return { child, ready };
}

export const WINDOWS_JOB_READY_TIMEOUT_MS = 20_000;
