import { describe, it, expect } from "vitest";
import { spawn } from "node:child_process";
import { terminateChildAndWait } from "../../desktop/stop-child";

describe("terminateChildAndWait", () => {
  it("force-kills a child that ignores SIGTERM", async () => {
    const child = spawn(process.execPath, ["-e", "process.on('SIGTERM',()=>{});console.log('up');setInterval(()=>{},1000)"], {
      stdio: ["ignore", "pipe", "inherit"],
    });
    await new Promise((r) => child.stdout!.once("data", r));
    const t0 = Date.now();
    await terminateChildAndWait(child, 300, 5000);
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(child.signalCode).toBe("SIGKILL");
  });

  it("resolves at once for a child that already exited", async () => {
    const child = spawn(process.execPath, ["-e", "0"]);
    await new Promise((r) => child.once("exit", r));
    await terminateChildAndWait(child);
  });

  it("rejects when the child never exits", async () => {
    const child = spawn(process.execPath, ["-e", "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"]);
    child.kill = (() => true) as typeof child.kill; // pretend the signal is lost
    await expect(terminateChildAndWait(child, 50, 200)).rejects.toThrow("did not exit");
    process.kill(child.pid!, "SIGKILL");
  });
});
