from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one anchor, found {count}: {old[:160]!r}")
    p.write_text(text.replace(old, new, 1), encoding="utf-8")


# v5: one canonical Windows shell is selected before readiness probing and is
# then reused by exec/start. Evidence publishes the actual selected route.
replace_once(
    "src/platform/local-computer-runtime.ts",
    '''            process.platform === "win32"
              ? "windows managed-process shell=normalized-git-usr-bash; root=stable-node-wrapper; termination request=taskkill-tree; observed root state is outcome authority"
              : "posix managed-process root=detached-process-group",
''',
    '''            process.platform === "win32"
              ? `windows managed-process shell=${shell}; root=stable-node-wrapper; termination request=taskkill-tree; observed root state is outcome authority`
              : "posix managed-process root=detached-process-group",
''',
)

replace_once(
    "src/platform/local-computer-runtime.ts",
    '''    const id = `process_${this.idFactory()}`;
    const managedShell = this.resolveManagedShell(shell);
    const [executable, args] = process.platform === "win32"
      ? [process.execPath, ["-e", WINDOWS_PROCESS_WRAPPER_SOURCE, managedShell, command]]
      : [managedShell, ["-lc", command]];
''',
    '''    const id = `process_${this.idFactory()}`;
    const [executable, args] = process.platform === "win32"
      ? [process.execPath, ["-e", WINDOWS_PROCESS_WRAPPER_SOURCE, shell, command]]
      : [shell, ["-lc", command]];
''',
)

replace_once(
    "src/platform/local-computer-runtime.ts",
    '''    this.cachedGitBash = candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
    return this.cachedGitBash;
''',
    '''    const canonicalCandidates = [...new Set(candidates.flatMap((candidate) => {
      const normalized = path.normalize(candidate);
      const managed = this.resolveManagedShell(normalized);
      return managed === normalized ? [normalized] : [managed, normalized];
    }))];
    this.cachedGitBash = canonicalCandidates.find((candidate) => fs.existsSync(candidate)) ?? null;
    return this.cachedGitBash;
''',
)

replace_once(
    "src/__tests__/p016-local-computer-runtime.test.ts",
    '''  it("starts, observes and waits for a managed process", async () => {
''',
    '''  if (process.platform === "win32") {
    it("publishes the canonical Git Bash runtime actually used for managed execution", () => {
      const probe = new LocalComputerRuntime().probe();
      expect(probe.available).toBe(true);
      expect(probe.shell).toBeTruthy();
      const normalized = probe.shell!.replace(/\\\\/g, "/").toLowerCase();
      if (normalized.includes("/git/")) {
        expect(normalized).toContain("/git/usr/bin/bash.exe");
      }
      expect(probe.evidence.join(" ")).toContain(`shell=${probe.shell}`);
    });
  }

  it("starts, observes and waits for a managed process", async () => {
''',
)

# v6: taskkill exit status is not lifecycle authority, but an observed running
# stable root after the first bounded observation is material evidence that the
# termination did not converge. Retry the same provider-native tree operation
# once and remain truthful if the second observation is still non-terminal.
replace_once(
    "src/platform/local-computer-runtime.ts",
    '''    entry.cancelRequested = true;
    this.terminateProcessTree(entry, "cancel");
    await this.observeTermination(entry);
    return this.snapshot(entry, entry.state === "running");
''',
    '''    entry.cancelRequested = true;
    await this.terminateAndObserveProcessTree(entry, "cancel");
    return this.snapshot(entry, entry.state === "running");
''',
)

replace_once(
    "src/platform/local-computer-runtime.ts",
    '''    entry.killRequested = true;
    this.terminateProcessTree(entry, "kill");
    await this.observeTermination(entry);
    return this.snapshot(entry, entry.state === "running");
''',
    '''    entry.killRequested = true;
    await this.terminateAndObserveProcessTree(entry, "kill");
    return this.snapshot(entry, entry.state === "running");
''',
)

replace_once(
    "src/platform/local-computer-runtime.ts",
    '''  private terminateProcessTree(entry: ManagedProcessEntry, mode: "cancel" | "kill"): void {
''',
    '''  private async terminateAndObserveProcessTree(
    entry: ManagedProcessEntry,
    mode: "cancel" | "kill",
  ): Promise<void> {
    this.terminateProcessTree(entry, mode);
    await this.observeTermination(entry);
    if (process.platform === "win32" && entry.state === "running") {
      this.terminateProcessTree(entry, mode);
      await this.observeTermination(entry);
    }
  }

  private terminateProcessTree(entry: ManagedProcessEntry, mode: "cancel" | "kill"): void {
''',
)
