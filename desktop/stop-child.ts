// Stopping a child process: SIGTERM, then SIGKILL if it ignores that. Kept
// free of Electron so it is unit-tested directly (tests/unit/stop-child.test.ts).

import type { ChildProcess } from "node:child_process";

const alive = (c: ChildProcess) => c.exitCode == null && c.signalCode == null;

// Fire-and-forget: ask the child to exit, and force it after graceMs.
export function terminateChild(child: ChildProcess, graceMs = 5000): void {
  child.kill("SIGTERM");
  const timer = setTimeout(() => {
    if (alive(child)) child.kill("SIGKILL");
  }, graceMs);
  timer.unref?.();
  child.once("exit", () => clearTimeout(timer));
}

// Resolves once the child has actually exited; rejects if that takes longer than hardMs.
export function terminateChildAndWait(child: ChildProcess, graceMs = 5000, hardMs = 10000): Promise<void> {
  if (!alive(child)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const hard = setTimeout(() => reject(new Error("child process did not exit")), hardMs);
    child.once("exit", () => {
      clearTimeout(hard);
      resolve();
    });
    terminateChild(child, graceMs);
  });
}
