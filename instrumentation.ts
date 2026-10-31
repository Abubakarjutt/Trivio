// Next compiles this file for both the Node and edge runtimes. Node-only work
// lives in instrumentation-node.ts and must stay behind the positive
// NEXT_RUNTIME === "nodejs" check: webpack drops this branch from the edge
// build, but it would still follow imports placed after an early return.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await (await import("./instrumentation-node")).registerNode();
  }
}
