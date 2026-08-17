import { describe, expect, it, vi } from "vitest";
import { OfflineEventQueue } from "../offlineQueue";
import { MemoryStore } from "./support";

const event = (id: string, sequence: number) => ({ event_id: id, sequence, type: "pitch", pa_key: "pa-1" });

describe("OfflineEventQueue", () => {
  it("persists before send, deduplicates stable IDs, and treats replay as synced", async () => {
    const store = new MemoryStore();
    const queue = new OfflineEventQueue(store, () => 1000);
    await queue.enqueue("device-a", 7, event("evt-1", 1));
    await queue.enqueue("device-a", 7, event("evt-1", 1));
    expect(await queue.list("device-a")).toHaveLength(1);
    const send = vi.fn(async () => ({ accepted: 0, rejected: [] }));
    await expect(queue.flush("device-a", send)).resolves.toEqual({ synced: 1, pending: 0, failed: 0 });
    expect(await queue.list("device-a")).toHaveLength(0);
  });

  it("preserves order and backs off after network failure", async () => {
    let now = 1000;
    const queue = new OfflineEventQueue(new MemoryStore(), () => now);
    await queue.enqueue("device-a", 7, event("evt-1", 1));
    await queue.enqueue("device-a", 7, event("evt-2", 2));
    const send = vi.fn(async () => { throw new Error("offline"); });
    await queue.flush("device-a", send);
    const queued = await queue.list("device-a");
    expect(queued.map((row) => row.event.event_id)).toEqual(["evt-1", "evt-2"]);
    expect(queued[0]?.attempts).toBe(1);
    expect(queued[0]?.nextAttemptAt).toBeGreaterThan(now);
    now = queued[0]!.nextAttemptAt;
    await queue.flush("device-a", async () => ({ accepted: 1, rejected: [] }));
    expect(await queue.list("device-a")).toHaveLength(0);
  });

  it("requires explicit confirmation before discard", async () => {
    const queue = new OfflineEventQueue(new MemoryStore());
    await queue.enqueue("device-a", 7, event("evt-1", 1));
    expect(await queue.discard("device-a", "evt-1", false)).toBe(false);
    expect(await queue.discard("device-a", "evt-1", true)).toBe(true);
  });
});
