import type { CurrentHitter, DiamondEvent } from "./types";

export type QuickOutcome =
  | "ball"
  | "called_strike"
  | "swinging_strike"
  | "foul"
  | "foul_bunt"
  | "hbp"
  | "in_play";

export type InPlayDetail = {
  paResult: "single" | "double" | "triple" | "home_run" | "field_out" | "fielders_choice" | "error" | "sac_fly" | "sac_bunt";
  battedBall: "GB" | "LD" | "FB" | "PU" | "Bunt";
  fieldLocation: string;
  fieldDepth?: string;
};

export class GameEventFactory {
  private sequence: number;
  private pitchSequence: number;
  private startedPaKey: string | null = null;

  constructor(private current: CurrentHitter, private readonly id: () => string) {
    this.sequence = current.last_event_sequence;
    this.pitchSequence = current.pitch_sequence;
    this.startedPaKey = current.pa_started ? current.plate_appearance_key : null;
  }

  beginPlateAppearance(): DiamondEvent | null {
    if (this.startedPaKey === this.current.plate_appearance_key) return null;
    this.startedPaKey = this.current.plate_appearance_key;
    this.pitchSequence = 0;
    return {
      event_id: this.id(),
      sequence: ++this.sequence,
      type: "pa_start",
      pa_key: this.current.plate_appearance_key,
      lineup_slot: this.current.lineup_slot,
      batter_id: this.current.hitter_id,
      pitcher_id: this.current.pitcher_id
    };
  }

  confirmedPitch(outcome: QuickOutcome, detail?: InPlayDetail, callCorrelationId?: string): DiamondEvent {
    if (outcome === "in_play" && (!detail?.paResult || !detail.battedBall || !detail.fieldLocation)) {
      throw new Error("In-play outcomes require result, batted-ball type, and field location.");
    }
    const event: DiamondEvent = {
      event_id: this.id(),
      sequence: ++this.sequence,
      type: "pitch",
      pa_key: this.current.plate_appearance_key,
      pitch_sequence: ++this.pitchSequence,
      count_before: this.current.count.label,
      result: { kind: outcome, ...(detail ? { pa_result: detail.paResult } : {}) },
      ...(detail ? { batted_ball: detail.battedBall, field_location: detail.fieldLocation, field_depth: detail.fieldDepth } : {}),
      ...(callCorrelationId ? { notes: `dugoutcall_call:${callCorrelationId}` } : {})
    };
    return event;
  }

  replaceCurrent(current: CurrentHitter): void {
    this.current = current;
    if (current.plate_appearance_key !== this.startedPaKey) {
      this.startedPaKey = null;
      this.pitchSequence = 0;
    }
  }
}
