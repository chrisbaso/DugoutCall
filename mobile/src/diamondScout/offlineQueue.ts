import type { DiamondEvent, EventPostResult } from "./types";
import type { LocalStore } from "./cache";

export type QueueStatus = "pending" | "failed";
export type QueuedDiamondEvent = {
  deviceId: string;
  gameId: number;
  event: DiamondEvent;
  status: QueueStatus;
  attempts: number;
  nextAttemptAt: number;
  lastError?: string;
};

const QUEUE_KEY = "diamond-event-queue:v1";

export class OfflineEventQueue {
  private flushing = false;

  constructor(private readonly store: LocalStore, private readonly now = Date.now) {}

  async list(deviceId?: string): Promise<QueuedDiamondEvent[]> {
    try {
      const parsed = JSON.parse((await this.store.getItem(QUEUE_KEY)) ?? "[]");
      const rows = Array.isArray(parsed) ? (parsed as QueuedDiamondEvent[]) : [];
      return deviceId ? rows.filter((row) => row.deviceId === deviceId) : rows;
    } catch {
      return [];
    }
  }

  async enqueue(deviceId: string, gameId: number, event: DiamondEvent): Promise<QueuedDiamondEvent> {
    if (!event.event_id) throw new Error("Queued Diamond events require a stable event ID.");
    const rows = await this.list();
    const duplicate = rows.find((row) => row.deviceId === deviceId && row.gameId === gameId && row.event.event_id === event.event_id);
    if (duplicate) return duplicate;
    const queued: QueuedDiamondEvent = { deviceId, gameId, event, status: "pending", attempts: 0, nextAttemptAt: this.now() };
    await this.save([...rows, queued]);
    return queued;
  }

  async flush(
    deviceId: string,
    send: (gameId: number, events: DiamondEvent[]) => Promise<EventPostResult>,
    force = false
  ): Promise<{ synced: number; pending: number; failed: number }> {
    if (this.flushing) return this.summary(deviceId);
    this.flushing = true;
    try {
      const rows = await this.list();
      const retained: QueuedDiamondEvent[] = [];
      let synced = 0;
      for (const row of rows) {
        if (row.deviceId !== deviceId || (!force && row.nextAttemptAt > this.now())) {
          retained.push(row);
          continue;
        }
        try {
          const result = await send(row.gameId, [row.event]);
          const rejection = result.rejected.find((item) => item.event_id === row.event.event_id);
          if (rejection) throw new Error(rejection.reason);
          synced += 1; // accepted 0 is a successful idempotent replay.
        } catch (error) {
          const attempts = row.attempts + 1;
          retained.push({
            ...row,
            status: attempts >= 5 ? "failed" : "pending",
            attempts,
            nextAttemptAt: this.now() + Math.min(60_000, 1_000 * 2 ** Math.min(attempts, 6)),
            lastError: error instanceof Error ? error.message.slice(0, 160) : "Sync failed"
          });
          // Preserve ordering for this device/game after the first failure.
          retained.push(...rows.slice(rows.indexOf(row) + 1));
          break;
        }
      }
      await this.save(retained);
      const summary = await this.summary(deviceId);
      return { synced, pending: summary.pending, failed: summary.failed };
    } finally {
      this.flushing = false;
    }
  }

  async discard(deviceId: string, eventId: string, confirmed: boolean): Promise<boolean> {
    if (!confirmed) return false;
    const rows = await this.list();
    const retained = rows.filter((row) => !(row.deviceId === deviceId && row.event.event_id === eventId));
    await this.save(retained);
    return retained.length !== rows.length;
  }

  async purgeAll(): Promise<void> {
    await this.store.removeItem(QUEUE_KEY);
  }

  private async summary(deviceId: string): Promise<{ synced: number; pending: number; failed: number }> {
    const rows = await this.list(deviceId);
    return {
      synced: 0,
      pending: rows.filter((row) => row.status === "pending").length,
      failed: rows.filter((row) => row.status === "failed").length
    };
  }

  private save(rows: QueuedDiamondEvent[]): Promise<void> {
    return this.store.setItem(QUEUE_KEY, JSON.stringify(rows));
  }
}
