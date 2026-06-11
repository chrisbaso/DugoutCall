import type { UserRole } from './types.js';

export interface RoomDiagnosticEvent {
  detail?: string;
  kind: string;
  recipientCount?: number;
  role?: UserRole;
  timestamp: number;
}

export interface RoomDiagnosticSnapshot {
  code: string;
  counters: Record<string, number>;
  recentEvents: RoomDiagnosticEvent[];
}

export class RoomDiagnostics {
  private static readonly maxTrackedRooms = 500;

  private readonly events = new Map<string, RoomDiagnosticEvent[]>();
  private readonly counters = new Map<string, Record<string, number>>();

  record(code: string, event: Omit<RoomDiagnosticEvent, 'timestamp'>): void {
    if (!this.events.has(code) && this.events.size >= RoomDiagnostics.maxTrackedRooms) {
      const oldest = this.events.keys().next().value;
      if (oldest !== undefined) this.drop(oldest);
    }

    const entry: RoomDiagnosticEvent = {
      ...event,
      timestamp: Date.now()
    };

    const recentEvents = this.events.get(code) ?? [];
    recentEvents.push(entry);
    this.events.set(code, recentEvents.slice(-40));

    const counters = this.counters.get(code) ?? {};
    counters[event.kind] = (counters[event.kind] ?? 0) + 1;
    this.counters.set(code, counters);
  }

  drop(code: string): void {
    this.events.delete(code);
    this.counters.delete(code);
  }

  snapshot(code: string): RoomDiagnosticSnapshot {
    return {
      code,
      counters: this.counters.get(code) ?? {},
      recentEvents: this.events.get(code) ?? []
    };
  }
}
