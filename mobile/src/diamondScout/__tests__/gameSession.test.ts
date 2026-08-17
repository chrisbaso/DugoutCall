import { describe, expect, it } from "vitest";
import { GameEventFactory } from "../gameSession";
import type { CurrentHitter } from "../types";

const current = (): CurrentHitter => ({
  schema_version: "2026-08-17",
  game_id: 7,
  lineup_slot: 1,
  plate_appearance_key: "g7-pa-1",
  hitter_id: 11,
  pitcher_id: 22,
  pa_started: false,
  pitch_sequence: 0,
  last_event_sequence: 0,
  count: { balls: 0, strikes: 0, label: "0-0", server_authoritative: true },
  card: {
    schema_version: "2026-08-17",
    hitter: { id: 11, display_name: "#4 Kelly" },
    opponent: { id: 3, name: "Hornets" },
    tier: { key: "low" },
    attack_tags: [],
    confidence: { pa_sample: 0 }
  },
  on_deck: { slot: 2, hitter_id: 12, display_name: "#8 Strey" }
});

describe("GameEventFactory", () => {
  it("creates one PA start and only creates pitches after explicit confirmation", () => {
    let id = 0;
    const factory = new GameEventFactory(current(), () => `evt-${++id}`);
    expect(factory.beginPlateAppearance()).toMatchObject({ type: "pa_start", event_id: "evt-1" });
    expect(factory.beginPlateAppearance()).toBeNull();
    expect(factory.confirmedPitch("called_strike", undefined, "call-99")).toMatchObject({
      type: "pitch",
      event_id: "evt-2",
      pitch_sequence: 1,
      count_before: "0-0",
      notes: "dugoutcall_call:call-99"
    });
  });

  it("rejects incomplete in-play evidence", () => {
    const factory = new GameEventFactory(current(), () => "evt");
    expect(() => factory.confirmedPitch("in_play")).toThrow(/require result/i);
  });
});
