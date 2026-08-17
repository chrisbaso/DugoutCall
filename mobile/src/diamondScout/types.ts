export const API_CONTRACT_VERSION = "2026-08-17" as const;

export type JsonRecord = Record<string, unknown>;

export type DeviceSession = {
  schema_version: typeof API_CONTRACT_VERSION;
  program: { name: string; season: string };
  capabilities: Record<string, boolean>;
  device: { id: string; label: string; platform: string; last_used_at?: string | null } | null;
  count_rules_version: string;
  enums: Record<string, string[]>;
};

export type PairingExchange = {
  schema_version: typeof API_CONTRACT_VERSION;
  credential: string;
  device: { id: string; label: string; platform: string; paired_at: string };
  program: { name: string; season: string };
  scopes: string[];
};

export type Opponent = { id: number; name: string; season?: string | null; game_count: number; hitter_count: number };
export type GameSummary = {
  id: number;
  opponent_id: number;
  opponent_name: string;
  game_date: string | null;
  home_away: string;
  location?: string | null;
  status: string;
};

export type GameLineupEntry = {
  slot: number;
  hitter_id: number;
  jersey?: string | null;
  name: string;
  bats?: string | null;
  notes?: string | null;
};

export type HitterCard = {
  schema_version: typeof API_CONTRACT_VERSION;
  hitter: { id: number; display_name: string; bats?: string | null };
  opponent: { id: number; name: string };
  tier: { key: string; label?: string; fallback_text?: string | null };
  attack_tags?: string[];
  chips?: Array<{ text: string; kind?: string }>;
  plan?: { out_plan?: string | null; pitch_plan?: string | null; coach_note?: string | null };
  verdict?: string | null;
  confidence: { pa_sample: number; low_sample?: boolean; [key: string]: unknown };
  defense?: Record<string, unknown>;
  [key: string]: unknown;
};

export type CurrentHitter = {
  schema_version: typeof API_CONTRACT_VERSION;
  game_id: number;
  lineup_slot: number;
  plate_appearance_key: string;
  hitter_id: number;
  pitcher_id: number | null;
  pa_started: boolean;
  pitch_sequence: number;
  last_event_sequence: number;
  count: { balls: number; strikes: number; label: string; server_authoritative: true };
  card: HitterCard;
  on_deck: { slot: number; hitter_id: number; display_name: string };
};

export type GameDetail = {
  schema_version: typeof API_CONTRACT_VERSION;
  game: GameSummary & { client_game_id?: string | null; notes?: string | null };
  lineup: GameLineupEntry[];
  charting: { status: string; source?: string | null };
  event_summary: { accepted_events: number; plate_appearances: number; last_event_id: string | null; last_sequence: number };
};

export type LineupSummary = {
  schema_version: typeof API_CONTRACT_VERSION;
  game_id: number;
  opponent_id: number;
  summaries: Array<{
    slot: number;
    hitter: { id: number; display_name: string; jersey?: string | null; bats?: string | null };
    verdict?: string | null;
    attack_tags: string[];
    confidence?: Record<string, unknown>;
    [key: string]: unknown;
  }>;
};

export type DiamondEvent = {
  event_id: string;
  sequence: number;
  type: string;
  pa_key: string;
  [key: string]: unknown;
};

export type EventPostResult = { accepted: number; rejected: Array<{ event_id: string; index: number; reason: string }> };

export const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isString = (value: unknown): value is string => typeof value === "string";
const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

export function isPairingExchange(value: unknown): value is PairingExchange {
  if (!isRecord(value) || value.schema_version !== API_CONTRACT_VERSION || !isString(value.credential)) return false;
  if (!isRecord(value.device) || !isString(value.device.id) || !isString(value.device.label)) return false;
  return isRecord(value.program) && isString(value.program.name) && Array.isArray(value.scopes);
}

export function isDeviceSession(value: unknown): value is DeviceSession {
  return Boolean(
    isRecord(value) &&
      value.schema_version === API_CONTRACT_VERSION &&
      isRecord(value.program) &&
      isString(value.program.name) &&
      isRecord(value.capabilities) &&
      isRecord(value.enums)
  );
}

export function isGamesResponse(value: unknown): value is { schema_version: string; games: GameSummary[] } {
  return Boolean(
    isRecord(value) &&
      value.schema_version === API_CONTRACT_VERSION &&
      Array.isArray(value.games) &&
      value.games.every((game) => isRecord(game) && isNumber(game.id) && isNumber(game.opponent_id) && isString(game.opponent_name))
  );
}

export function isGameDetail(value: unknown): value is GameDetail {
  return Boolean(
    isRecord(value) &&
      value.schema_version === API_CONTRACT_VERSION &&
      isRecord(value.game) &&
      isNumber(value.game.id) &&
      Array.isArray(value.lineup) &&
      isRecord(value.charting) &&
      isRecord(value.event_summary)
  );
}

export function isCurrentHitter(value: unknown): value is CurrentHitter {
  return Boolean(
    isRecord(value) &&
      value.schema_version === API_CONTRACT_VERSION &&
      isNumber(value.game_id) &&
      isNumber(value.lineup_slot) &&
      isString(value.plate_appearance_key) &&
      typeof value.pa_started === "boolean" &&
      isNumber(value.pitch_sequence) &&
      isNumber(value.last_event_sequence) &&
      isRecord(value.count) &&
      isNumber(value.count.balls) &&
      isNumber(value.count.strikes) &&
      value.count.server_authoritative === true &&
      isRecord(value.card) &&
      isRecord(value.on_deck)
  );
}

export function isLineupSummary(value: unknown): value is LineupSummary {
  return Boolean(
    isRecord(value) &&
      value.schema_version === API_CONTRACT_VERSION &&
      isNumber(value.game_id) &&
      isNumber(value.opponent_id) &&
      Array.isArray(value.summaries)
  );
}

export function isEventPostResult(value: unknown): value is EventPostResult {
  return Boolean(isRecord(value) && isNumber(value.accepted) && Array.isArray(value.rejected));
}
