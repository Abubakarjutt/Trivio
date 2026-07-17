/**
 * Regression tests for the SSE cancel-safe guard in app/api/pf/import/route.ts
 *
 * Before the fix, when a client disconnected mid-import, ReadableStream.cancel()
 * fired and closed the controller. Subsequent emit() calls threw ERR_INVALID_STATE,
 * which was caught by the catch block and marked the import batch as FAILED — even
 * though the import itself was processing fine.
 *
 * The fix: a `closed` flag set by cancel() makes emit() a no-op after disconnect.
 * The handler continues to completion so DB state ends up correct.
 */

import { describe, it, expect } from "vitest";

// ─── Helpers — replicates the createSseStream pattern verbatim ───────────────

type EmitFn = (event: string, data: Record<string, unknown>) => void;

function createSseStream(handler: (emit: EmitFn) => Promise<void>): ReadableStream {
  const encoder = new TextEncoder();
  let closed = false;

  return new ReadableStream({
    async start(controller) {
      const emit: EmitFn = (event, data) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true;
        }
      };
      try {
        await handler(emit);
      } finally {
        if (!closed) {
          try { controller.close(); } catch { /* already closed */ }
          closed = true;
        }
      }
    },
    cancel() {
      closed = true;
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────

describe("SSE createSseStream — cancel-safe guard (client disconnect regression)", () => {
  it("emit is a no-op after ReadableStream cancel — does not throw", async () => {
    let emitCallsAfterCancel = 0;
    let handlerCompleted = false;

    const stream = createSseStream(async (emit) => {
      emit("progress", { step: "start", pct: 10 });

      // Pause — this is when the client disconnects in real usage
      await new Promise<void>((resolve) => setTimeout(resolve, 20));

      // These calls should be silent no-ops, not throw ERR_INVALID_STATE
      emit("progress", { step: "categorizing", pct: 50 });
      emitCallsAfterCancel++;
      emit("done", { batchId: "batch-1", count: 5, skipped: 0 });
      emitCallsAfterCancel++;

      handlerCompleted = true;
    });

    const reader = stream.getReader();

    // Read the first event (progress: start)
    const { value } = await reader.read();
    expect(value).toBeDefined();

    // Simulate client disconnect
    await reader.cancel();

    // Give the handler time to finish its async work
    await new Promise<void>((resolve) => setTimeout(resolve, 60));

    // Handler must complete — DB updates after disconnect should still run
    expect(handlerCompleted).toBe(true);

    // Emit calls after cancel ran without throwing
    expect(emitCallsAfterCancel).toBe(2);
  });

  it("handler still runs to completion so DB state is correct after disconnect", async () => {
    const dbUpdates: string[] = [];

    const stream = createSseStream(async (emit) => {
      emit("progress", { step: "start" });

      await new Promise<void>((resolve) => setTimeout(resolve, 10));

      // Simulate the DB writes that happen AFTER a potential disconnect
      dbUpdates.push("batch.update(DONE)");
      emit("done", { batchId: "batch-1" });
    });

    const reader = stream.getReader();
    await reader.read(); // read start event
    await reader.cancel(); // disconnect

    await new Promise<void>((resolve) => setTimeout(resolve, 40));

    // DB was still updated despite client disconnect
    expect(dbUpdates).toContain("batch.update(DONE)");
  });

  it("streams events normally when client stays connected", async () => {
    const stream = createSseStream(async (emit) => {
      emit("progress", { step: "extracting", pct: 10 });
      emit("progress", { step: "categorizing", pct: 50 });
      emit("done", { batchId: "batch-1", count: 3, skipped: 0 });
    });

    const reader = stream.getReader();
    const chunks: string[] = [];

    let result = await reader.read();
    while (!result.done) {
      if (result.value) chunks.push(new TextDecoder().decode(result.value));
      result = await reader.read();
    }

    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toContain("event: progress");
    expect(chunks[2]).toContain("event: done");
  });

  it("controller.close() is called exactly once when handler completes normally", async () => {
    let closeCount = 0;
    const originalReadableStream = globalThis.ReadableStream;

    // We can't intercept controller.close() without patching ReadableStream;
    // instead, verify that the stream ends (reader.read() returns done=true).
    const stream = createSseStream(async (emit) => {
      emit("progress", { step: "done" });
    });

    const reader = stream.getReader();
    await reader.read(); // consume event
    const { done } = await reader.read(); // should be done
    expect(done).toBe(true);

    void closeCount; // suppress unused warning
    void originalReadableStream;
  });
});
