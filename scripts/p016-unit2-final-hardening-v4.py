from pathlib import Path

# Build on the already-audited v3 candidate, then apply only the Windows
# lifecycle corrections falsified by the repeated real-host diagnostics.
exec(Path("scripts/p016-unit2-final-hardening-v3.py").read_text(encoding="utf-8"), {})


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one anchor, found {count}: {old[:140]!r}")
    p.write_text(text.replace(old, new, 1), encoding="utf-8")


replace_once(
    "src/platform/local-computer-runtime.ts",
    '''    const id = `process_${this.idFactory()}`;
    const [executable, args] = process.platform === "win32"
      ? [process.execPath, ["-e", WINDOWS_PROCESS_WRAPPER_SOURCE, shell, command]]
      : [shell, ["-lc", command]];
''',
    '''    const id = `process_${this.idFactory()}`;
    const managedShell = this.resolveManagedShell(shell);
    const [executable, args] = process.platform === "win32"
      ? [process.execPath, ["-e", WINDOWS_PROCESS_WRAPPER_SOURCE, managedShell, command]]
      : [managedShell, ["-lc", command]];
''',
)

replace_once(
    "src/platform/local-computer-runtime.ts",
    '''            process.platform === "win32"
              ? "windows managed-process root=stable-node-wrapper; termination authority=taskkill-tree"
              : "posix managed-process root=detached-process-group",
''',
    '''            process.platform === "win32"
              ? "windows managed-process shell=normalized-git-usr-bash; root=stable-node-wrapper; termination request=taskkill-tree; observed root state is outcome authority"
              : "posix managed-process root=detached-process-group",
''',
)

replace_once(
    "src/platform/local-computer-runtime.ts",
    '''      } catch (error: any) {
        if (entry.state !== "running") return;
        throw new Error(
          `Process ${entry.id} ${mode} tree termination failed on Windows: ${error?.code ?? error?.status ?? "unknown"}`,
        );
      }
''',
    '''      } catch {
        // Git-for-Windows/MSYS can return 128/255 even after taskkill has
        // terminated the Windows root and prevented descendant work. The
        // request exit code is therefore not the lifecycle authority. The
        // caller immediately observes the stable managed root and reports
        // running/exited from that evidence instead of fabricating success.
        return;
      }
''',
)

replace_once(
    "src/platform/local-computer-runtime.ts",
    '''  private requireShell(): string {
''',
    '''  private resolveManagedShell(shell: string): string {
    if (process.platform !== "win32") return shell;
    const normalized = path.normalize(shell);
    const parent = path.basename(path.dirname(normalized)).toLowerCase();
    if (parent !== "bin") return normalized;

    const candidate = path.join(path.dirname(path.dirname(normalized)), "usr", "bin", "bash.exe");
    // Git\\bin\\bash.exe is a launcher that can interpose/re-parent another
    // bash.exe. Git\\usr\\bin\\bash.exe is the actual MSYS runtime root and
    // was the only variant that prevented descendant marker escape in the
    // repeated Windows host diagnostic. Preserve an explicit non-Git bash if
    // no matching runtime binary exists.
    return fs.existsSync(candidate) ? candidate : normalized;
  }

  private requireShell(): string {
''',
)

replace_once(
    "src/__tests__/p016-local-computer-runtime.test.ts",
    '''  it("treats a handle from another runtime as stale after restart", async () => {
''',
    '''  if (process.platform === "win32") {
    for (const mode of ["kill", "cancel"] as const) {
      it(`repeatedly contains Windows descendant processes when ${mode} is requested`, async () => {
        for (let attempt = 0; attempt < 4; attempt += 1) {
          const runtime = new LocalComputerRuntime(() => `tree-${mode}-${attempt}`);
          const cwd = tempHomeDir();
          const markerName = `descendant-marker-${mode}-${attempt}.txt`;
          const marker = path.join(cwd, markerName);
          const started = await runtime.start(
            `node -e "setTimeout(()=>require('fs').writeFileSync('${markerName}','alive'),700);setTimeout(()=>{},5000)" >/dev/null 2>&1 & wait`,
            { cwd },
          );
          await new Promise((resolve) => setTimeout(resolve, 150));
          const outcome = mode === "kill"
            ? await runtime.kill(started.id)
            : await runtime.cancel(started.id);
          await new Promise((resolve) => setTimeout(resolve, 1_000));
          expect(fs.existsSync(marker)).toBe(false);
          expect(outcome.waitTimedOut).toBe(false);
          expect(outcome.state).not.toBe("running");
        }
      });
    }
  }

  it("treats a handle from another runtime as stale after restart", async () => {
''',
)
