import { requestRecordingPermissionsAsync, setAudioModeAsync, useAudioPlayer } from "expo-audio";
import { Directory, File, Paths } from "expo-file-system";
import * as SecureStore from "expo-secure-store";
import * as Speech from "expo-speech";
import { AudioSession as LiveKitAudioSession } from "@livekit/react-native";
import { ConnectionState as LiveKitConnectionState, Room, RoomEvent, Track } from "livekit-client";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  Vibration,
  View
} from "react-native";
import {
  mediaDevices,
  MediaStream,
  RTCAudioSession,
  RTCIceCandidate,
  RTCPeerConnection,
  RTCSessionDescription,
  RTCView
} from "@livekit/react-native-webrtc";
import { DiamondScoutClient, DiamondClientError } from "./src/diamondScout/client";
import { ScoutingCacheRepository } from "./src/diamondScout/cache";
import { ExpoFileStore } from "./src/diamondScout/expoLocalStore";
import { GameEventFactory, type InPlayDetail, type QuickOutcome } from "./src/diamondScout/gameSession";
import { OfflineEventQueue } from "./src/diamondScout/offlineQueue";
import { DevicePairingService, DEVICE_CREDENTIAL_KEY } from "./src/diamondScout/pairing";
import type { CurrentHitter, DeviceSession, GameSummary, HitterCard, LineupSummary } from "./src/diamondScout/types";
import { roomSocketJoin } from "./src/dugoutCall/rooms";

type Role = "coach" | "catcher";
type AppMode = "game" | "practice";
type ConnectionState = "idle" | "connecting" | "connected" | "disconnected";
type DiagnosticStatus = "idle" | "running" | "pass" | "warn" | "fail";
type SendState = "idle" | "sending" | "sent" | "failed";

type VoiceDiagnostics = {
  micActive: boolean;
  publishingAudio: boolean;
  subscribedToRemoteAudio: boolean;
  playbackAttached: boolean;
  outputRoute: string;
  localAudioTracks: number;
  remoteAudioTracks: number;
  peerState: string;
};

type DiagnosticCheck = {
  key: string;
  label: string;
  status: DiagnosticStatus;
  detail: string;
};

type RoomDiagnosticSnapshot = {
  code: string;
  counters: Record<string, number>;
  recentEvents: {
    detail?: string;
    kind: string;
    recipientCount?: number;
    role?: Role;
    timestamp: number;
  }[];
};

type RoomResponse = {
  code: string;
  mode: AppMode;
  expiresAt: number;
  token: string;
  livekit?: LiveKitVoiceCredentials | null;
};

type LiveKitVoiceCredentials = {
  serverUrl: string;
  token: string;
  roomName: string;
};

type PitchCallMessage = {
  type: "pitch_call";
  id: string;
  pitch: string;
  location?: string;
  spokenText: string;
  timestamp: number;
};

type WebRTCOfferMessage = {
  type: "webrtc_offer";
  sdp: string;
};

type WebRTCAnswerMessage = {
  type: "webrtc_answer";
  sdp: string;
};

type ICECandidateMessage = {
  type: "ice_candidate";
  candidate: string;
  sdpMid?: string;
  sdpMLineIndex?: number;
};

type ServerMessage =
  | { type: "role_assigned"; code: string; role: Role; mode: AppMode; expiresAt: number }
  | PitchCallMessage
  | WebRTCOfferMessage
  | WebRTCAnswerMessage
  | ICECandidateMessage
  | { type: "ptt_start"; timestamp: number }
  | { type: "ptt_stop"; timestamp: number }
  | { type: "heartbeat"; timestamp: number }
  | { type: "room_closed"; reason: string }
  | { type: "error"; message: string };

type PresetCall = {
  label: string;
  pitch: string;
  location?: string;
};

type AppScreen = "role" | "pair" | "games" | "coach" | "catcher" | "diamondScout";
type DiamondScoutView = "home" | "opponents" | "games" | "gameDetail" | "currentHitter" | "hitterCard" | "debug";
type CountBucket = "early" | "two_strikes" | "any";
type ZoneTint = "hot" | "cold" | "none";
type ScoutingSource = "mock" | "network" | "cache" | "none";
type SprayDirection = { pull: number; center: number; oppo: number };
type SprayPayload =
  | { bands: 2; infield: SprayDirection; outfield: SprayDirection }
  | { bands: 1; direction: SprayDirection }
  | null;

type ScoutHitter = {
  id: string;
  jersey: string;
  name: string;
  bats: string;
  position: string;
  verdict: string;
  chips: { text: string; countBucket: CountBucket }[];
  plan: string;
  chaseZone: string;
  damageZone: string;
  spray: SprayPayload;
  zoneTints: ZoneTint[];
  defensiveNote: string;
  recommendedPitch: string;
  recommendedZone: number;
  speed: string;
  confidenceTier?: "none" | "tentative" | "confident" | "limited" | "moderate" | "high";
  effectiveSample?: Record<string, number>;
};

type HitterSummaryApiResponse = {
  schema_version: string;
  opponent: {
    id: number | string;
    name: string;
    season?: string | null;
  };
  summaries: HitterSummaryApiItem[];
};

type HitterSummaryApiItem = {
  hitter_id: number | string;
  jersey?: string | null;
  name: string;
  bats?: string | null;
  confidence_tier?: ScoutHitter["confidenceTier"];
  verdict?: string | null;
  fallback_text?: string | null;
  chips?: { text: string; count_bucket: CountBucket }[];
  zone_tints?: ZoneTint[];
  spray?: {
    bands?: 1 | 2;
    direction?: Partial<SprayDirection>;
    infield?: Partial<SprayDirection>;
    outfield?: Partial<SprayDirection>;
    pull?: number;
    center?: number;
    oppo?: number;
  } | null;
  defensive_note?: string | null;
  recommended_pitch?: string | null;
  recommended_zone?: number | null;
  effective_sample?: Record<string, number>;
};

type ScoutingCache = {
  schemaVersion: string;
  opponentId: string;
  opponentName: string;
  fetchedAt: number;
  hitters: ScoutHitter[];
  source: ScoutingSource;
};

type ScoutingLoadMetrics = {
  lastColdLoadMs?: number;
  lastWarmLoadMs?: number;
  lastRefreshMs?: number;
  lastLoadedAt?: number;
};

const testTone = require("./assets/test-tone.wav");
const defaultBackendUrl = process.env.EXPO_PUBLIC_DUGOUTCALL_BACKEND_URL || "https://dugoutcall.onrender.com";
const defaultDiamondScoutUrl = process.env.EXPO_PUBLIC_DIAMOND_SCOUT_URL || "";
const defaultPitchButtons = ["Fastball", "Curveball", "Change-up"];
const locations = ["Up", "Down", "In", "Away", "Middle", "Up/In", "Up/Away", "Down/In", "Down/Away"];
const contextButtons = ["0-0", "Ahead", "Behind", "2 Strikes", "Runner On"];
const rtcConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:global.stun.twilio.com:3478" }
  ]
};
const presets: PresetCall[] = [
  { label: "FB Away", pitch: "Fastball", location: "Away" },
  { label: "FB Up", pitch: "Fastball", location: "Up" },
  { label: "Curve Down", pitch: "Curveball", location: "Down" },
  { label: "Curve Away", pitch: "Curveball", location: "Away" },
  { label: "Change Down", pitch: "Change-up", location: "Down" },
  { label: "Change Away", pitch: "Change-up", location: "Away" },
  { label: "Pitchout", pitch: "Pitchout" },
  { label: "Pickoff 1B", pitch: "Pickoff" }
];

const diamondScoutMockHitters: ScoutHitter[] = [
  {
    id: "h1",
    jersey: "8",
    name: "Mason Keller",
    bats: "R",
    position: "SS",
    verdict: "Chases low-away, spin has played",
    chips: [
      { text: "Expand late", countBucket: "two_strikes" },
      { text: "CB any count", countBucket: "any" }
    ],
    plan: "Start soft away. Fastballs must stay up or off the plate.",
    chaseZone: "Slider down away",
    damageZone: "Middle-in fastball",
    spray: {
      bands: 2,
      infield: { pull: 22, center: 10, oppo: 4 },
      outfield: { pull: 26, center: 24, oppo: 14 }
    },
    zoneTints: ["hot", "none", "none", "none", "none", "cold", "none", "cold", "cold"],
    defensiveNote: "Shade pull side",
    recommendedPitch: "Curveball",
    recommendedZone: 8,
    speed: "Above average"
  },
  {
    id: "h2",
    jersey: "12",
    name: "Eli Brooks",
    bats: "L",
    position: "CF",
    verdict: "Chases low-away, dead-red early",
    chips: [
      { text: "Start soft", countBucket: "early" },
      { text: "Expand late", countBucket: "two_strikes" },
      { text: "CH down", countBucket: "any" }
    ],
    plan: "Fastball up early, change-up down when ahead.",
    chaseZone: "Change-up below zone",
    damageZone: "Outer-half curveball",
    spray: {
      bands: 2,
      infield: { pull: 30, center: 12, oppo: 5 },
      outfield: { pull: 25, center: 18, oppo: 10 }
    },
    zoneTints: ["hot", "hot", "none", "none", "none", "cold", "none", "cold", "cold"],
    defensiveNote: "Shade pull, protect 5-6 hole",
    recommendedPitch: "Change-up",
    recommendedZone: 8,
    speed: "Plus"
  },
  {
    id: "h3",
    jersey: "27",
    name: "Noah Price",
    bats: "R",
    position: "1B",
    verdict: "Limited data - pitch your strengths",
    chips: [],
    plan: "Do not double up middle. Curveball for called strike.",
    chaseZone: "Fastball above hands",
    damageZone: "Down and in",
    spray: null,
    zoneTints: ["none", "none", "none", "none", "none", "none", "none", "none", "none"],
    defensiveNote: "Straight up until more data",
    recommendedPitch: "Fastball",
    recommendedZone: 5,
    speed: "Limited"
  }
];

const diamondScoutMock = {
  session: "Varsity Game Prep",
  tenant: "Demo Dugout",
  opponentId: "demo-northview",
  opponent: "Northview",
  game: "Northview at DugoutCall",
  date: "Today",
  score: "Top 3rd, 1 out",
  count: "1-2",
  pitcher: "C. Baso",
  currentHitterId: "h2",
  opponents: ["Northview", "Riverside", "West County"],
  games: ["Northview at DugoutCall", "DugoutCall at Riverside", "West County Tournament"],
  events: ["FB away called strike", "Curve down swinging strike", "Change-up down groundout"]
};

const scoutCacheFolderName = "dugoutcall-scouting-cache";
const diamondScoutTokenKey = "dugoutcall.diamondScout.token";
const diamondScoutBaseUrlKey = "dugoutcall.diamondScout.baseUrl";
const diamondScoutOpponentIdKey = "dugoutcall.diamondScout.opponentId";
const diamondScoutMockModeKey = "dugoutcall.diamondScout.mockMode";
const pitchButtonsKey = "dugoutcall.pitchButtons";

const mockScoutingCache = (): ScoutingCache => ({
  fetchedAt: Date.now(),
  hitters: diamondScoutMockHitters,
  opponentId: diamondScoutMock.opponentId,
  opponentName: diamondScoutMock.opponent,
  schemaVersion: "mock",
  source: "mock"
});

const noDataScoutingCache = (opponentId: string, opponentName = "Opponent"): ScoutingCache => ({
  fetchedAt: Date.now(),
  hitters: [
    {
      bats: "-",
      chips: [],
      chaseZone: "No live scouting data",
      confidenceTier: "none",
      damageZone: "No live scouting data",
      defensiveNote: "Straight up until more data",
      id: "no-data",
      jersey: "--",
      name: "No hitter data",
      plan: "Limited data - pitch your strengths",
      position: "H",
      recommendedPitch: "",
      recommendedZone: 0,
      speed: "Unknown",
      spray: null,
      verdict: "Limited data - pitch your strengths",
      zoneTints: ["none", "none", "none", "none", "none", "none", "none", "none", "none"]
    }
  ],
  opponentId,
  opponentName,
  schemaVersion: "none",
  source: "none"
});

const scoutCacheDirectory = () => {
  const directory = new Directory(Paths.document, scoutCacheFolderName);
  if (!directory.exists) {
    directory.create({ idempotent: true, intermediates: true });
  }
  return directory;
};

const scoutCacheFile = (opponentId: string) =>
  new File(scoutCacheDirectory(), `${encodeURIComponent(opponentId || "unknown")}.json`);

const readPersistedScoutCache = async (opponentId: string): Promise<ScoutingCache | null> => {
  try {
    const file = scoutCacheFile(opponentId);
    if (!file.exists) return null;
    const parsed = JSON.parse(await file.text()) as ScoutingCache;
    if (!parsed?.hitters?.length) return null;
    return {
      ...parsed,
      hitters: parsed.hitters.map((hitter) => ({
        ...hitter,
        spray: normalizeSprayPayload(hitter.spray)
      })),
      source: "cache"
    };
  } catch {
    return null;
  }
};

const writePersistedScoutCache = async (cache: ScoutingCache) => {
  try {
    scoutCacheFile(cache.opponentId).write(JSON.stringify({ ...cache, source: "cache" }));
  } catch {
    // Cache writes must never block the pitch-calling surface.
  }
};

const mapPitchCode = (value?: string | null) => {
  if (!value) return "";
  const normalized = value.toUpperCase();
  if (normalized === "FB") return "Fastball";
  if (normalized === "CB") return "Curveball";
  if (normalized === "CH") return "Change-up";
  return value;
};

const normalizeZoneTints = (values?: ZoneTint[]): ZoneTint[] => {
  const fallback: ZoneTint[] = ["none", "none", "none", "none", "none", "none", "none", "none", "none"];
  if (!Array.isArray(values)) return fallback;
  return fallback.map((fallbackValue, index) => {
    const value = values[index];
    return value === "hot" || value === "cold" || value === "none" ? value : fallbackValue;
  });
};

const normalizePitchButtons = (values: string[]) => {
  const seen = new Set<string>();
  const cleaned = values
    .map((value) => value.trim().replace(/\s+/g, " "))
    .filter(Boolean)
    .filter((value) => {
      const key = value.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 6);
  return cleaned.length ? cleaned : defaultPitchButtons;
};

const normalizeSprayDirection = (value?: Partial<SprayDirection> | null): SprayDirection => ({
  center: Math.max(0, Math.round(value?.center ?? 0)),
  oppo: Math.max(0, Math.round(value?.oppo ?? 0)),
  pull: Math.max(0, Math.round(value?.pull ?? 0))
});

const normalizeSprayPayload = (value?: HitterSummaryApiItem["spray"] | SprayPayload): SprayPayload => {
  if (!value) return null;
  if ("bands" in value && value.bands === 2) {
    return {
      bands: 2,
      infield: normalizeSprayDirection(value.infield),
      outfield: normalizeSprayDirection(value.outfield)
    };
  }
  if ("bands" in value && value.bands === 1) {
    return {
      bands: 1,
      direction: normalizeSprayDirection(value.direction)
    };
  }
  if ("pull" in value || "center" in value || "oppo" in value) {
    return {
      bands: 1,
      direction: normalizeSprayDirection(value)
    };
  }
  return null;
};

const sprayTotals = (spray: SprayPayload): SprayDirection => {
  if (!spray) return { center: 0, oppo: 0, pull: 0 };
  if (spray.bands === 1) return spray.direction;
  return {
    center: spray.infield.center + spray.outfield.center,
    oppo: spray.infield.oppo + spray.outfield.oppo,
    pull: spray.infield.pull + spray.outfield.pull
  };
};

const spraySummaryText = (spray: SprayPayload) => {
  if (!spray) return "No spray sample yet";
  const totals = sprayTotals(spray);
  return `Pull ${totals.pull} / Center ${totals.center} / Oppo ${totals.oppo}`;
};

const apiSummaryToHitter = (summary: HitterSummaryApiItem): ScoutHitter => {
  const fallbackText = summary.fallback_text || "Limited data - pitch your strengths";
  const verdict = summary.verdict || fallbackText;
  const recommendedPitch = mapPitchCode(summary.recommended_pitch);
  const recommendedZone = typeof summary.recommended_zone === "number" ? summary.recommended_zone : 0;
  return {
    bats: summary.bats || "-",
    chips: (summary.chips ?? []).map((chip) => ({ countBucket: chip.count_bucket, text: chip.text })).slice(0, 3),
    chaseZone: summary.recommended_zone ? `Recommended zone ${summary.recommended_zone}` : "No chase zone exposed",
    confidenceTier: summary.confidence_tier,
    damageZone: recommendedZone ? `Recommended zone ${recommendedZone}` : "No damage zone exposed",
    defensiveNote: summary.defensive_note || "Straight up until more data",
    effectiveSample: summary.effective_sample,
    id: String(summary.hitter_id),
    jersey: summary.jersey || "--",
    name: summary.name,
    plan: recommendedPitch && recommendedZone ? `${recommendedPitch} to zone ${recommendedZone}` : verdict,
    position: "H",
    recommendedPitch,
    recommendedZone,
    speed: "Not provided",
    spray: normalizeSprayPayload(summary.spray),
    verdict,
    zoneTints: normalizeZoneTints(summary.zone_tints)
  };
};

const contractSummaryToHitter = (summary: LineupSummary["summaries"][number]): ScoutHitter => {
  const sample = typeof summary.zone_heat === "object" && summary.zone_heat
    ? Number((summary.zone_heat as { sample_size?: unknown }).sample_size ?? 0)
    : 0;
  const verdict = summary.verdict || "Limited data - pitch your strengths";
  return {
    bats: summary.hitter.bats || "-",
    chips: summary.attack_tags.slice(0, 3).map((text) => ({ text, countBucket: "any" as const })),
    chaseZone: "No unsupported zone recommendation",
    confidenceTier: sample > 0 ? "limited" : "none",
    damageZone: "No unsupported zone recommendation",
    defensiveNote: "Use the full card for evidence-backed positioning",
    effectiveSample: { pa: sample },
    id: String(summary.hitter.id),
    jersey: summary.hitter.jersey || "--",
    name: summary.hitter.display_name,
    plan: verdict,
    position: "H",
    recommendedPitch: "",
    recommendedZone: 0,
    speed: "Not provided",
    spray: null,
    verdict,
    zoneTints: normalizeZoneTints()
  };
};

const contractCardToHitter = (card: HitterCard): ScoutHitter => {
  const plan = card.plan?.pitch_plan || card.plan?.out_plan || card.plan?.coach_note || "Limited data - pitch your strengths";
  const sample = Number(card.confidence.pa_sample || 0);
  const jerseyMatch = card.hitter.display_name.match(/^#([^ ]+)/);
  return {
    bats: card.hitter.bats || "-",
    chips: (card.chips || card.attack_tags?.map((text) => ({ text })) || []).slice(0, 3).map((chip) => ({
      text: chip.text,
      countBucket: "any" as const
    })),
    chaseZone: "See full Diamond card",
    confidenceTier: sample > 0 ? "limited" : "none",
    damageZone: "See full Diamond card",
    defensiveNote: "See full Diamond card",
    effectiveSample: { pa: sample },
    id: String(card.hitter.id),
    jersey: jerseyMatch?.[1] || "--",
    name: card.hitter.display_name,
    plan,
    position: "H",
    recommendedPitch: "",
    recommendedZone: 0,
    speed: "Not provided",
    spray: null,
    verdict: plan,
    zoneTints: normalizeZoneTints()
  };
};

const fetchDiamondScoutHitterSummaries = async ({
  baseUrl,
  bearerToken,
  opponentId,
  signal
}: {
  baseUrl: string;
  bearerToken: string;
  opponentId: string;
  signal?: AbortSignal;
}): Promise<ScoutingCache> => {
  const response = await fetch(`${normalizeBaseUrl(baseUrl)}/api/v1/opponents/${encodeURIComponent(opponentId)}/hitter-summaries`, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${bearerToken}`
    },
    signal
  });

  if (!response.ok) {
    const errorPayload = await response.json().catch(() => null);
    const message = errorPayload?.error?.message || `Diamond Scout request failed (${response.status})`;
    throw new Error(message);
  }

  const payload = (await response.json()) as HitterSummaryApiResponse;
  return {
    fetchedAt: Date.now(),
    hitters: payload.summaries.map(apiSummaryToHitter),
    opponentId: String(payload.opponent.id),
    opponentName: payload.opponent.name,
    schemaVersion: payload.schema_version,
    source: "network"
  };
};

const normalizeBaseUrl = (value: string) => value.trim().replace(/\/$/, "");

const websocketUrl = (baseUrl: string) => {
  const normalized = normalizeBaseUrl(baseUrl);
  if (normalized.startsWith("https://")) return normalized.replace("https://", "wss://");
  if (normalized.startsWith("http://")) return normalized.replace("http://", "ws://");
  return normalized;
};

const callId = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const initialVoiceDiagnostics: VoiceDiagnostics = {
  micActive: false,
  publishingAudio: false,
  subscribedToRemoteAudio: false,
  playbackAttached: false,
  outputRoute: "Unknown",
  localAudioTracks: 0,
  remoteAudioTracks: 0,
  peerState: "idle"
};
const initialDiagnosticChecks: DiagnosticCheck[] = [
  { key: "backend", label: "Backend health", status: "idle", detail: "Not checked" },
  { key: "socket", label: "WebSocket room", status: "idle", detail: "Not joined" },
  { key: "room", label: "Room relay", status: "idle", detail: "No room" },
  { key: "localAudio", label: "Local audio", status: "idle", detail: "Not checked" },
  { key: "speech", label: "Speech playback", status: "idle", detail: "Not checked" },
  { key: "microphone", label: "Microphone", status: "idle", detail: "Coach only" },
  { key: "voice", label: "Live voice", status: "idle", detail: "Not connected" }
];

const phrase = (pitch: string, location?: string) => {
  if (!location || pitch === "Pitchout" || pitch === "Pickoff") return pitch;
  return `${pitch} ${location.replace("/", " ").toLowerCase()}`;
};

const compactClock = () =>
  new Date().toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit"
  });

const activateWebRTCAudio = () => {
  try {
    RTCAudioSession.audioSessionDidActivate();
  } catch {
    // The WebRTC native module can still manage audio on platforms where this is a no-op.
  }
};

export default function App() {
  const testTonePlayer = useAudioPlayer(testTone, { downloadFirst: true });
  const socketRef = useRef<WebSocket | null>(null);
  const liveKitRoomRef = useRef<Room | null>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const localAudioAddedRef = useRef(false);
  const pendingIceCandidatesRef = useRef<ICECandidateMessage[]>([]);
  const creatingOfferRef = useRef(false);
  const playedRemoteSubscriptionToneRef = useRef(false);
  const lastSpeechAtRef = useRef(0);
  const talkTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scoutingRefreshRef = useRef<AbortController | null>(null);
  const roleRef = useRef<Role | null>(null);
  const roomCodeRef = useRef("");
  const gameEventFactoryRef = useRef<GameEventFactory | null>(null);
  const localStore = useMemo(() => new ExpoFileStore(), []);
  const scopedCache = useMemo(() => new ScoutingCacheRepository(localStore), [localStore]);
  const eventQueue = useMemo(() => new OfflineEventQueue(localStore), [localStore]);
  const [screen, setScreen] = useState<AppScreen>("role");
  const [role, setRole] = useState<Role | null>(null);
  const [backendUrl, setBackendUrl] = useState(defaultBackendUrl);
  const [diamondScoutBaseUrl, setDiamondScoutBaseUrl] = useState(defaultDiamondScoutUrl);
  const [diamondScoutToken, setDiamondScoutToken] = useState("");
  const [diamondScoutOpponentId, setDiamondScoutOpponentId] = useState(diamondScoutMock.opponentId);
  const [diamondScoutMockMode, setDiamondScoutMockMode] = useState(false);
  const [diamondScoutCacheOnly, setDiamondScoutCacheOnly] = useState(false);
  const [scoutingCache, setScoutingCache] = useState<ScoutingCache>(noDataScoutingCache("unselected", "Select a game"));
  const [scoutingMetrics, setScoutingMetrics] = useState<ScoutingLoadMetrics>({});
  const [currentHitterId, setCurrentHitterId] = useState(diamondScoutMock.currentHitterId);
  const [scoutEnabled, setScoutEnabled] = useState(true);
  const [pitchButtons, setPitchButtons] = useState(defaultPitchButtons);
  const [room, setRoom] = useState<RoomResponse | null>(null);
  const [joinCode, setJoinCode] = useState("");
  const [connection, setConnection] = useState<ConnectionState>("idle");
  const [status, setStatus] = useState("Ready");
  const [selectedPitch, setSelectedPitch] = useState("");
  const [selectedLocation, setSelectedLocation] = useState("");
  const [selectedContext, setSelectedContext] = useState("");
  const [sendState, setSendState] = useState<SendState>("idle");
  const [lastCall, setLastCall] = useState<PitchCallMessage | null>(null);
  const [isTalking, setIsTalking] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState("Voice ready");
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [remoteStreamUrl, setRemoteStreamUrl] = useState("");
  const [forceSpeaker, setForceSpeaker] = useState(false);
  const [voiceDiagnostics, setVoiceDiagnostics] = useState<VoiceDiagnostics>(initialVoiceDiagnostics);
  const [liveKitRoomName, setLiveKitRoomName] = useState("");
  const [catcherState, setCatcherState] = useState("Waiting for call");
  const [lastHeard, setLastHeard] = useState("No pitch call yet.");
  const [lastNetworkEvent, setLastNetworkEvent] = useState("No room joined");
  const [diagnosticChecks, setDiagnosticChecks] = useState<DiagnosticCheck[]>(initialDiagnosticChecks);
  const [isRunningDiagnostics, setIsRunningDiagnostics] = useState(false);
  const [lastServerDiagnostics, setLastServerDiagnostics] = useState("No server diagnostics fetched");
  const [pairingCode, setPairingCode] = useState("");
  const [pairingBusy, setPairingBusy] = useState(false);
  const [deviceSession, setDeviceSession] = useState<DeviceSession | null>(null);
  const [availableGames, setAvailableGames] = useState<GameSummary[]>([]);
  const [selectedGame, setSelectedGame] = useState<GameSummary | null>(null);
  const [currentApiHitter, setCurrentApiHitter] = useState<CurrentHitter | null>(null);
  const [queueStatus, setQueueStatus] = useState("Synced");
  const [outcomeVisible, setOutcomeVisible] = useState(false);
  const [inPlayMode, setInPlayMode] = useState(false);
  const [inPlayDraft, setInPlayDraft] = useState<Partial<InPlayDetail>>({});
  const pairingService = useMemo(
    () =>
      new DevicePairingService(
        SecureStore,
        (credential) => new DiamondScoutClient(diamondScoutBaseUrl, credential),
        callId
      ),
    [diamondScoutBaseUrl]
  );

  useEffect(() => {
    void configureAudioForPlayback();
  }, []);

  useEffect(() => {
    const loadStoredDiamondScoutConfig = async () => {
      const [token, storedPitchButtons] = await Promise.all([
        SecureStore.getItemAsync(DEVICE_CREDENTIAL_KEY),
        SecureStore.getItemAsync(pitchButtonsKey)
      ]);
      if (token) setDiamondScoutToken(token);
      if (storedPitchButtons) {
        try {
          const parsed = JSON.parse(storedPitchButtons);
          if (Array.isArray(parsed)) setPitchButtons(normalizePitchButtons(parsed));
        } catch {
          setPitchButtons(defaultPitchButtons);
        }
      }
    };

    void loadStoredDiamondScoutConfig();
  }, []);

  useEffect(() => {
    void SecureStore.setItemAsync(pitchButtonsKey, JSON.stringify(pitchButtons));
  }, [pitchButtons]);

  useEffect(() => {
    if (selectedPitch && selectedPitch !== "Pickoff" && selectedPitch !== "Pitchout" && !pitchButtons.includes(selectedPitch)) {
      setSelectedPitch("");
    }
  }, [pitchButtons, selectedPitch]);

  const currentPhrase = useMemo(
    () => phrase(selectedPitch, selectedLocation),
    [selectedPitch, selectedLocation]
  );

  const liveDiamondScoutReady = Boolean(normalizeBaseUrl(diamondScoutBaseUrl) && diamondScoutToken.trim());
  const effectiveDiamondScoutMockMode = __DEV__ && diamondScoutMockMode;
  const scoutingHitters = scoutingCache.hitters.length ? scoutingCache.hitters : noDataScoutingCache(diamondScoutOpponentId).hitters;
  const fallbackScoutingHitter = diamondScoutMockHitters[0];
  const currentScoutingHitter =
    scoutingHitters.find((hitter) => hitter.id === currentHitterId) ?? scoutingHitters[0] ?? fallbackScoutingHitter;
  const currentScoutingIndex = Math.max(
    0,
    scoutingHitters.findIndex((hitter) => hitter.id === currentScoutingHitter.id)
  );
  const onDeckScoutingHitter =
    scoutingHitters[(currentScoutingIndex + 1) % scoutingHitters.length] ?? currentScoutingHitter;
  const scoutAvailable =
    scoutingCache.source !== "none" && currentScoutingHitter.id !== "no-data" && currentScoutingHitter.confidenceTier !== "none";
  const scoutingMetaLabel = `${scoutingCache.source.toUpperCase()}${
    scoutingMetrics.lastWarmLoadMs !== undefined
      ? ` cache ${scoutingMetrics.lastWarmLoadMs}ms`
      : scoutingMetrics.lastColdLoadMs !== undefined
        ? ` load ${scoutingMetrics.lastColdLoadMs}ms`
        : ""
  }`;

  const apiUrl = (path: string) => `${normalizeBaseUrl(backendUrl)}${path}`;

  useEffect(() => {
    if (!scoutAvailable && scoutEnabled) {
      setScoutEnabled(false);
    }
  }, [scoutAvailable, scoutEnabled]);

  const triggerHaptic = (kind: "send_success" | "send_fail" | "mic_open" | "mic_close" | "mic_cutoff" | "scout_toggle") => {
    const patterns: Record<typeof kind, number | number[]> = {
      mic_close: 18,
      mic_cutoff: [0, 90, 70, 90],
      mic_open: 28,
      scout_toggle: [0, 18, 28, 18],
      send_fail: [0, 70, 40, 70],
      send_success: 35
    };
    Vibration.vibrate(patterns[kind]);
  };

  const toggleScout = () => {
    if (!scoutAvailable) return;
    setScoutEnabled((current) => !current);
    triggerHaptic("scout_toggle");
  };

  const applyScoutingCache = (cache: ScoutingCache) => {
    setScoutingCache(cache);
    if (!cache.hitters.some((hitter) => hitter.id === currentHitterId)) {
      setCurrentHitterId(cache.hitters[0]?.id ?? "no-data");
    }
  };

  const loadScoutingForGame = async (reason: "game_start" | "batter_advance" | "manual" = "game_start") => {
    const startedAt = Date.now();
    if (effectiveDiamondScoutMockMode) {
      const cache = mockScoutingCache();
      applyScoutingCache(cache);
      setScoutingMetrics((current) => ({ ...current, lastColdLoadMs: Date.now() - startedAt, lastLoadedAt: Date.now() }));
      return;
    }
    const deviceId = deviceSession?.device?.id;
    const gameId = selectedGame?.id;
    if (!deviceId || !gameId || !diamondScoutToken) return;
    const cachedEnvelope = await scopedCache.read<ScoutingCache>(deviceId, gameId);
    const cached = cachedEnvelope?.value;
    if (cachedEnvelope) {
      applyScoutingCache({ ...cachedEnvelope.value, source: "cache" });
      setScoutingMetrics((current) => ({
        ...current,
        lastLoadedAt: cachedEnvelope.cachedAt,
        lastWarmLoadMs: Date.now() - startedAt
      }));
    }
    if (diamondScoutCacheOnly) {
      if (!cached) applyScoutingCache(noDataScoutingCache(String(selectedGame.opponent_id), selectedGame.opponent_name));
      return;
    }
    try {
      const client = new DiamondScoutClient(diamondScoutBaseUrl, diamondScoutToken);
      const [lineup, current] = await Promise.all([client.lineupSummaries(gameId), client.currentHitter(gameId)]);
      const currentHitter = contractCardToHitter(current.card);
      const mapped = lineup.summaries.map(contractSummaryToHitter);
      const hitters = mapped.some((hitter) => hitter.id === currentHitter.id)
        ? mapped.map((hitter) => (hitter.id === currentHitter.id ? currentHitter : hitter))
        : [currentHitter, ...mapped];
      const networkCache: ScoutingCache = {
        fetchedAt: Date.now(),
        hitters,
        opponentId: String(selectedGame.opponent_id),
        opponentName: selectedGame.opponent_name,
        schemaVersion: lineup.schema_version,
        source: "network"
      };
      setCurrentApiHitter(current);
      gameEventFactoryRef.current = new GameEventFactory(current, callId);
      applyScoutingCache(networkCache);
      setCurrentHitterId(currentHitter.id);
      await scopedCache.write(deviceId, gameId, networkCache);
      setScoutingMetrics((current) => ({
        ...current,
        lastColdLoadMs: cached ? current.lastColdLoadMs : Date.now() - startedAt,
        lastLoadedAt: networkCache.fetchedAt,
        lastRefreshMs: cached || reason === "batter_advance" ? Date.now() - startedAt : current.lastRefreshMs
      }));
      setLastNetworkEvent(`Scouting refreshed at ${compactClock()}`);
      void client.telemetry("dugoutcall_scouting_loaded", { source: reason }).catch(() => undefined);
    } catch (error) {
      if (!cached) applyScoutingCache(noDataScoutingCache(String(selectedGame.opponent_id), selectedGame.opponent_name));
      setLastNetworkEvent(cached ? "Scouting cache active; live refresh failed" : "No scouting cache available");
      if (error instanceof DiamondClientError && error.status === 401) {
        await pairingService.unpair(async () => {
          await Promise.all([scopedCache.purgeAll(), eventQueue.purgeAll()]);
        });
        setDiamondScoutToken("");
        setDeviceSession(null);
        setScreen("pair");
      }
    }
  };

  const advanceHitter = async () => {
    if (!selectedGame || !diamondScoutToken) return;
    try {
      const updated = await new DiamondScoutClient(diamondScoutBaseUrl, diamondScoutToken).advance(selectedGame.id, {
        event_id: callId(),
        direction: "next"
      });
      setCurrentApiHitter(updated);
      gameEventFactoryRef.current = new GameEventFactory(updated, callId);
      setCurrentHitterId(String(updated.hitter_id));
      setSelectedPitch("");
      setSelectedLocation("");
      setSelectedContext("");
      await loadScoutingForGame("batter_advance");
    } catch (error) {
      Alert.alert("Could not advance hitter", error instanceof Error ? error.message : "Try again.");
    }
  };

  useEffect(() => {
    if (screen === "coach") {
      void loadScoutingForGame("game_start");
    }
  }, [
    selectedGame?.id,
    screen
  ]);

  const updateVoiceDiagnostics = (patch: Partial<VoiceDiagnostics>) => {
    setVoiceDiagnostics((current) => ({ ...current, ...patch }));
  };

  const configuredOutputRoute = (label: string, speakerRequested = forceSpeaker) => {
    if (Platform.OS === "ios") {
      return speakerRequested ? `${label}: speaker requested` : `${label}: system route`;
    }
    return speakerRequested ? `${label}: speaker requested` : `${label}: speaker/default`;
  };

  const configureAudioForPlayback = async (label = "playback") => {
    await setAudioModeAsync({
      allowsRecording: false,
      interruptionMode: "doNotMix",
      playsInSilentMode: true,
      shouldPlayInBackground: false,
      shouldRouteThroughEarpiece: false
    });
    updateVoiceDiagnostics({ outputRoute: configuredOutputRoute(label) });
    setVoiceStatus("Audio playback ready");
  };

  const configureAudioForTalk = async () => {
    await setAudioModeAsync({
      allowsRecording: true,
      interruptionMode: "doNotMix",
      playsInSilentMode: true,
      shouldPlayInBackground: false,
      shouldRouteThroughEarpiece: false
    });
    updateVoiceDiagnostics({ outputRoute: configuredOutputRoute("voice transmit") });
  };

  const configureAudioForVoiceReceive = async (label = "voice receive", speakerRequested = forceSpeaker) => {
    await setAudioModeAsync({
      allowsRecording: !speakerRequested,
      interruptionMode: "doNotMix",
      playsInSilentMode: true,
      shouldPlayInBackground: false,
      shouldRouteThroughEarpiece: false
    });
    updateVoiceDiagnostics({ outputRoute: configuredOutputRoute(label, speakerRequested) });
  };

  const configureLiveKitAudio = async (roleForAudio: Role, speakerRequested = forceSpeaker) => {
    await LiveKitAudioSession.configureAudio({
      ios: {
        defaultOutput: speakerRequested || roleForAudio === "catcher" ? "speaker" : "earpiece"
      },
      android: {
        preferredOutputList: ["bluetooth", "headset", "speaker", "earpiece"],
        audioTypeOptions: {
          audioMode: "inCommunication",
          audioAttributesUsageType: "voiceCommunication",
          audioAttributesContentType: "speech",
          audioStreamType: "voiceCall",
          manageAudioFocus: true
        }
      }
    });
    await LiveKitAudioSession.startAudioSession();
    await LiveKitAudioSession.setAppleAudioConfiguration({
      audioCategory: "playAndRecord",
      audioMode: "voiceChat",
      audioCategoryOptions: ["defaultToSpeaker", "allowBluetooth"]
    });
    if (speakerRequested) {
      await LiveKitAudioSession.selectAudioOutput("force_speaker");
    }
    updateVoiceDiagnostics({
      outputRoute: speakerRequested
        ? "LiveKit: force speaker"
        : roleForAudio === "catcher"
          ? "LiveKit: speaker default"
          : "LiveKit: system route"
    });
  };

  const playTone = async () => {
    await configureAudioForPlayback();
    testTonePlayer.volume = 1;
    await testTonePlayer.seekTo(0);
    testTonePlayer.play();
  };

  const requestJson = async <T,>(path: string, init: RequestInit): Promise<T> => {
    let lastError = "Network request failed";
    for (const delay of [0, 1200, 2500, 5000]) {
      if (delay > 0) {
        setStatus("Waking server...");
        await new Promise((resolve) => setTimeout(resolve, delay));
      }

      try {
        const response = await fetch(apiUrl(path), {
          ...init,
          headers: {
            "Content-Type": "application/json",
            ...(init.headers ?? {})
          }
        });
        if (response.ok) return (await response.json()) as T;
        lastError = `Server returned ${response.status}`;
      } catch (error) {
        lastError = error instanceof Error ? error.message : "Network request failed";
      }
    }
    throw new Error(lastError);
  };

  const setDiagnosticCheck = (check: DiagnosticCheck) => {
    setDiagnosticChecks((current) => current.map((item) => (item.key === check.key ? check : item)));
  };

  const roomDiagnosticSummary = (snapshot: RoomDiagnosticSnapshot) => {
    const socketJoins = snapshot.counters.socket_joined ?? 0;
    const pitchCalls = snapshot.counters.pitch_call ?? 0;
    const pttStarts = snapshot.counters.ptt_start ?? 0;
    const lastEvent = snapshot.recentEvents[snapshot.recentEvents.length - 1];
    const eventText = lastEvent ? `${lastEvent.kind} ${new Date(lastEvent.timestamp).toLocaleTimeString()}` : "no events";
    return `${socketJoins} socket joins, ${pitchCalls} pitch calls, ${pttStarts} PTT starts, last ${eventText}`;
  };

  const runDiagnostics = async () => {
    if (isRunningDiagnostics) return;
    setIsRunningDiagnostics(true);
    setDiagnosticChecks(initialDiagnosticChecks.map((check) => ({ ...check, status: "running", detail: "Checking..." })));

    try {
      try {
        const response = await fetch(apiUrl("/health"));
        const body = (await response.json()) as { ok?: boolean; service?: string };
        setDiagnosticCheck({
          key: "backend",
          label: "Backend health",
          status: response.ok && body.ok ? "pass" : "fail",
          detail: response.ok ? body.service ?? "Healthy" : `HTTP ${response.status}`
        });
      } catch (error) {
        setDiagnosticCheck({
          key: "backend",
          label: "Backend health",
          status: "fail",
          detail: error instanceof Error ? error.message : "Backend unreachable"
        });
      }

      const socketOpen = socketRef.current?.readyState === WebSocket.OPEN;
      setDiagnosticCheck({
        key: "socket",
        label: "WebSocket room",
        status: socketOpen ? "pass" : room ? "fail" : "warn",
        detail: socketOpen ? `${roleRef.current ?? "unknown"} socket open` : room ? "Room joined but socket closed" : "Join/create a room first"
      });

      const code = roomCodeRef.current || room?.code || joinCode.trim();
      if (code.length === 6) {
        try {
          const snapshot = await requestJson<RoomDiagnosticSnapshot>(`/rooms/${code}/diagnostics`, {
            method: "GET",
            headers: room?.token ? { Authorization: `Bearer ${room.token}` } : undefined
          });
          const summary = roomDiagnosticSummary(snapshot);
          const hasCoach = snapshot.recentEvents.some((event) => event.kind === "socket_joined" && event.role === "coach");
          const hasCatcher = snapshot.recentEvents.some((event) => event.kind === "socket_joined" && event.role === "catcher");
          setLastServerDiagnostics(summary);
          setDiagnosticCheck({
            key: "room",
            label: "Room relay",
            status: hasCoach && hasCatcher ? "pass" : "warn",
            detail: `${hasCoach ? "coach socket" : "no coach socket"}, ${hasCatcher ? "catcher socket" : "no catcher socket"}; ${summary}`
          });
        } catch (error) {
          setDiagnosticCheck({
            key: "room",
            label: "Room relay",
            status: "fail",
            detail: error instanceof Error ? error.message : "Room diagnostics unavailable"
          });
        }
      } else {
        setDiagnosticCheck({
          key: "room",
          label: "Room relay",
          status: "warn",
          detail: "Create or enter a 6-digit room code"
        });
      }

      try {
        await playTone();
        setDiagnosticCheck({
          key: "localAudio",
          label: "Local audio",
          status: "pass",
          detail: "Tone started on this iPhone"
        });
      } catch (error) {
        setDiagnosticCheck({
          key: "localAudio",
          label: "Local audio",
          status: "fail",
          detail: error instanceof Error ? error.message : "Tone failed"
        });
      }

      try {
        Speech.stop();
        Speech.speak("DugoutCall audio test.", {
          pitch: 1,
          rate: 0.48,
          volume: 1
        });
        setDiagnosticCheck({
          key: "speech",
          label: "Speech playback",
          status: "pass",
          detail: "Speech test started"
        });
      } catch (error) {
        setDiagnosticCheck({
          key: "speech",
          label: "Speech playback",
          status: "fail",
          detail: error instanceof Error ? error.message : "Speech failed"
        });
      }

      if (roleRef.current === "coach") {
        try {
          const permission = await requestRecordingPermissionsAsync();
          setDiagnosticCheck({
            key: "microphone",
            label: "Microphone",
            status: permission.granted ? "pass" : "fail",
            detail: permission.granted ? "Permission granted" : `Permission ${permission.status}`
          });
        } catch (error) {
          setDiagnosticCheck({
            key: "microphone",
            label: "Microphone",
            status: "fail",
            detail: error instanceof Error ? error.message : "Permission check failed"
          });
        }
      } else {
        setDiagnosticCheck({
          key: "microphone",
          label: "Microphone",
          status: roleRef.current === "catcher" ? "pass" : "warn",
          detail: roleRef.current === "catcher" ? "Not used in Game Mode" : "Coach permission checked after room create"
        });
      }

      const liveKitRoom = liveKitRoomRef.current;
      const liveKitConnected = liveKitRoom?.state === LiveKitConnectionState.Connected;
      const voiceReady =
        roleRef.current === "coach"
          ? liveKitConnected
          : liveKitConnected && (voiceDiagnostics.subscribedToRemoteAudio || voiceDiagnostics.peerState.includes("livekit"));
      setDiagnosticCheck({
        key: "voice",
        label: "Live voice",
        status: voiceReady ? "pass" : liveKitConnected ? "warn" : "fail",
        detail: liveKitConnected
          ? `${liveKitRoomName || "LiveKit room"} connected; ${voiceDiagnostics.localAudioTracks} local / ${voiceDiagnostics.remoteAudioTracks} remote tracks`
          : voiceDiagnostics.peerState || "LiveKit not connected"
      });
    } finally {
      setIsRunningDiagnostics(false);
    }
  };

  const closeLiveKitVoiceSession = () => {
    const room = liveKitRoomRef.current;
    liveKitRoomRef.current = null;
    setLiveKitRoomName("");
    if (room) {
      void room.localParticipant.setMicrophoneEnabled(false).catch(() => undefined);
      void room.disconnect(true).catch(() => undefined);
    }
    void LiveKitAudioSession.stopAudioSession().catch(() => undefined);
  };

  const closeVoiceSession = () => {
    closeLiveKitVoiceSession();
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
    localAudioAddedRef.current = false;
    pendingIceCandidatesRef.current = [];
    playedRemoteSubscriptionToneRef.current = false;
    peerRef.current?.close();
    peerRef.current = null;
    try {
      RTCAudioSession.audioSessionDidDeactivate();
    } catch {
      // Audio session cleanup is best-effort.
    }
    setRemoteStream(null);
    setRemoteStreamUrl("");
    setVoiceDiagnostics(initialVoiceDiagnostics);
    setIsTalking(false);
    void configureAudioForPlayback();
  };

  const disconnectSocket = () => {
    closeVoiceSession();
    socketRef.current?.close();
    socketRef.current = null;
    setConnection("disconnected");
  };

  const setCurrentRole = (nextRole: Role | null) => {
    roleRef.current = nextRole;
    setRole(nextRole);
  };

  const connectSocket = (nextRole: Role, credentials: RoomResponse, displayName: string) => {
    disconnectSocket();
    roleRef.current = nextRole;
    roomCodeRef.current = credentials.code;
    setConnection("connecting");
    setLastNetworkEvent(`Connecting ${nextRole} socket...`);
    const socket = new WebSocket(websocketUrl(backendUrl));
    socketRef.current = socket;

    socket.onopen = () => {
      setConnection("connected");
      setLastNetworkEvent(`Socket joined ${credentials.code} at ${compactClock()}`);
      socket.send(JSON.stringify(roomSocketJoin(credentials, nextRole, displayName)));
    };

    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data) as ServerMessage;
        handleServerMessage(message);
      } catch {
        setLastNetworkEvent(`Bad network message at ${compactClock()}`);
      }
    };

    socket.onerror = () => {
      setStatus("Connection error");
      setLastNetworkEvent(`Socket error at ${compactClock()}`);
    };

    socket.onclose = () => {
      setConnection("disconnected");
      setLastNetworkEvent(`Socket disconnected at ${compactClock()}`);
    };
  };

  const handleServerMessage = (message: ServerMessage) => {
    if (message.type === "role_assigned") {
      setStatus(`${message.role === "coach" ? "Coach" : "Catcher"} connected`);
      setLastNetworkEvent(`${message.role} socket confirmed at ${compactClock()}`);
      return;
    }

    if (message.type === "pitch_call") {
      setLastNetworkEvent(`Pitch received at ${compactClock()}`);
      receivePitchCall(message.spokenText);
      return;
    }

    if (message.type === "webrtc_offer") {
      setLastNetworkEvent(`Voice offer received at ${compactClock()}`);
      void handleWebRTCOffer(message);
      return;
    }

    if (message.type === "webrtc_answer") {
      setLastNetworkEvent(`Voice answer received at ${compactClock()}`);
      void handleWebRTCAnswer(message);
      return;
    }

    if (message.type === "ice_candidate") {
      void handleIceCandidate(message);
      return;
    }

    if (message.type === "ptt_start") {
      setCatcherState("Receiving voice");
      setVoiceStatus("Receiving coach voice");
      setLastNetworkEvent(`Talk started at ${compactClock()}`);
      return;
    }

    if (message.type === "ptt_stop") {
      setCatcherState("Waiting for call");
      setVoiceStatus("Voice ready");
      setLastNetworkEvent(`Talk stopped at ${compactClock()}`);
      return;
    }

    if (message.type === "error") {
      setStatus(message.message);
      setLastNetworkEvent(`Error: ${message.message}`);
    }
  };

  const sendSocket = (message: unknown) => {
    if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
      setStatus("Not connected");
      setLastNetworkEvent(`Send blocked: socket offline at ${compactClock()}`);
      return false;
    }
    socketRef.current.send(JSON.stringify(message));
    return true;
  };

  const connectLiveKitVoice = async (credentials: LiveKitVoiceCredentials | null | undefined, nextRole: Role) => {
    closeLiveKitVoiceSession();
    playedRemoteSubscriptionToneRef.current = false;

    if (!credentials) {
      setVoiceStatus("LiveKit not configured");
      updateVoiceDiagnostics({ peerState: "livekit missing" });
      return;
    }

    try {
      setVoiceStatus("Connecting LiveKit voice...");
      setLiveKitRoomName(credentials.roomName);
      await configureLiveKitAudio(nextRole);

      const liveKitRoom = new Room({
        adaptiveStream: false,
        dynacast: false
      });
      liveKitRoomRef.current = liveKitRoom;

      liveKitRoom
        .on(RoomEvent.Connected, () => {
          setVoiceStatus(nextRole === "coach" ? "LiveKit voice ready" : "Listening for coach voice");
          updateVoiceDiagnostics({ peerState: "livekit connected" });
          if (nextRole === "catcher") {
            void liveKitRoom.startAudio().catch(() => setVoiceStatus("Tap Play test audio to unlock sound"));
          }
        })
        .on(RoomEvent.ConnectionStateChanged, (state) => {
          updateVoiceDiagnostics({ peerState: `livekit ${state}` });
          if (state === LiveKitConnectionState.Reconnecting || state === LiveKitConnectionState.SignalReconnecting) {
            setVoiceStatus("LiveKit reconnecting...");
          }
        })
        .on(RoomEvent.LocalTrackPublished, (publication) => {
          if (publication.source !== Track.Source.Microphone) return;
          updateVoiceDiagnostics({
            localAudioTracks: 1,
            micActive: !publication.isMuted,
            publishingAudio: !publication.isMuted
          });
        })
        .on(RoomEvent.LocalTrackUnpublished, () => {
          updateVoiceDiagnostics({ localAudioTracks: 0, micActive: false, publishingAudio: false });
        })
        .on(RoomEvent.TrackSubscribed, (track) => {
          if (track.kind !== Track.Kind.Audio) return;
          updateVoiceDiagnostics({
            subscribedToRemoteAudio: true,
            playbackAttached: true,
            remoteAudioTracks: 1
          });
          setCatcherState("Receiving voice");
          setVoiceStatus("LiveKit voice connected");
          if (!playedRemoteSubscriptionToneRef.current) {
            playedRemoteSubscriptionToneRef.current = true;
            void playTone().catch(() => setVoiceStatus("Subscribed; tone failed"));
          }
        })
        .on(RoomEvent.TrackUnsubscribed, (track) => {
          if (track.kind !== Track.Kind.Audio) return;
          updateVoiceDiagnostics({
            subscribedToRemoteAudio: false,
            playbackAttached: false,
            remoteAudioTracks: 0
          });
          setVoiceStatus("Coach voice unsubscribed");
        })
        .on(RoomEvent.AudioPlaybackStatusChanged, (playing) => {
          updateVoiceDiagnostics({ playbackAttached: playing });
        })
        .on(RoomEvent.Disconnected, () => {
          updateVoiceDiagnostics({
            micActive: false,
            publishingAudio: false,
            subscribedToRemoteAudio: false,
            playbackAttached: false,
            peerState: "livekit disconnected"
          });
        });

      await liveKitRoom.connect(credentials.serverUrl, credentials.token, {
        autoSubscribe: nextRole === "catcher"
      });
      if (nextRole === "coach") {
        await liveKitRoom.localParticipant.setMicrophoneEnabled(false);
      }
    } catch (error) {
      closeLiveKitVoiceSession();
      setVoiceStatus("LiveKit voice failed");
      setStatus(error instanceof Error ? error.message : "LiveKit voice failed");
      updateVoiceDiagnostics({ peerState: "livekit failed" });
    }
  };

  const createPeerConnection = () => {
    if (peerRef.current) return peerRef.current;

    activateWebRTCAudio();
    const peer = new RTCPeerConnection(rtcConfiguration);
    peerRef.current = peer;
    updateVoiceDiagnostics({ peerState: "created" });

    (peer as any).addEventListener("icecandidate", (event: any) => {
      const candidate = event.candidate;
      if (!candidate) return;
      sendSocket({
        type: "ice_candidate",
        candidate: candidate.candidate,
        sdpMid: candidate.sdpMid ?? undefined,
        sdpMLineIndex: candidate.sdpMLineIndex ?? undefined
      });
    });

    (peer as any).addEventListener("track", (event: any) => {
      const [stream] = event.streams;
      if (stream) {
        const audioTracks = stream.getAudioTracks() as any[];
        audioTracks.forEach((track) => {
          track.enabled = true;
          (track as any)._setVolume?.(10);
        });
        setRemoteStream(stream);
        setRemoteStreamUrl(stream.toURL());
        updateVoiceDiagnostics({
          subscribedToRemoteAudio: audioTracks.length > 0,
          playbackAttached: true,
          remoteAudioTracks: audioTracks.length
        });
        setCatcherState("Receiving voice");
        setVoiceStatus("Voice connected");
        if (!playedRemoteSubscriptionToneRef.current) {
          playedRemoteSubscriptionToneRef.current = true;
          void playTone().catch(() => setVoiceStatus("Remote subscribed; tone failed"));
        }
      }
    });

    (peer as any).addEventListener("connectionstatechange", () => {
      updateVoiceDiagnostics({ peerState: peer.connectionState });
      if (peer.connectionState === "connected") setVoiceStatus("Voice connected");
      if (peer.connectionState === "connecting") setVoiceStatus("Connecting voice...");
      if (peer.connectionState === "failed" || peer.connectionState === "disconnected") {
        setVoiceStatus("Voice disconnected");
      }
    });

    return peer;
  };

  const addPendingIceCandidates = async () => {
    const peer = peerRef.current;
    if (!peer?.remoteDescription) return;

    const candidates = pendingIceCandidatesRef.current.splice(0);
    for (const candidate of candidates) {
      await peer.addIceCandidate(
        new RTCIceCandidate({
          candidate: candidate.candidate,
          sdpMid: candidate.sdpMid,
          sdpMLineIndex: candidate.sdpMLineIndex
        })
      );
    }
  };

  const handleWebRTCOffer = async (message: WebRTCOfferMessage) => {
    if (roleRef.current !== "catcher") return;

    try {
      await configureAudioForVoiceReceive("voice receive");
      activateWebRTCAudio();
      const peer = createPeerConnection();
      await peer.setRemoteDescription(new RTCSessionDescription({ type: "offer", sdp: message.sdp }));
      await addPendingIceCandidates();
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      sendSocket({ type: "webrtc_answer", sdp: answer.sdp });
      updateVoiceDiagnostics({ peerState: peer.connectionState });
      setVoiceStatus("Voice ready");
    } catch (error) {
      setVoiceStatus("Voice setup failed");
      setStatus(error instanceof Error ? error.message : "Voice setup failed");
    }
  };

  const handleWebRTCAnswer = async (message: WebRTCAnswerMessage) => {
    if (roleRef.current !== "coach" || !peerRef.current) return;

    try {
      await peerRef.current.setRemoteDescription(new RTCSessionDescription({ type: "answer", sdp: message.sdp }));
      await addPendingIceCandidates();
      setVoiceStatus("Voice connected");
    } catch (error) {
      setVoiceStatus("Voice answer failed");
      setStatus(error instanceof Error ? error.message : "Voice answer failed");
    }
  };

  const handleIceCandidate = async (message: ICECandidateMessage) => {
    const peer = peerRef.current;
    if (!peer?.remoteDescription) {
      pendingIceCandidatesRef.current.push(message);
      return;
    }

    try {
      await peer.addIceCandidate(
        new RTCIceCandidate({
          candidate: message.candidate,
          sdpMid: message.sdpMid,
          sdpMLineIndex: message.sdpMLineIndex
        })
      );
    } catch {
      setVoiceStatus("Voice network retrying");
    }
  };

  const prepareCoachAudio = async () => {
    await configureAudioForTalk();
    activateWebRTCAudio();
    const peer = createPeerConnection();
    let stream = localStreamRef.current;

    if (!stream) {
      stream = await mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        } as any,
        video: false
      });
      localStreamRef.current = stream;
    }

    stream.getAudioTracks().forEach((track) => {
      track.enabled = true;
      if (!localAudioAddedRef.current) peer.addTrack(track, stream);
    });
    localAudioAddedRef.current = true;
    updateVoiceDiagnostics({
      localAudioTracks: stream.getAudioTracks().length,
      micActive: stream.getAudioTracks().some((track) => track.enabled),
      publishingAudio: stream.getAudioTracks().some((track) => track.enabled),
      peerState: peer.connectionState
    });

    if (!peer.localDescription && !creatingOfferRef.current) {
      creatingOfferRef.current = true;
      try {
        const offer = await peer.createOffer({
          offerToReceiveAudio: false,
          offerToReceiveVideo: false
        });
        await peer.setLocalDescription(offer);
        sendSocket({ type: "webrtc_offer", sdp: offer.sdp });
      } finally {
        creatingOfferRef.current = false;
      }
    }
  };

  const purgeDiamondLocalData = async () => {
    await Promise.all([scopedCache.purgeAll(), eventQueue.purgeAll()]);
    setScoutingCache(noDataScoutingCache("unselected", "Select a game"));
    setCurrentApiHitter(null);
    setSelectedGame(null);
    setAvailableGames([]);
  };

  const beginCoachFlow = async () => {
    if (!normalizeBaseUrl(diamondScoutBaseUrl)) {
      Alert.alert("Pilot configuration blocked", "This build has no Diamond Scout pilot URL. Install the configured TestFlight build.");
      return;
    }
    setStatus("Checking Diamond pairing...");
    const credential = await pairingService.credential();
    if (!credential) {
      setScreen("pair");
      return;
    }
    try {
      const client = new DiamondScoutClient(diamondScoutBaseUrl, credential);
      const [session, games] = await Promise.all([client.session(), client.games()]);
      setDiamondScoutToken(credential);
      setDeviceSession(session);
      setAvailableGames(games);
      setScreen("games");
      setStatus("Select a Diamond game");
    } catch (error) {
      if (error instanceof DiamondClientError && error.status === 401) {
        await pairingService.unpair(purgeDiamondLocalData);
        setDiamondScoutToken("");
        setDeviceSession(null);
        setScreen("pair");
        return;
      }
      Alert.alert("Diamond unavailable", error instanceof Error ? error.message : "Try again.");
    }
  };

  const pairDevice = async () => {
    if (pairingBusy) return;
    setPairingBusy(true);
    try {
      const paired = await pairingService.pair(pairingCode, "Coach iPhone");
      const client = new DiamondScoutClient(diamondScoutBaseUrl, paired.credential);
      const [session, games] = await Promise.all([client.session(), client.games()]);
      setDiamondScoutToken(paired.credential);
      setDeviceSession(session);
      setAvailableGames(games);
      setPairingCode("");
      setScreen("games");
      setStatus(`Paired to ${session.program.name}`);
    } catch (error) {
      Alert.alert("Pairing failed", error instanceof Error ? error.message : "Request a new code in Diamond Settings.");
    } finally {
      setPairingBusy(false);
    }
  };

  const unpairDevice = async () => {
    await pairingService.unpair(purgeDiamondLocalData);
    setDiamondScoutToken("");
    setDeviceSession(null);
    setScreen("pair");
    setStatus("Device unpaired; local scouting removed");
  };

  const selectGameForCoach = async (game: GameSummary) => {
    if (!diamondScoutToken || !deviceSession?.device?.id) return;
    setStatus("Loading game and scouting...");
    setSelectedGame(game);
    setDiamondScoutOpponentId(String(game.opponent_id));
    const deviceId = deviceSession.device.id;
    const cached = await scopedCache.read<ScoutingCache>(deviceId, game.id);
    if (cached) applyScoutingCache({ ...cached.value, source: "cache" });
    try {
      const client = new DiamondScoutClient(diamondScoutBaseUrl, diamondScoutToken);
      const [detail, lineup, current] = await Promise.all([
        client.game(game.id),
        client.lineupSummaries(game.id),
        client.currentHitter(game.id)
      ]);
      const currentHitter = contractCardToHitter(current.card);
      const mapped = lineup.summaries.map(contractSummaryToHitter);
      const hitters = mapped.some((hitter) => hitter.id === currentHitter.id)
        ? mapped.map((hitter) => (hitter.id === currentHitter.id ? currentHitter : hitter))
        : [currentHitter, ...mapped];
      const networkCache: ScoutingCache = {
        fetchedAt: Date.now(),
        hitters,
        opponentId: String(game.opponent_id),
        opponentName: game.opponent_name,
        schemaVersion: lineup.schema_version,
        source: "network"
      };
      applyScoutingCache(networkCache);
      setCurrentHitterId(String(current.hitter_id));
      setCurrentApiHitter(current);
      gameEventFactoryRef.current = new GameEventFactory(current, callId);
      await scopedCache.write(deviceId, game.id, networkCache);
      setLastNetworkEvent(`${detail.lineup.length} lineup entries cached at ${compactClock()}`);
      void client.telemetry("dugoutcall_game_selected", { source: "mobile" }).catch(() => undefined);
      await createRoom();
    } catch (error) {
      if (cached) {
        setLastNetworkEvent("Diamond offline; cached scouting loaded");
        await createRoom();
      } else {
        Alert.alert("Game not ready", error instanceof Error ? error.message : "Scouting could not be loaded.");
      }
    }
  };

  const createRoom = async () => {
    try {
      setStatus("Creating room...");
      const response = await requestJson<RoomResponse>("/rooms", {
        method: "POST",
        body: JSON.stringify({ coachName: "Coach", teamName: deviceSession?.program.name || "DugoutCall", mode: "game" })
      });
      setRoom(response);
      roomCodeRef.current = response.code;
      setCurrentRole("coach");
      setScreen("coach");
      connectSocket("coach", response, "Coach");
      await connectLiveKitVoice(response.livekit, "coach");
      if (diamondScoutToken) {
        void new DiamondScoutClient(diamondScoutBaseUrl, diamondScoutToken)
          .telemetry("dugoutcall_room_created", { status: "created" })
          .catch(() => undefined);
      }
    } catch (error) {
      Alert.alert("Could not create room", error instanceof Error ? error.message : "Try again.");
      setStatus("Create room failed");
    }
  };

  const joinRoom = async () => {
    const code = joinCode.trim();
    if (code.length !== 6) {
      Alert.alert("Enter a 6-digit room code");
      return;
    }

    try {
      setStatus("Joining room...");
      const response = await requestJson<RoomResponse>(`/rooms/${code}/join`, {
        method: "POST",
        body: JSON.stringify({ role: "catcher", displayName: "Catcher" })
      });
      setRoom(response);
      roomCodeRef.current = code;
      setCurrentRole("catcher");
      setScreen("catcher");
      setCatcherState("Connected");
      connectSocket("catcher", response, "Catcher");
      await connectLiveKitVoice(response.livekit, "catcher");
      speak("DugoutCall connected.");
    } catch (error) {
      Alert.alert("Could not join room", error instanceof Error ? error.message : "Try again.");
      setStatus("Join failed");
    }
  };

  const sendPitchCall = (pitch: string, location?: string) => {
    if (isTalking) {
      setStatus("Mic live: pitch send locked");
      setSendState("failed");
      triggerHaptic("send_fail");
      setTimeout(() => setSendState("idle"), 900);
      return false;
    }
    if (!pitch) {
      setStatus("Select a pitch first");
      setSendState("failed");
      triggerHaptic("send_fail");
      setTimeout(() => setSendState("idle"), 900);
      return false;
    }
    if (!location && pitch !== "Pickoff" && pitch !== "Pitchout") {
      setStatus("Select a location");
      setSendState("failed");
      triggerHaptic("send_fail");
      setTimeout(() => setSendState("idle"), 900);
      return false;
    }

    setSendState("sending");
    const message: PitchCallMessage = {
      type: "pitch_call",
      id: callId(),
      pitch,
      location,
      spokenText: phrase(pitch, location),
      timestamp: Date.now()
    };

    if (sendSocket(message)) {
      setLastCall(message);
      setStatus(`Sent: ${message.spokenText}`);
      setLastNetworkEvent(`Pitch sent at ${compactClock()}`);
      setSelectedPitch("");
      setSelectedLocation("");
      setSelectedContext("");
      setSendState("sent");
      triggerHaptic("send_success");
      if (selectedGame && currentApiHitter) setOutcomeVisible(true);
      if (diamondScoutToken) {
        void new DiamondScoutClient(diamondScoutBaseUrl, diamondScoutToken)
          .telemetry("dugoutcall_pitch_call_sent", { status: "relayed" })
          .catch(() => undefined);
      }
      setTimeout(() => setSendState("idle"), 900);
      return true;
    }
    setSendState("failed");
    triggerHaptic("send_fail");
    setTimeout(() => setSendState("idle"), 900);
    return false;
  };

  const refreshQueueStatus = async () => {
    const deviceId = deviceSession?.device?.id;
    if (!deviceId) return;
    const rows = await eventQueue.list(deviceId);
    const failed = rows.filter((row) => row.status === "failed").length;
    setQueueStatus(failed ? `${failed} failed · ${rows.length} pending` : rows.length ? `${rows.length} pending` : "Synced");
  };

  const syncQueuedOutcomes = async (force = false) => {
    const deviceId = deviceSession?.device?.id;
    if (!deviceId || !diamondScoutToken) return;
    const client = new DiamondScoutClient(diamondScoutBaseUrl, diamondScoutToken);
    const result = await eventQueue.flush(deviceId, (gameId, events) => client.postEvents(gameId, events), force);
    await refreshQueueStatus();
    if (result.pending || result.failed) {
      void client.telemetry("dugoutcall_sync_failed", { pending: result.pending, status: result.failed ? "failed" : "retrying" }).catch(() => undefined);
      return;
    }
    void client.telemetry("dugoutcall_sync_completed", { count: result.synced, pending: 0 }).catch(() => undefined);
    if (selectedGame) {
      try {
        const authoritative = await client.currentHitter(selectedGame.id);
        setCurrentApiHitter(authoritative);
        gameEventFactoryRef.current = new GameEventFactory(authoritative, callId);
        setCurrentHitterId(String(authoritative.hitter_id));
        await loadScoutingForGame("batter_advance");
      } catch {
        setLastNetworkEvent("Outcome synced; current-hitter refresh pending");
      }
    }
  };

  const optimisticOutcome = (current: CurrentHitter, outcome: QuickOutcome, lastSequence: number): CurrentHitter => {
    let balls = current.count.balls;
    let strikes = current.count.strikes;
    if (outcome === "ball") balls += 1;
    if (["called_strike", "swinging_strike", "foul_bunt"].includes(outcome)) strikes += 1;
    if (outcome === "foul" && strikes < 2) strikes += 1;
    const terminal = balls >= 4 || strikes >= 3 || outcome === "hbp" || outcome === "in_play";
    if (!terminal) {
      return {
        ...current,
        pa_started: true,
        pitch_sequence: current.pitch_sequence + 1,
        last_event_sequence: lastSequence,
        count: { balls, strikes, label: `${balls}-${strikes}`, server_authoritative: true }
      };
    }
    const next = scoutingHitters[(currentScoutingIndex + 1) % Math.max(scoutingHitters.length, 1)];
    return {
      ...current,
      lineup_slot: next ? ((current.lineup_slot % scoutingHitters.length) + 1) : current.lineup_slot,
      hitter_id: next ? Number(next.id) : current.hitter_id,
      plate_appearance_key: `offline-g${current.game_id}-${callId()}`,
      pa_started: false,
      pitch_sequence: 0,
      last_event_sequence: lastSequence,
      count: { balls: 0, strikes: 0, label: "0-0", server_authoritative: true }
    };
  };

  const confirmOutcome = async (outcome: QuickOutcome, detail?: InPlayDetail) => {
    const deviceId = deviceSession?.device?.id;
    const factory = gameEventFactoryRef.current;
    if (!deviceId || !selectedGame || !factory || !currentApiHitter || !lastCall) return;
    try {
      const start = factory.beginPlateAppearance();
      const pitch = factory.confirmedPitch(outcome, detail, lastCall.id);
      for (const event of [start, pitch].filter(Boolean)) {
        await eventQueue.enqueue(deviceId, selectedGame.id, event!);
      }
      const optimistic = optimisticOutcome(currentApiHitter, outcome, pitch.sequence);
      setCurrentApiHitter(optimistic);
      gameEventFactoryRef.current = new GameEventFactory(optimistic, callId);
      setCurrentHitterId(String(optimistic.hitter_id));
      setOutcomeVisible(false);
      setInPlayMode(false);
      setInPlayDraft({});
      setQueueStatus("Pending sync");
      await syncQueuedOutcomes(true);
    } catch (error) {
      setOutcomeVisible(false);
      setQueueStatus("Pending sync");
      await refreshQueueStatus();
      setLastNetworkEvent(error instanceof Error ? `Outcome queued: ${error.message}` : "Outcome queued for retry");
    }
  };

  const repeatLast = () => {
    if (!lastCall) {
      setStatus("No previous call");
      return;
    }
    sendPitchCall(lastCall.pitch, lastCall.location);
  };

  const receivePitchCall = (spokenText: string) => {
    setCatcherState("Waiting for call");
    setLastHeard(spokenText);
    speak(spokenText);
  };

  const speak = (text: string) => {
    void (async () => {
      try {
        await configureAudioForPlayback();
        const now = Date.now();
        if (now - lastSpeechAtRef.current < 2000) Speech.stop();
        lastSpeechAtRef.current = now;
        setVoiceStatus("Speaking test/call audio");
        Speech.speak(text, {
          onDone: () => setVoiceStatus("Audio playback ready"),
          onError: () => setVoiceStatus("Speech playback failed"),
          onStopped: () => setVoiceStatus("Audio playback ready"),
          pitch: 1,
          rate: 0.48,
          volume: 1
        });
      } catch (error) {
        setVoiceStatus("Audio setup failed");
        setStatus(error instanceof Error ? error.message : "Audio setup failed");
      }
    })();
  };

  const playTestAudio = () => {
    setLastHeard("Playing test audio...");
    setLastNetworkEvent(`Test audio tapped at ${compactClock()}`);
    void playTone()
      .then(() => {
        setTimeout(() => speak("DugoutCall connected."), 450);
      })
      .catch((error) => {
        setVoiceStatus("Tone playback failed");
        setStatus(error instanceof Error ? error.message : "Tone playback failed");
        speak("DugoutCall connected.");
      });
  };

  const startTalk = async () => {
    if (roleRef.current !== "coach") return;
    if (isTalking) return;
    if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
      setStatus("Connect catcher before talking");
      return;
    }

    try {
      const liveKitRoom = liveKitRoomRef.current;
      if (!liveKitRoom || liveKitRoom.state !== LiveKitConnectionState.Connected) {
        setVoiceStatus("LiveKit voice not connected");
        setStatus("LiveKit voice not connected");
        return;
      }

      setVoiceStatus("Starting LiveKit microphone...");
      await configureLiveKitAudio("coach");
      await liveKitRoom.localParticipant.setMicrophoneEnabled(true, {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      } as any);
      setIsTalking(true);
      setStatus("Live voice on");
      setVoiceStatus("LiveKit transmitting");
      triggerHaptic("mic_open");
      updateVoiceDiagnostics({
        micActive: true,
        publishingAudio: true,
        localAudioTracks: 1
      });
      sendSocket({ type: "ptt_start", timestamp: Date.now() });
      if (talkTimeoutRef.current) clearTimeout(talkTimeoutRef.current);
      talkTimeoutRef.current = setTimeout(() => {
        triggerHaptic("mic_cutoff");
        stopTalk();
        setStatus("Mic auto-cutoff at 15 seconds");
      }, 15000);
    } catch (error) {
      setIsTalking(false);
      setVoiceStatus("Microphone unavailable");
      Alert.alert(
        "Push-to-talk unavailable",
        error instanceof Error ? error.message : "Check microphone permission and try again."
      );
    }
  };

  const stopTalk = () => {
    if (!isTalking) return;
    if (talkTimeoutRef.current) {
      clearTimeout(talkTimeoutRef.current);
      talkTimeoutRef.current = null;
    }
    void liveKitRoomRef.current?.localParticipant.setMicrophoneEnabled(false);
    setIsTalking(false);
    setStatus("Live voice off");
    setVoiceStatus("LiveKit voice ready");
    triggerHaptic("mic_close");
    updateVoiceDiagnostics({ micActive: false, publishingAudio: false });
    sendSocket({ type: "ptt_stop", timestamp: Date.now() });
  };

  const toggleForceSpeaker = () => {
    const nextValue = !forceSpeaker;
    setForceSpeaker(nextValue);
    setVoiceDiagnostics((current) => ({
      ...current,
      outputRoute: nextValue ? "LiveKit: force speaker" : "LiveKit: system route"
    }));
    if (liveKitRoomRef.current) {
      void configureLiveKitAudio(roleRef.current ?? "catcher", nextValue)
        .then(() => LiveKitAudioSession.selectAudioOutput(nextValue ? "force_speaker" : "default"))
        .catch(() => setVoiceStatus("Speaker route change failed"));
    } else if (roleRef.current === "catcher") {
      void configureAudioForVoiceReceive("voice receive", nextValue);
    }
  };

  const reset = () => {
    Speech.stop();
    disconnectSocket();
    setRoom(null);
    setCurrentRole(null);
    roomCodeRef.current = "";
    setScreen("role");
    setStatus("Ready");
    setCatcherState("Waiting for call");
    setLastHeard("No pitch call yet.");
    setLastNetworkEvent("No room joined");
    setDiagnosticChecks(initialDiagnosticChecks);
    setLastServerDiagnostics("No server diagnostics fetched");
  };

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.flex}>
        {screen !== "coach" && (
          <View style={styles.header}>
            <View>
              <Text style={styles.title}>DugoutCall</Text>
              <Text style={styles.subtitle}>Game Mode: one-way coach-to-catcher communication</Text>
            </View>
            <View style={[styles.badge, connection === "connected" && styles.badgeConnected]}>
              <Text style={styles.badgeText}>{connection === "connected" ? "Online" : status}</Text>
            </View>
          </View>
        )}

        {screen === "role" && (
          <ScrollView contentContainerStyle={styles.content}>
            <View style={styles.notice}>
              <Text style={styles.noticeText}>
                Use only where permitted by your league/state association. AirPods must be paired to the catcher iPhone.
              </Text>
            </View>

            <TestModePanel
              checks={diagnosticChecks}
              isRunning={isRunningDiagnostics}
              lastServerDiagnostics={lastServerDiagnostics}
              onRun={runDiagnostics}
            />

            <Pressable style={styles.primaryButton} onPress={beginCoachFlow}>
              <Text style={styles.primaryButtonText}>Coach Mode</Text>
              <Text style={styles.buttonSubtext}>Pair with Diamond · select game · create room</Text>
            </Pressable>
            {__DEV__ && (
              <Pressable style={styles.scoutButton} onPress={() => setScreen("diamondScout")}>
                <Text style={styles.scoutButtonText}>Developer diagnostics</Text>
                <Text style={styles.buttonSubtext}>Debug-only Diamond configuration</Text>
              </Pressable>
            )}
            <Pressable
              style={styles.secondaryButton}
              onPress={() => {
                setCurrentRole(null);
                setScreen("catcher");
              }}
            >
              <Text style={styles.secondaryButtonText}>Catcher Mode</Text>
              <Text style={styles.buttonSubtext}>Join with code</Text>
            </Pressable>
          </ScrollView>
        )}

        {screen === "pair" && (
          <ScrollView contentContainerStyle={styles.content}>
            <Text style={styles.screenTitle}>Pair with Diamond Scout</Text>
            <Text style={styles.helper}>
              In Diamond Scout, open Settings → DugoutCall and generate a one-time code. Codes expire after 10 minutes.
            </Text>
            <Text style={styles.label}>8-character pairing code</Text>
            <TextInput
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={10}
              onChangeText={setPairingCode}
              placeholder="ABCD 2345"
              placeholderTextColor="#718078"
              style={styles.input}
              value={pairingCode}
            />
            <Pressable style={styles.primaryButton} disabled={pairingBusy} onPress={pairDevice}>
              <Text style={styles.primaryButtonText}>{pairingBusy ? "Pairing…" : "Pair coach iPhone"}</Text>
              <Text style={styles.buttonSubtext}>Credential stays in iOS SecureStore</Text>
            </Pressable>
            <Pressable style={styles.secondaryButton} onPress={() => setScreen("role")}>
              <Text style={styles.secondaryButtonText}>Back</Text>
            </Pressable>
          </ScrollView>
        )}

        {screen === "games" && (
          <ScrollView contentContainerStyle={styles.content}>
            <Text style={styles.screenTitle}>{deviceSession?.program.name || "Diamond Scout"}</Text>
            <Text style={styles.helper}>Select the upcoming or active game. Scouting is cached before the room opens.</Text>
            {availableGames.length === 0 && (
              <View style={styles.notice}><Text style={styles.noticeText}>No Diamond games are available for this team.</Text></View>
            )}
            {availableGames.map((game) => (
              <Pressable key={game.id} style={styles.primaryButton} onPress={() => selectGameForCoach(game)}>
                <Text style={styles.primaryButtonText}>{game.opponent_name}</Text>
                <Text style={styles.buttonSubtext}>{game.game_date || "Date TBD"} · {game.home_away} · {game.status}</Text>
              </Pressable>
            ))}
            <Pressable style={styles.secondaryButton} onPress={unpairDevice}>
              <Text style={styles.secondaryButtonText}>Unpair and remove local scouting</Text>
            </Pressable>
          </ScrollView>
        )}

        {screen === "coach" && (
          <CoachScreen
            code={room?.code ?? "------"}
            currentPhrase={currentPhrase}
            currentHitter={currentScoutingHitter}
            scoutingSource={scoutingCache.source}
            scoutingMetaLabel={scoutingMetaLabel}
            opponentName={scoutingCache.opponentName}
            onDeckHitter={onDeckScoutingHitter}
            pitchButtons={pitchButtons}
            scoutAvailable={scoutAvailable}
            scoutEnabled={scoutEnabled}
            isTalking={isTalking}
            lastStatus={status}
            sendState={sendState}
            voiceStatus={voiceStatus}
            voiceDiagnostics={voiceDiagnostics}
            diagnosticChecks={diagnosticChecks}
            isRunningDiagnostics={isRunningDiagnostics}
            lastServerDiagnostics={lastServerDiagnostics}
            onRunDiagnostics={runDiagnostics}
            onClear={() => {
              setSelectedPitch("");
              setSelectedLocation("");
              setSelectedContext("");
            }}
            onRepeat={repeatLast}
            onReset={reset}
            onSend={() => sendPitchCall(selectedPitch, selectedLocation)}
            onAdvanceHitter={advanceHitter}
            onRefreshScouting={() => loadScoutingForGame("manual")}
            onToggleScout={toggleScout}
            onUpdatePitchButtons={(values) => setPitchButtons(normalizePitchButtons(values))}
            onStartTalk={startTalk}
            onStopTalk={stopTalk}
            openDiamondScout={() => setScreen("diamondScout")}
            lastNetworkEvent={lastNetworkEvent}
            selectedContext={selectedContext}
            selectedLocation={selectedLocation}
            selectedPitch={selectedPitch}
            setSelectedContext={setSelectedContext}
            setSelectedLocation={setSelectedLocation}
            setSelectedPitch={setSelectedPitch}
            sendPreset={sendPitchCall}
          />
        )}

        {screen === "diamondScout" && (
          <DiamondScoutScreen
            apiBaseUrl={diamondScoutBaseUrl}
            bearerToken={diamondScoutToken}
            cacheOnly={diamondScoutCacheOnly}
            mockMode={effectiveDiamondScoutMockMode}
            onBack={() => setScreen("role")}
            opponentId={diamondScoutOpponentId}
            scoutingCache={scoutingCache}
            scoutingMetrics={scoutingMetrics}
            onRefreshScouting={() => loadScoutingForGame("manual")}
            setApiBaseUrl={setDiamondScoutBaseUrl}
            setBearerToken={setDiamondScoutToken}
            setCacheOnly={setDiamondScoutCacheOnly}
            setMockMode={setDiamondScoutMockMode}
            setOpponentId={setDiamondScoutOpponentId}
          />
        )}

        {screen === "catcher" && (
          <CatcherScreen
            code={room?.code ?? joinCode}
            catcherState={catcherState}
            joinCode={joinCode}
            joined={role === "catcher" && Boolean(room)}
            lastHeard={lastHeard}
            lastNetworkEvent={lastNetworkEvent}
            remoteStream={remoteStream}
            remoteStreamUrl={remoteStreamUrl}
            role={role}
            setJoinCode={setJoinCode}
            joinRoom={joinRoom}
            reset={reset}
            testAudio={playTestAudio}
            forceSpeaker={forceSpeaker}
            toggleForceSpeaker={toggleForceSpeaker}
            voiceStatus={voiceStatus}
            voiceDiagnostics={voiceDiagnostics}
            diagnosticChecks={diagnosticChecks}
            isRunningDiagnostics={isRunningDiagnostics}
            lastServerDiagnostics={lastServerDiagnostics}
            onRunDiagnostics={runDiagnostics}
          />
        )}
        <Modal animationType="slide" transparent visible={outcomeVisible} onRequestClose={() => setOutcomeVisible(false)}>
          <View style={styles.outcomeBackdrop}>
            <ScrollView contentContainerStyle={styles.outcomeCard}>
              <Text style={styles.screenTitle}>{inPlayMode ? "Confirm ball in play" : "Record actual result?"}</Text>
              <Text style={styles.helper}>The pitch call was relayed. Diamond changes only after you confirm what actually happened.</Text>
              {!inPlayMode ? (
                <View style={styles.zoneGrid}>
                  {([
                    ["ball", "Ball"],
                    ["called_strike", "Called strike"],
                    ["swinging_strike", "Swinging strike"],
                    ["foul", "Foul"],
                    ["foul_bunt", "Foul bunt"],
                    ["hbp", "Hit by pitch"]
                  ] as Array<[QuickOutcome, string]>).map(([value, label]) => (
                    <Pressable key={value} style={styles.tile} onPress={() => confirmOutcome(value)}>
                      <Text style={styles.tileText}>{label}</Text>
                    </Pressable>
                  ))}
                  <Pressable style={styles.tile} onPress={() => setInPlayMode(true)}>
                    <Text style={styles.tileText}>In play</Text>
                  </Pressable>
                </View>
              ) : (
                <>
                  <Text style={styles.label}>Plate appearance result</Text>
                  <View style={styles.zoneGrid}>
                    {(["single", "double", "triple", "home_run", "field_out", "fielders_choice", "error", "sac_fly", "sac_bunt"] as InPlayDetail["paResult"][]).map((value) => (
                      <Pressable
                        key={value}
                        style={[styles.tile, inPlayDraft.paResult === value && styles.tileSelected]}
                        onPress={() => setInPlayDraft((current) => ({ ...current, paResult: value }))}
                      ><Text style={[styles.tileText, inPlayDraft.paResult === value && styles.tileTextSelected]}>{value.replaceAll("_", " ")}</Text></Pressable>
                    ))}
                  </View>
                  <Text style={styles.label}>Batted-ball type</Text>
                  <View style={styles.zoneGrid}>
                    {(["GB", "LD", "FB", "PU", "Bunt"] as InPlayDetail["battedBall"][]).map((value) => (
                      <Pressable
                        key={value}
                        style={[styles.tile, inPlayDraft.battedBall === value && styles.tileSelected]}
                        onPress={() => setInPlayDraft((current) => ({ ...current, battedBall: value }))}
                      ><Text style={[styles.tileText, inPlayDraft.battedBall === value && styles.tileTextSelected]}>{value}</Text></Pressable>
                    ))}
                  </View>
                  <Text style={styles.label}>Field location</Text>
                  <View style={styles.zoneGrid}>
                    {(["left_side", "middle", "right_side"] as const).map((value) => (
                      <Pressable
                        key={value}
                        style={[styles.tile, inPlayDraft.fieldLocation === value && styles.tileSelected]}
                        onPress={() => setInPlayDraft((current) => ({ ...current, fieldLocation: value }))}
                      ><Text style={[styles.tileText, inPlayDraft.fieldLocation === value && styles.tileTextSelected]}>{value.replace("_", " ")}</Text></Pressable>
                    ))}
                  </View>
                  <Pressable
                    disabled={!inPlayDraft.paResult || !inPlayDraft.battedBall || !inPlayDraft.fieldLocation}
                    style={styles.primaryButton}
                    onPress={() => confirmOutcome("in_play", inPlayDraft as InPlayDetail)}
                  ><Text style={styles.primaryButtonText}>Confirm in-play result</Text></Pressable>
                </>
              )}
              <Pressable
                style={styles.secondaryButton}
                onPress={() => { setOutcomeVisible(false); setInPlayMode(false); setInPlayDraft({}); }}
              ><Text style={styles.secondaryButtonText}>Skip — not charting</Text></Pressable>
              {queueStatus !== "Synced" && (
                <Pressable style={styles.secondaryButton} onPress={() => syncQueuedOutcomes(true)}>
                  <Text style={styles.secondaryButtonText}>Diamond sync: {queueStatus} · retry now</Text>
                </Pressable>
              )}
            </ScrollView>
          </View>
        </Modal>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function CoachScreen(props: {
  code: string;
  currentPhrase: string;
  currentHitter: ScoutHitter;
  isTalking: boolean;
  lastStatus: string;
  lastNetworkEvent: string;
  opponentName: string;
  onDeckHitter: ScoutHitter;
  pitchButtons: string[];
  scoutAvailable: boolean;
  scoutEnabled: boolean;
  scoutingMetaLabel: string;
  scoutingSource: ScoutingSource;
  sendState: SendState;
  onAdvanceHitter: () => void;
  onClear: () => void;
  onRepeat: () => void;
  onReset: () => void;
  onRefreshScouting: () => void;
  onSend: () => void;
  onStartTalk: () => void;
  onStopTalk: () => void;
  onToggleScout: () => void;
  onUpdatePitchButtons: (values: string[]) => void;
  openDiamondScout: () => void;
  selectedContext: string;
  selectedLocation: string;
  selectedPitch: string;
  setSelectedContext: (value: string) => void;
  setSelectedLocation: (value: string) => void;
  setSelectedPitch: (value: string) => void;
  sendPreset: (pitch: string, location?: string) => void;
  voiceStatus: string;
  voiceDiagnostics: VoiceDiagnostics;
  diagnosticChecks: DiagnosticCheck[];
  isRunningDiagnostics: boolean;
  lastServerDiagnostics: string;
  onRunDiagnostics: () => void;
}) {
  const [reportOpen, setReportOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pitchDraft, setPitchDraft] = useState(props.pitchButtons);
  const currentHitter = props.currentHitter;
  const scoutActive = props.scoutEnabled && props.scoutAvailable;
  const zoneCells = [
    { label: "Up/In", value: "Up/In", tint: scoutActive ? currentHitter.zoneTints[0] : "none" },
    { label: "Up", value: "Up", tint: scoutActive ? currentHitter.zoneTints[1] : "none" },
    { label: "Up/Away", value: "Up/Away", tint: scoutActive ? currentHitter.zoneTints[2] : "none" },
    { label: "In", value: "In", tint: scoutActive ? currentHitter.zoneTints[3] : "none" },
    { label: "Middle", value: "Middle", tint: scoutActive ? currentHitter.zoneTints[4] : "none" },
    { label: "Away", value: "Away", tint: scoutActive ? currentHitter.zoneTints[5] : "none" },
    { label: "Down/In", value: "Down/In", tint: scoutActive ? currentHitter.zoneTints[6] : "none" },
    { label: "Down", value: "Down", tint: scoutActive ? currentHitter.zoneTints[7] : "none" },
    { label: "Down/Away", value: "Down/Away", tint: scoutActive ? currentHitter.zoneTints[8] : "none" }
  ];
  const countBucket = countBucketForLabel(diamondScoutMock.count);
  const filteredChips = currentHitter.chips
    .filter((chip) => chip.countBucket === "any" || chip.countBucket === countBucket)
    .slice(0, 3);
  const pitchOptions = [...props.pitchButtons.filter((pitch) => pitch.toLowerCase() !== "pickoff"), "Pickoff"];
  const specialPitch = props.selectedPitch === "Pickoff" || props.selectedPitch === "Pitchout";
  const canSend = Boolean(props.selectedPitch && (props.selectedLocation || specialPitch) && !props.isTalking);
  const sendLabel = props.isTalking
    ? "Mic live to catcher"
    : !canSend
      ? "Select pitch + location"
      : `Send ${shortPitch(props.selectedPitch)}${props.selectedLocation ? ` | ${props.selectedLocation}` : ""}`;
  const sequenceLabel = diamondScoutMock.count === "0-0" ? "" : "FB Away C | CB Down W";

  useEffect(() => {
    if (settingsOpen) setPitchDraft(props.pitchButtons);
  }, [props.pitchButtons, settingsOpen]);

  const updatePitchDraft = (index: number, value: string) => {
    setPitchDraft((current) => current.map((pitch, pitchIndex) => (pitchIndex === index ? value : pitch)));
  };

  const addPitchDraft = () => {
    setPitchDraft((current) => (current.length >= 6 ? current : [...current, ""]));
  };

  const removePitchDraft = (index: number) => {
    setPitchDraft((current) => current.filter((_, pitchIndex) => pitchIndex !== index));
  };

  const savePitchDraft = () => {
    props.onUpdatePitchButtons(pitchDraft);
    setSettingsOpen(false);
  };

  return (
    <View style={styles.callSurface}>
      <View style={styles.callHeader}>
        <View style={styles.callHeaderTop}>
          <View style={styles.callHeaderMain}>
            <Text style={styles.callOpponent} numberOfLines={1}>
              {props.opponentName}
            </Text>
            <Text style={styles.callGameState} numberOfLines={1}>
              {diamondScoutMock.score} | Room {props.code}
            </Text>
          </View>
          <Pressable style={styles.gearButton} onPress={() => setSettingsOpen(true)} accessibilityLabel="Settings">
            <Text style={styles.gearButtonText}>SET</Text>
          </Pressable>
        </View>
        <View style={styles.callStatusRow}>
          <View style={styles.countChip}>
            <Text style={styles.countChipText}>{diamondScoutMock.count}</Text>
          </View>
          <View style={styles.pitchCountChip}>
            <Text style={styles.pitchCountText}>PC 42</Text>
          </View>
          <View style={styles.scoutSwitch}>
            <Text style={styles.scoutSwitchText}>Scout</Text>
            <Switch
              accessibilityLabel="Scout overlay"
              disabled={!props.scoutAvailable}
              onValueChange={props.onToggleScout}
              thumbColor={scoutActive ? "#185fa5" : "#8d8a82"}
              trackColor={{ false: "#e0ded7", true: "#a9c9e2" }}
              value={scoutActive}
            />
          </View>
          <View style={styles.surfaceMockBadge}>
            <Text style={styles.surfaceMockBadgeText}>
              {props.scoutingSource === "network" ? "LIVE DATA" : props.scoutingSource === "cache" ? "CACHE" : "MOCK DATA"}
            </Text>
          </View>
          <View style={[styles.relayDot, props.lastStatus.includes("connected") && styles.relayDotOnline]} />
        </View>
      </View>

      <Pressable
        disabled={!scoutActive}
        style={[styles.surfaceHitterCard, !scoutActive && styles.cleanHitterCard]}
        onPress={() => setReportOpen(true)}
      >
        {scoutActive ? (
          <>
            <View style={styles.surfaceHitterLeft}>
              <Text style={styles.surfaceEyebrow}>#{currentHitter.jersey} | Bats {currentHitter.bats}</Text>
              <Text style={styles.surfaceHitterName} numberOfLines={1}>
                {currentHitter.name}
              </Text>
              <Text style={styles.surfaceVerdict} numberOfLines={1}>
                {currentHitter.verdict}
              </Text>
              <View style={styles.chipRow}>
                {(filteredChips.length ? filteredChips : [{ text: "Pitch strengths", countBucket: "any" as const }]).map((chip) => (
                  <View style={styles.attackChip} key={chip.text}>
                    <Text style={styles.attackChipText}>{chip.text}</Text>
                  </View>
                ))}
              </View>
            </View>
            <View style={styles.surfaceSprayColumn}>
              <SprayFan spray={currentHitter.spray} />
              <Text style={styles.defenseCaption} numberOfLines={1}>
                {currentHitter.defensiveNote}
              </Text>
            </View>
          </>
        ) : (
          <View style={styles.surfaceHitterLeft}>
            <Text style={styles.surfaceEyebrow}>#{currentHitter.jersey} | Bats {currentHitter.bats}</Text>
            <Text style={styles.surfaceHitterName} numberOfLines={1}>
              {currentHitter.name}
            </Text>
            <Text style={styles.cleanHitterMeta} numberOfLines={1}>
              Next {props.onDeckHitter.name}
            </Text>
          </View>
        )}
      </Pressable>

      <View style={styles.zoneHeader}>
        <Text style={styles.zoneLegend}>{scoutActive ? "Blue dot = attack | Red X = avoid" : "Target zone"}</Text>
        <Text style={styles.statusMini} numberOfLines={1}>
          {props.scoutingMetaLabel} | {props.lastStatus}
        </Text>
      </View>
      <View style={styles.zoneGrid}>
        {zoneCells.map((cell, index) => (
          <HeatZoneTile
            key={cell.value}
            label={cell.label}
            expanded={!scoutActive}
            selected={props.selectedLocation === cell.value}
            tint={cell.tint}
            recommended={scoutActive && currentHitter.recommendedZone === index + 1}
            onPress={() => props.setSelectedLocation(props.selectedLocation === cell.value ? "" : cell.value)}
          />
        ))}
      </View>

      <View style={styles.sequenceStrip}>
        <Text style={styles.sequenceText} numberOfLines={1}>
          {sequenceLabel || "No pitches this at-bat"}
        </Text>
      </View>

      <View style={styles.pitchRow}>
        {pitchOptions.map((pitch) => (
          <PitchOption
            key={pitch}
            label={pitch}
            selected={props.selectedPitch === pitch}
            recommended={scoutActive && currentHitter.recommendedPitch === pitch}
            onPress={() => props.setSelectedPitch(props.selectedPitch === pitch ? "" : pitch)}
          />
        ))}
      </View>

      <View style={[styles.sendMicRow, props.isTalking && styles.sendMicRowLive]}>
        <Pressable
          disabled={!canSend || props.sendState === "sending"}
          onPress={props.onSend}
          style={[
            styles.surfaceSendButton,
            canSend && styles.surfaceSendButtonReady,
            props.sendState === "sent" && styles.surfaceSendButtonSent,
            props.sendState === "failed" && styles.surfaceSendButtonFailed,
            props.isTalking && styles.surfaceSendButtonLive
          ]}
        >
          <Text style={styles.surfaceSendText} numberOfLines={1}>
            {props.sendState === "sending" ? "Sending..." : props.sendState === "sent" ? "Sent" : sendLabel}
          </Text>
        </Pressable>
        <Pressable
          accessibilityLabel="Hold to talk"
          onPressIn={props.onStartTalk}
          onPressOut={props.onStopTalk}
          style={[styles.surfaceMicButton, props.isTalking && styles.surfaceMicButtonLive]}
        >
          <Text style={styles.surfaceMicIcon}>{props.isTalking ? "LIVE" : "MIC"}</Text>
        </Pressable>
      </View>

      <View style={styles.utilityRow}>
        <Pressable style={styles.utilityButton} onPress={props.onRepeat}>
          <Text style={styles.utilityText}>Repeat</Text>
        </Pressable>
        <Pressable style={styles.utilityButton} onPress={props.onAdvanceHitter}>
          <Text style={styles.utilityText} numberOfLines={1}>
            Next: {props.onDeckHitter.name}
          </Text>
        </Pressable>
        <Pressable style={styles.utilityButton} onPress={props.onRefreshScouting}>
          <Text style={styles.utilityText}>Refresh</Text>
        </Pressable>
        <Pressable style={styles.utilityButton} onPress={props.onClear}>
          <Text style={styles.utilityText}>Clear</Text>
        </Pressable>
      </View>

      <Modal animationType="slide" transparent visible={reportOpen} onRequestClose={() => setReportOpen(false)}>
        <View style={styles.reportSheetBackdrop}>
          <View style={styles.reportSheet}>
            <View style={styles.reportSheetHeader}>
              <View style={styles.flex}>
                <Text style={styles.surfaceEyebrow}>Full scout report</Text>
                <Text style={styles.surfaceHitterName} numberOfLines={1}>
                  {currentHitter.name}
                </Text>
              </View>
              <Pressable style={styles.reportCloseButton} onPress={() => setReportOpen(false)}>
                <Text style={styles.utilityText}>Done</Text>
              </Pressable>
            </View>
            <ScoutPlanCard hitter={currentHitter} />
            <View style={styles.scoutGrid}>
              <View style={styles.scoutMiniCard}>
                <Text style={styles.scoutMiniTitle}>Spray</Text>
                <Text style={styles.scoutListMeta}>{spraySummaryText(currentHitter.spray)}</Text>
              </View>
              <View style={styles.scoutMiniCard}>
                <Text style={styles.scoutMiniTitle}>Defense</Text>
                <Text style={styles.scoutListMeta}>{currentHitter.defensiveNote}</Text>
              </View>
            </View>
          </View>
        </View>
      </Modal>

      <Modal animationType="slide" transparent visible={settingsOpen} onRequestClose={() => setSettingsOpen(false)}>
        <View style={styles.settingsSheetBackdrop}>
          <View style={styles.settingsSheet}>
            <View style={styles.reportSheetHeader}>
              <View style={styles.flex}>
                <Text style={styles.surfaceEyebrow}>Settings</Text>
                <Text style={styles.settingsTitle}>Pitch buttons</Text>
              </View>
              <Pressable style={styles.settingsCloseButton} onPress={() => setSettingsOpen(false)}>
                <Text style={styles.settingsSecondaryText}>Done</Text>
              </Pressable>
            </View>
            <Text style={styles.settingsHelp}>
              These buttons are the coach pitch row. Changes save on this device and apply immediately.
            </Text>
            <View style={styles.pitchEditorList}>
              {pitchDraft.map((pitch, index) => (
                <View style={styles.pitchEditorRow} key={`pitch-draft-${index}`}>
                  <TextInput
                    autoCapitalize="words"
                    autoCorrect={false}
                    onChangeText={(value) => updatePitchDraft(index, value)}
                    placeholder={`Pitch ${index + 1}`}
                    placeholderTextColor="#9c9a93"
                    style={styles.pitchEditorInput}
                    value={pitch}
                  />
                  <Pressable
                    accessibilityLabel={`Remove pitch ${index + 1}`}
                    disabled={pitchDraft.length <= 1}
                    onPress={() => removePitchDraft(index)}
                    style={[styles.pitchEditorRemove, pitchDraft.length <= 1 && styles.pitchEditorRemoveDisabled]}
                  >
                    <Text style={styles.pitchEditorRemoveText}>-</Text>
                  </Pressable>
                </View>
              ))}
            </View>
            <View style={styles.settingsActionRow}>
              <Pressable disabled={pitchDraft.length >= 6} onPress={addPitchDraft} style={styles.settingsSecondaryButton}>
                <Text style={styles.settingsSecondaryText}>Add Pitch</Text>
              </Pressable>
              <Pressable onPress={() => setPitchDraft(defaultPitchButtons)} style={styles.settingsSecondaryButton}>
                <Text style={styles.settingsSecondaryText}>Defaults</Text>
              </Pressable>
            </View>
            <Pressable onPress={savePitchDraft} style={styles.settingsPrimaryButton}>
              <Text style={styles.settingsPrimaryText}>Save Pitch Buttons</Text>
            </Pressable>
            <Pressable onPress={props.onReset} style={styles.settingsDangerButton}>
              <Text style={styles.settingsDangerText}>Exit Room</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function SprayFan({ spray }: { spray: SprayPayload }) {
  if (!spray) {
    return (
      <View style={[styles.shadeChart, styles.sprayFanEmpty]}>
        <Text style={styles.sprayEmptyText}>No spray</Text>
      </View>
    );
  }

  const totals = sprayTotals(spray);
  const lanes = [
    { key: "pull", label: "PULL", value: totals.pull },
    { key: "center", label: "CTR", value: totals.center },
    { key: "oppo", label: "OPPO", value: totals.oppo }
  ];
  const maxValue = Math.max(1, ...lanes.map((lane) => lane.value));
  const dominant = lanes.reduce((leader, lane) => (lane.value > leader.value ? lane : leader), lanes[0]);

  return (
    <View style={styles.shadeChart}>
      <View style={styles.shadeHeader}>
        <Text style={styles.shadeHeaderText}>SHADE</Text>
        <Text style={styles.shadeHeaderSide}>{dominant.label}</Text>
      </View>
      <View style={styles.shadeField}>
        <View style={[styles.shadeFoulLine, styles.shadeFoulLineLeft]} />
        <View style={[styles.shadeFoulLine, styles.shadeFoulLineRight]} />
        <View style={styles.shadeLanes}>
          {lanes.map((lane) => {
            const isDominant = lane.key === dominant.key;
            const height = 20 + Math.round((lane.value / maxValue) * 34);
            return (
              <View style={styles.shadeLane} key={lane.key}>
                <View
                  style={[
                    styles.shadeLaneFill,
                    isDominant && styles.shadeLaneFillDominant,
                    { height, opacity: shadeOpacity(lane.value, maxValue) }
                  ]}
                />
              </View>
            );
          })}
        </View>
        <View style={styles.shadeHomePlate} />
      </View>
      <View style={styles.shadeLabels}>
        {lanes.map((lane) => (
          <View style={styles.shadeLabelCell} key={lane.key}>
            <Text style={styles.shadeLabelText}>{lane.label}</Text>
            <Text style={[styles.shadeValueText, lane.key === dominant.key && styles.shadeValueDominant]}>
              {lane.value}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function HeatZoneTile({
  expanded,
  label,
  onPress,
  recommended,
  selected,
  tint
}: {
  expanded?: boolean;
  label: string;
  onPress: () => void;
  recommended?: boolean;
  selected?: boolean;
  tint: "hot" | "cold" | "none";
}) {
  return (
    <Pressable
      accessibilityLabel={`Location ${label}${tint === "cold" ? ", attack" : tint === "hot" ? ", avoid" : ""}`}
      onPress={onPress}
      style={[
        styles.heatTile,
        expanded && styles.heatTileExpanded,
        tint === "cold" && styles.heatTileCold,
        tint === "hot" && styles.heatTileHot,
        recommended && styles.heatTileRecommended,
        selected && styles.heatTileSelected
      ]}
    >
      <Text style={[styles.heatGlyph, tint === "hot" && styles.heatGlyphHot]}>
        {tint === "cold" ? "●" : tint === "hot" ? "×" : ""}
      </Text>
      <Text style={styles.heatTileText} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

function PitchOption({
  label,
  onPress,
  recommended,
  selected
}: {
  label: string;
  onPress: () => void;
  recommended?: boolean;
  selected?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.pitchPill, recommended && styles.pitchPillRecommended, selected && styles.pitchPillSelected]}
    >
      <Text style={[styles.pitchPillText, selected && styles.pitchPillTextSelected]} numberOfLines={1}>
        {recommended ? "★ " : ""}
        {shortPitch(label)}
      </Text>
    </Pressable>
  );
}

function countBucketForLabel(label: string): "early" | "two_strikes" | "any" {
  const parts = label.split("-");
  const strikes = Number(parts[1] ?? 0);
  if (strikes >= 2) return "two_strikes";
  if (label === "0-0" || label === "1-0" || label === "0-1") return "early";
  return "any";
}

function shortPitch(pitch: string) {
  const normalized = pitch.trim().toLowerCase();
  if (normalized === "fastball") return "FB";
  if (normalized === "curveball" || normalized === "curve") return "CB";
  if (normalized === "change-up" || normalized === "changeup" || normalized === "change") return "CH";
  if (normalized === "slider") return "SL";
  if (normalized === "cutter" || normalized === "cut") return "CT";
  if (normalized === "splitter" || normalized === "split") return "SP";
  if (normalized === "sinker") return "SNK";
  if (normalized === "two-seam" || normalized === "2-seam") return "2S";
  const words = pitch.trim().split(/\s+/).filter(Boolean);
  if (words.length > 1) return words.map((word) => word[0]).join("").slice(0, 4).toUpperCase();
  return pitch.length > 7 ? pitch.slice(0, 7) : pitch;
}

function shadeOpacity(value: number, maxValue: number) {
  return 0.34 + Math.min(0.6, Math.max(0, value) / Math.max(1, maxValue) * 0.6);
}

function CatcherScreen(props: {
  code: string;
  catcherState: string;
  joinCode: string;
  joined: boolean;
  lastHeard: string;
  lastNetworkEvent: string;
  remoteStream: MediaStream | null;
  remoteStreamUrl: string;
  role: Role | null;
  setJoinCode: (value: string) => void;
  joinRoom: () => void;
  reset: () => void;
  testAudio: () => void;
  forceSpeaker: boolean;
  toggleForceSpeaker: () => void;
  voiceStatus: string;
  voiceDiagnostics: VoiceDiagnostics;
  diagnosticChecks: DiagnosticCheck[];
  isRunningDiagnostics: boolean;
  lastServerDiagnostics: string;
  onRunDiagnostics: () => void;
}) {
  return (
    <ScrollView contentContainerStyle={styles.content}>
      {!props.joined ? (
        <>
          <Text style={styles.screenTitle}>Join as Catcher</Text>
          <Text style={styles.helper}>Connect AirPods to this iPhone before joining.</Text>
          <TextInput
            inputMode="numeric"
            keyboardType="number-pad"
            maxLength={6}
            onChangeText={(value) => props.setJoinCode(value.replace(/\D/g, "").slice(0, 6))}
            placeholder="6-digit code"
            placeholderTextColor="#72806e"
            style={styles.joinInput}
            value={props.joinCode}
          />
          <Pressable style={styles.primaryButton} onPress={props.joinRoom}>
            <Text style={styles.primaryButtonText}>Join Room</Text>
          </Pressable>
        </>
      ) : (
        <>
          <View style={styles.banner}>
            <Text style={styles.bannerLabel}>Room</Text>
            <Text style={styles.roomCode}>{props.code}</Text>
            <Text style={styles.bannerMode}>Listen-only</Text>
          </View>
          <Text style={styles.receiverState}>{props.catcherState}</Text>
          <Text style={styles.airPods}>AirPods connected if selected in iOS audio route</Text>
          <Text style={styles.voiceLine}>{props.voiceStatus}</Text>
          <Text style={styles.statusLine}>{props.lastNetworkEvent}</Text>
          {props.remoteStream && props.remoteStreamUrl ? (
            <RTCView streamURL={props.remoteStreamUrl} style={styles.hiddenRtcView} />
          ) : null}
          <VoiceDiagnosticsPanel diagnostics={props.voiceDiagnostics} />
          <TestModePanel
            checks={props.diagnosticChecks}
            isRunning={props.isRunningDiagnostics}
            lastServerDiagnostics={props.lastServerDiagnostics}
            onRun={props.onRunDiagnostics}
          />
          <Pressable
            style={[styles.toggleButton, props.forceSpeaker && styles.toggleButtonActive]}
            onPress={props.toggleForceSpeaker}
          >
            <Text style={[styles.toggleButtonText, props.forceSpeaker && styles.toggleButtonTextActive]}>
              {props.forceSpeaker ? "Force Speaker On" : "Force Speaker Off"}
            </Text>
          </Pressable>
          <Text style={styles.lastHeard}>{props.lastHeard}</Text>
          <Pressable style={styles.secondaryButton} onPress={props.testAudio}>
            <Text style={styles.secondaryButtonText}>Play test audio</Text>
          </Pressable>
          <Pressable style={styles.dangerButton} onPress={props.reset}>
            <Text style={styles.dangerText}>Emergency Disconnect</Text>
          </Pressable>
        </>
      )}
    </ScrollView>
  );
}

function DiamondScoutScreen(props: {
  apiBaseUrl: string;
  bearerToken: string;
  cacheOnly: boolean;
  mockMode: boolean;
  onBack: () => void;
  opponentId: string;
  scoutingCache: ScoutingCache;
  scoutingMetrics: ScoutingLoadMetrics;
  onRefreshScouting: () => void;
  setApiBaseUrl: (value: string) => void;
  setBearerToken: (value: string) => void;
  setCacheOnly: (value: boolean) => void;
  setMockMode: (value: boolean) => void;
  setOpponentId: (value: string) => void;
}) {
  const [view, setView] = useState<DiamondScoutView>("home");
  const hitters = props.scoutingCache.hitters.length ? props.scoutingCache.hitters : diamondScoutMockHitters;
  const [selectedHitterId, setSelectedHitterId] = useState(hitters[0]?.id ?? diamondScoutMock.currentHitterId);
  const currentHitter = hitters[0] ?? diamondScoutMockHitters[0];
  const selectedHitter = hitters.find((hitter) => hitter.id === selectedHitterId) ?? currentHitter;

  const goToHitter = (hitterId: string) => {
    setSelectedHitterId(hitterId);
    setView("hitterCard");
  };

  const renderBody = () => {
    if (view === "opponents") {
      return (
        <Section title="Opponents">
          <View style={styles.scoutList}>
            {diamondScoutMock.opponents.map((opponent) => (
              <Pressable key={opponent} style={styles.scoutListItem} onPress={() => setView("games")}>
                <Text style={styles.scoutListTitle}>{opponent}</Text>
                <Text style={styles.scoutListMeta}>Tap to view scheduled games</Text>
              </Pressable>
            ))}
          </View>
        </Section>
      );
    }

    if (view === "games") {
      return (
        <Section title="Games">
          <View style={styles.scoutList}>
            {diamondScoutMock.games.map((game) => (
              <Pressable key={game} style={styles.scoutListItem} onPress={() => setView("gameDetail")}>
                <Text style={styles.scoutListTitle}>{game}</Text>
                <Text style={styles.scoutListMeta}>{diamondScoutMock.date}</Text>
              </Pressable>
            ))}
          </View>
        </Section>
      );
    }

    if (view === "gameDetail") {
      return (
        <>
          <View style={styles.scoutCard}>
            <Text style={styles.scoutCardLabel}>Game State</Text>
            <Text style={styles.scoutCardTitle}>{diamondScoutMock.game}</Text>
            <Text style={styles.scoutCardText}>{diamondScoutMock.score}</Text>
            <Text style={styles.scoutCardText}>Pitcher: {diamondScoutMock.pitcher}</Text>
          </View>
          <Section title="Lineup Cards">
            <View style={styles.scoutGrid}>
              {hitters.map((hitter) => (
                <Pressable key={hitter.id} style={styles.scoutMiniCard} onPress={() => goToHitter(hitter.id)}>
                  <Text style={styles.scoutMiniTitle}>{hitter.name}</Text>
                  <Text style={styles.scoutListMeta}>
                    {hitter.position} / bats {hitter.bats}
                  </Text>
                </Pressable>
              ))}
            </View>
          </Section>
          <Pressable style={styles.secondaryButton} onPress={() => setView("currentHitter")}>
            <Text style={styles.secondaryButtonText}>Current Hitter</Text>
            <Text style={styles.buttonSubtext}>{currentHitter.name}</Text>
          </Pressable>
          <View style={styles.scoutCard}>
            <Text style={styles.scoutCardLabel}>Sample Pitch Events</Text>
            {diamondScoutMock.events.map((event) => (
              <Text key={event} style={styles.scoutCardText}>
                {event}
              </Text>
            ))}
          </View>
        </>
      );
    }

    if (view === "currentHitter") {
      return (
        <>
          <View style={styles.scoutCard}>
            <Text style={styles.scoutCardLabel}>Current Hitter</Text>
            <Text style={styles.scoutHeroName}>{currentHitter.name}</Text>
            <Text style={styles.scoutCardText}>
              {currentHitter.position} / bats {currentHitter.bats} / count {diamondScoutMock.count}
            </Text>
          </View>
          <ScoutPlanCard hitter={currentHitter} />
          <Pressable style={styles.primaryButton} onPress={() => goToHitter(currentHitter.id)}>
            <Text style={styles.primaryButtonText}>Open Full Card</Text>
          </Pressable>
        </>
      );
    }

    if (view === "hitterCard") {
      return (
        <>
          <View style={styles.scoutCard}>
            <Text style={styles.scoutCardLabel}>Hitter Card</Text>
            <Text style={styles.scoutHeroName}>{selectedHitter.name}</Text>
            <Text style={styles.scoutCardText}>
              {selectedHitter.position} / bats {selectedHitter.bats}
            </Text>
          </View>
          <ScoutPlanCard hitter={selectedHitter} />
          <View style={styles.scoutGrid}>
            <View style={styles.scoutMiniCard}>
              <Text style={styles.scoutMiniTitle}>Running</Text>
              <Text style={styles.scoutListMeta}>{selectedHitter.speed}</Text>
            </View>
            <View style={styles.scoutMiniCard}>
              <Text style={styles.scoutMiniTitle}>Defense</Text>
              <Text style={styles.scoutListMeta}>Shift neutral. Hold middle in late counts.</Text>
            </View>
          </View>
        </>
      );
    }

    if (view === "debug") {
      return (
        <>
          <View style={styles.scoutCard}>
            <Text style={styles.scoutCardLabel}>Integration Config</Text>
            <Text style={styles.scoutCardText}>
              Mock mode is used automatically when the API base URL, Bearer token, or opponent id is empty.
            </Text>
            <Text style={styles.scoutCardText}>
              Source: {props.scoutingCache.source.toUpperCase()} / cached hitters {props.scoutingCache.hitters.length}
            </Text>
            <Text style={styles.scoutCardText}>
              Cold {props.scoutingMetrics.lastColdLoadMs ?? "-"}ms / warm {props.scoutingMetrics.lastWarmLoadMs ?? "-"}ms /
              refresh {props.scoutingMetrics.lastRefreshMs ?? "-"}ms
            </Text>
          </View>
          <Text style={styles.label}>Diamond Scout API Base URL</Text>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            onChangeText={props.setApiBaseUrl}
            placeholder="https://api.example.com"
            placeholderTextColor="#72806e"
            style={styles.input}
            value={props.apiBaseUrl}
          />
          <Text style={styles.label}>Opponent ID</Text>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={props.setOpponentId}
            placeholder="70"
            placeholderTextColor="#72806e"
            style={styles.input}
            value={props.opponentId}
          />
          <Text style={styles.label}>Bearer Token</Text>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={props.setBearerToken}
            placeholder="Paste token for live mode"
            placeholderTextColor="#72806e"
            secureTextEntry
            style={styles.input}
            value={props.bearerToken}
          />
          <Pressable
            style={[styles.toggleButton, props.mockMode && styles.toggleButtonActive]}
            onPress={() => props.setMockMode(!props.mockMode)}
          >
            <Text style={[styles.toggleButtonText, props.mockMode && styles.toggleButtonTextActive]}>
              {props.mockMode ? "Mock Mode On" : "Mock Mode Off"}
            </Text>
          </Pressable>
          <Pressable
            style={[styles.toggleButton, props.cacheOnly && styles.toggleButtonActive]}
            onPress={() => props.setCacheOnly(!props.cacheOnly)}
          >
            <Text style={[styles.toggleButtonText, props.cacheOnly && styles.toggleButtonTextActive]}>
              {props.cacheOnly ? "Cache Only On" : "Cache Only Off"}
            </Text>
          </Pressable>
          <Pressable style={styles.secondaryButton} onPress={props.onRefreshScouting}>
            <Text style={styles.secondaryButtonText}>Refresh Scouting</Text>
            <Text style={styles.buttonSubtext}>Fetch live or hydrate cache</Text>
          </Pressable>
        </>
      );
    }

    return (
      <>
        <View style={styles.scoutCard}>
          <Text style={styles.scoutCardLabel}>Session</Text>
          <Text style={styles.scoutHeroName}>{diamondScoutMock.session}</Text>
          <Text style={styles.scoutCardText}>
            {diamondScoutMock.tenant} / opponent {props.scoutingCache.opponentName}
          </Text>
          <Text style={styles.scoutCardText}>
            Source: {props.scoutingCache.source.toUpperCase()} / hitters {hitters.length}
          </Text>
        </View>
        <View style={styles.scoutGrid}>
          <ScoutNavButton label="Opponents" detail="Scouting list" onPress={() => setView("opponents")} />
          <ScoutNavButton label="Games" detail="Schedule and state" onPress={() => setView("games")} />
          <ScoutNavButton label="Current Hitter" detail={currentHitter.name} onPress={() => setView("currentHitter")} />
          <ScoutNavButton label="Debug Config" detail="API and token" onPress={() => setView("debug")} />
        </View>
      </>
    );
  };

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.scoutHeader}>
        <View style={styles.flex}>
          <Text style={styles.screenTitle}>Diamond Scout</Text>
          <Text style={styles.helper}>Mock data is available without the Diamond Scout backend.</Text>
        </View>
        <View style={styles.mockBadge}>
          <Text style={styles.mockBadgeText}>{props.mockMode ? "MOCK DATA" : "LIVE"}</Text>
        </View>
      </View>

      {view !== "home" ? (
        <Pressable style={styles.footerLink} onPress={() => setView("home")}>
          <Text style={styles.footerLinkText}>Back to Scout Home</Text>
        </Pressable>
      ) : null}

      {renderBody()}

      <Pressable style={styles.footerLink} onPress={props.onBack}>
        <Text style={styles.footerLinkText}>Back to DugoutCall</Text>
      </Pressable>
    </ScrollView>
  );
}

function ScoutNavButton({ detail, label, onPress }: { detail: string; label: string; onPress: () => void }) {
  return (
    <Pressable style={styles.scoutMiniCard} onPress={onPress}>
      <Text style={styles.scoutMiniTitle}>{label}</Text>
      <Text style={styles.scoutListMeta}>{detail}</Text>
    </Pressable>
  );
}

function ScoutPlanCard({ hitter }: { hitter: ScoutHitter }) {
  return (
    <View style={styles.scoutCard}>
      <Text style={styles.scoutCardLabel}>Plan</Text>
      <Text style={styles.scoutCardTitle}>{hitter.plan}</Text>
      <Text style={styles.scoutCardText}>Chase: {hitter.chaseZone}</Text>
      <Text style={styles.scoutCardText}>Damage: {hitter.damageZone}</Text>
    </View>
  );
}

function VoiceDiagnosticsPanel({ diagnostics }: { diagnostics: VoiceDiagnostics }) {
  const rows = [
    ["Mic active", diagnostics.micActive ? "Yes" : "No"],
    ["Publishing audio", diagnostics.publishingAudio ? "Yes" : "No"],
    ["Subscribed remote", diagnostics.subscribedToRemoteAudio ? "Yes" : "No"],
    ["Playback attached", diagnostics.playbackAttached ? "Yes" : "No"],
    ["Output route", diagnostics.outputRoute],
    ["Tracks", `local ${diagnostics.localAudioTracks} / remote ${diagnostics.remoteAudioTracks}`],
    ["Peer", diagnostics.peerState]
  ];

  return (
    <View style={styles.diagnosticsPanel}>
      {rows.map(([label, value]) => (
        <View style={styles.diagnosticsRow} key={label}>
          <Text style={styles.diagnosticsLabel}>{label}</Text>
          <Text style={styles.diagnosticsValue}>{value}</Text>
        </View>
      ))}
    </View>
  );
}

function TestModePanel({
  checks,
  isRunning,
  lastServerDiagnostics,
  onRun
}: {
  checks: DiagnosticCheck[];
  isRunning: boolean;
  lastServerDiagnostics: string;
  onRun: () => void;
}) {
  const dotStyles: Record<DiagnosticStatus, object> = {
    fail: styles.testDot_fail,
    idle: styles.testDot_idle,
    pass: styles.testDot_pass,
    running: styles.testDot_running,
    warn: styles.testDot_warn
  };

  return (
    <View style={styles.testPanel}>
      <View style={styles.testHeader}>
        <View>
          <Text style={styles.testTitle}>Test Mode</Text>
          <Text style={styles.testSubtitle}>Run on both iPhones in the same room</Text>
        </View>
        <Pressable
          disabled={isRunning}
          onPress={onRun}
          style={[styles.testButton, isRunning && styles.testButtonDisabled]}
        >
          <Text style={styles.testButtonText}>{isRunning ? "Checking" : "Run"}</Text>
        </Pressable>
      </View>

      <Text style={styles.testServerLine} numberOfLines={2}>
        {lastServerDiagnostics}
      </Text>

      <View style={styles.testRows}>
        {checks.map((check) => (
          <View style={styles.testRow} key={check.key}>
            <View style={[styles.testDot, dotStyles[check.status]]} />
            <View style={styles.testTextBlock}>
              <Text style={styles.testLabel}>{check.label}</Text>
              <Text style={styles.testDetail} numberOfLines={2}>
                {check.detail}
              </Text>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

function Section({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Tile({
  compact,
  label,
  onPress,
  selected
}: {
  compact?: boolean;
  label: string;
  onPress: () => void;
  selected?: boolean;
}) {
  return (
    <Pressable style={[styles.tile, compact && styles.tileCompact, selected && styles.tileSelected]} onPress={onPress}>
      <Text style={[styles.tileText, selected && styles.tileTextSelected]} numberOfLines={2}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  actionBar: {
    backgroundColor: "#111a14",
    borderTopColor: "#314133",
    borderTopWidth: 1,
    flexDirection: "row",
    gap: 8,
    padding: 10
  },
  actionButton: {
    alignItems: "center",
    backgroundColor: "#213026",
    borderColor: "#3b4f3f",
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    minHeight: 54,
    justifyContent: "center"
  },
  actionPrimary: {
    alignItems: "center",
    backgroundColor: "#f3b23f",
    borderRadius: 8,
    flex: 1,
    minHeight: 54,
    justifyContent: "center"
  },
  actionText: {
    color: "#fff8df",
    fontSize: 14,
    fontWeight: "900"
  },
  airPods: {
    color: "#a8b8a5",
    fontSize: 16,
    fontWeight: "700",
    textAlign: "center"
  },
  badge: {
    alignSelf: "flex-start",
    backgroundColor: "#2a2216",
    borderColor: "#6c4e22",
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
    maxWidth: 136
  },
  badgeConnected: {
    backgroundColor: "#18351f",
    borderColor: "#2e8f4f"
  },
  badgeText: {
    color: "#f6f1dc",
    fontSize: 12,
    fontWeight: "800"
  },
  banner: {
    backgroundColor: "#17231c",
    borderColor: "#324437",
    borderRadius: 8,
    borderWidth: 1,
    padding: 14
  },
  bannerLabel: {
    color: "#a8b8a5",
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase"
  },
  bannerMode: {
    color: "#f3b23f",
    fontSize: 15,
    fontWeight: "900",
    marginTop: 4
  },
  buttonSubtext: {
    color: "#c9d2c6",
    fontSize: 13,
    fontWeight: "700",
    marginTop: 4
  },
  attackChip: {
    backgroundColor: "#e8f3ff",
    borderRadius: 13,
    borderWidth: 0,
    minHeight: 28,
    justifyContent: "center",
    paddingHorizontal: 12
  },
  attackChipText: {
    color: "#15598f",
    fontSize: 13,
    fontWeight: "600"
  },
  callGameState: {
    color: "#6f6c65",
    fontSize: 16,
    fontWeight: "500",
    lineHeight: 20
  },
  callHeader: {
    gap: 8,
    minHeight: 74
  },
  callHeaderMain: {
    flex: 1
  },
  callHeaderTop: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10
  },
  callOpponent: {
    color: "#1f1f1b",
    fontSize: 24,
    fontWeight: "900",
    lineHeight: 29
  },
  callStatusRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
    minHeight: 38
  },
  callSurface: {
    backgroundColor: "#fffefb",
    borderColor: "#c9c6bc",
    borderRadius: 28,
    borderWidth: 1,
    flex: 1,
    gap: 8,
    margin: 6,
    padding: 10,
    paddingBottom: 12
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6
  },
  cleanHitterCard: {
    minHeight: 72
  },
  cleanHitterMeta: {
    color: "#6f6c65",
    fontSize: 13,
    fontWeight: "500",
    lineHeight: 17
  },
  content: {
    gap: 16,
    padding: 16,
    paddingBottom: 28
  },
  countChip: {
    alignItems: "center",
    backgroundColor: "#f1f0ea",
    borderRadius: 10,
    borderWidth: 0,
    height: 38,
    minWidth: 66,
    justifyContent: "center",
    paddingHorizontal: 14
  },
  countChipText: {
    color: "#1f1f1b",
    fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }),
    fontSize: 20,
    fontWeight: "900"
  },
  coachHitterCard: {
    backgroundColor: "#142119",
    borderColor: "#41633f",
    borderRadius: 8,
    borderWidth: 1,
    gap: 10,
    padding: 12
  },
  coachHitterHeader: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 10,
    justifyContent: "space-between"
  },
  coachHitterLabel: {
    color: "#f3b23f",
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase"
  },
  coachHitterLink: {
    alignItems: "center",
    backgroundColor: "#223229",
    borderColor: "#3f5f46",
    borderRadius: 8,
    borderWidth: 1,
    minHeight: 42,
    justifyContent: "center"
  },
  coachHitterLinkText: {
    color: "#f6f1dc",
    fontSize: 13,
    fontWeight: "900"
  },
  coachHitterMeta: {
    color: "#a8b8a5",
    fontSize: 12,
    fontWeight: "800",
    marginTop: 2
  },
  coachHitterMini: {
    backgroundColor: "#101912",
    borderColor: "#314133",
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    gap: 3,
    minHeight: 56,
    justifyContent: "center",
    padding: 8
  },
  coachHitterMiniLabel: {
    color: "#a8b8a5",
    fontSize: 10,
    fontWeight: "900",
    textTransform: "uppercase"
  },
  coachHitterMiniValue: {
    color: "#f6f1dc",
    fontSize: 13,
    fontWeight: "900",
    lineHeight: 17
  },
  coachHitterName: {
    color: "#f6f1dc",
    fontSize: 22,
    fontWeight: "900",
    lineHeight: 27
  },
  coachHitterPlan: {
    color: "#d1dacd",
    fontSize: 14,
    fontWeight: "800",
    lineHeight: 19
  },
  coachHitterRows: {
    flexDirection: "row",
    gap: 8
  },
  dashboard: {
    gap: 14,
    padding: 12,
    paddingBottom: 18
  },
  dangerButton: {
    alignItems: "center",
    backgroundColor: "#441d1d",
    borderColor: "#8f3636",
    borderRadius: 8,
    borderWidth: 1,
    minHeight: 56,
    justifyContent: "center"
  },
  dangerText: {
    color: "#ffd9d9",
    fontSize: 16,
    fontWeight: "900"
  },
  diagnosticsLabel: {
    color: "#a8b8a5",
    flex: 1,
    fontSize: 12,
    fontWeight: "800"
  },
  diagnosticsPanel: {
    backgroundColor: "#101912",
    borderColor: "#314133",
    borderRadius: 8,
    borderWidth: 1,
    gap: 6,
    padding: 10
  },
  diagnosticsRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    justifyContent: "space-between"
  },
  diagnosticsValue: {
    color: "#f6f1dc",
    flex: 1.2,
    fontSize: 12,
    fontWeight: "900",
    textAlign: "right"
  },
  flex: {
    flex: 1
  },
  footerLink: {
    alignItems: "center",
    backgroundColor: "#0b100d",
    paddingBottom: 10,
    paddingTop: 2
  },
  footerLinkText: {
    color: "#a8b8a5",
    fontSize: 13,
    fontWeight: "800"
  },
  defenseCaption: {
    color: "#15598f",
    fontSize: 10,
    fontWeight: "500",
    lineHeight: 12,
    textAlign: "center"
  },
  gearButton: {
    alignItems: "center",
    backgroundColor: "#fffefb",
    borderColor: "#c9c6bc",
    borderRadius: 10,
    borderWidth: 1,
    height: 40,
    justifyContent: "center",
    width: 44
  },
  gearButtonText: {
    color: "#1f1f1b",
    fontSize: 11,
    fontWeight: "900"
  },
  gridFive: {
    flexDirection: "row",
    gap: 6
  },
  gridFour: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  gridThree: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  header: {
    alignItems: "center",
    backgroundColor: "#0f1712",
    borderBottomColor: "#28372c",
    borderBottomWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    padding: 14
  },
  helper: {
    color: "#a8b8a5",
    fontSize: 15,
    fontWeight: "700",
    lineHeight: 21
  },
  heatGlyph: {
    color: "#15598f",
    fontSize: 22,
    fontWeight: "900",
    height: 24,
    lineHeight: 24
  },
  heatGlyphHot: {
    color: "#b42a3a"
  },
  heatTile: {
    alignItems: "center",
    backgroundColor: "#fffefb",
    borderColor: "#c9c6bc",
    borderRadius: 10,
    borderWidth: 1,
    flexBasis: "31.9%",
    gap: 0,
    minHeight: 60,
    justifyContent: "center",
    paddingHorizontal: 5
  },
  heatTileExpanded: {
    minHeight: 70
  },
  heatTileCold: {
    backgroundColor: "#e2effb",
    borderColor: "#c6d4de"
  },
  heatTileHot: {
    backgroundColor: "#f8e6e6",
    borderColor: "#d8c1c1"
  },
  heatTileRecommended: {
    borderColor: "#1f68a9"
  },
  heatTileSelected: {
    borderColor: "#1f68a9",
    borderWidth: 3
  },
  heatTileText: {
    color: "#1f1f1b",
    fontSize: 12,
    fontWeight: "700",
    textAlign: "center"
  },
  hiddenRtcView: {
    height: 1,
    opacity: 0,
    width: 1
  },
  homePlate: {
    alignSelf: "center",
    backgroundColor: "#1f1f1b",
    height: 5,
    marginTop: 2,
    transform: [{ rotate: "45deg" }],
    width: 5
  },
  input: {
    backgroundColor: "#101912",
    borderColor: "#314133",
    borderRadius: 8,
    borderWidth: 1,
    color: "#f6f1dc",
    fontSize: 15,
    fontWeight: "700",
    minHeight: 48,
    paddingHorizontal: 12
  },
  joinInput: {
    backgroundColor: "#101912",
    borderColor: "#3f5f46",
    borderRadius: 8,
    borderWidth: 1,
    color: "#f6f1dc",
    fontSize: 38,
    fontWeight: "900",
    letterSpacing: 4,
    minHeight: 76,
    paddingHorizontal: 16,
    textAlign: "center"
  },
  label: {
    color: "#a8b8a5",
    fontSize: 12,
    fontWeight: "900",
    textTransform: "uppercase"
  },
  lastHeard: {
    backgroundColor: "#17231c",
    borderColor: "#324437",
    borderRadius: 8,
    borderWidth: 1,
    color: "#f6f1dc",
    fontSize: 22,
    fontWeight: "900",
    minHeight: 86,
    padding: 16,
    textAlign: "center"
  },
  notice: {
    backgroundColor: "#171d19",
    borderColor: "#38453b",
    borderRadius: 8,
    borderWidth: 1,
    padding: 12
  },
  noticeText: {
    color: "#d1dacd",
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 20
  },
  primaryButton: {
    backgroundColor: "#f3b23f",
    borderRadius: 8,
    minHeight: 76,
    justifyContent: "center",
    paddingHorizontal: 18
  },
  primaryButtonText: {
    color: "#151208",
    fontSize: 24,
    fontWeight: "900"
  },
  receiverState: {
    color: "#f6f1dc",
    fontSize: 44,
    fontWeight: "900",
    textAlign: "center"
  },
  roomCode: {
    color: "#f6f1dc",
    fontSize: 42,
    fontWeight: "900",
    letterSpacing: 5
  },
  safe: {
    backgroundColor: "#eeece4",
    flex: 1
  },
  mockBadge: {
    alignItems: "center",
    backgroundColor: "#f3b23f",
    borderRadius: 8,
    justifyContent: "center",
    paddingHorizontal: 10,
    paddingVertical: 8
  },
  mockBadgeText: {
    color: "#151208",
    fontSize: 12,
    fontWeight: "900"
  },
  mockBadgeSmall: {
    alignItems: "center",
    backgroundColor: "#f3b23f",
    borderRadius: 8,
    justifyContent: "center",
    paddingHorizontal: 8,
    paddingVertical: 6
  },
  mockBadgeSmallText: {
    color: "#151208",
    fontSize: 10,
    fontWeight: "900"
  },
  pitchPill: {
    alignItems: "center",
    backgroundColor: "#fffefb",
    borderColor: "#c9c6bc",
    borderRadius: 10,
    borderWidth: 1,
    flex: 1,
    minHeight: 56,
    minWidth: 72,
    justifyContent: "center",
    paddingHorizontal: 8
  },
  pitchCountChip: {
    alignItems: "center",
    backgroundColor: "#f1f0ea",
    borderRadius: 10,
    height: 38,
    justifyContent: "center",
    minWidth: 64,
    paddingHorizontal: 10
  },
  pitchCountText: {
    color: "#1f1f1b",
    fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }),
    fontSize: 16,
    fontWeight: "900"
  },
  pitchEditorInput: {
    backgroundColor: "#fffefb",
    borderColor: "#c9c6bc",
    borderRadius: 10,
    borderWidth: 1,
    color: "#1f1f1b",
    flex: 1,
    fontSize: 18,
    fontWeight: "800",
    minHeight: 48,
    paddingHorizontal: 12
  },
  pitchEditorList: {
    gap: 8
  },
  pitchEditorRemove: {
    alignItems: "center",
    backgroundColor: "#f8e6e6",
    borderColor: "#d8c1c1",
    borderRadius: 10,
    borderWidth: 1,
    height: 48,
    justifyContent: "center",
    width: 48
  },
  pitchEditorRemoveDisabled: {
    opacity: 0.4
  },
  pitchEditorRemoveText: {
    color: "#b42a3a",
    fontSize: 24,
    fontWeight: "900"
  },
  pitchEditorRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8
  },
  pitchPillRecommended: {
    borderColor: "#1f68a9",
    borderWidth: 2
  },
  pitchPillSelected: {
    backgroundColor: "#e2effb",
    borderColor: "#c6d4de"
  },
  pitchPillText: {
    color: "#1f1f1b",
    fontSize: 21,
    fontWeight: "900"
  },
  pitchPillTextSelected: {
    color: "#15598f"
  },
  pitchRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 7
  },
  relayDot: {
    backgroundColor: "#7f312f",
    borderRadius: 8,
    borderWidth: 0,
    height: 16,
    width: 16
  },
  relayDotOnline: {
    backgroundColor: "#2f7413"
  },
  reportCloseButton: {
    alignItems: "center",
    backgroundColor: "#101912",
    borderColor: "#314133",
    borderRadius: 8,
    borderWidth: 1,
    minHeight: 38,
    justifyContent: "center",
    paddingHorizontal: 14
  },
  reportSheet: {
    backgroundColor: "#0f1712",
    borderColor: "#314133",
    borderRadius: 16,
    borderWidth: 1,
    gap: 12,
    maxHeight: "72%",
    padding: 14
  },
  reportSheetBackdrop: {
    backgroundColor: "rgba(0,0,0,0.55)",
    flex: 1,
    justifyContent: "flex-end",
    padding: 12
  },
  reportSheetHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12
  },
  shadeChart: {
    alignItems: "stretch",
    backgroundColor: "#f8f6f0",
    borderColor: "#d7d2c6",
    borderRadius: 12,
    borderWidth: 1,
    gap: 4,
    minHeight: 112,
    padding: 7,
    width: 128
  },
  shadeField: {
    backgroundColor: "#fbf9f3",
    borderColor: "#c9c2b5",
    borderTopLeftRadius: 52,
    borderTopRightRadius: 52,
    borderWidth: 1,
    height: 64,
    overflow: "hidden",
    position: "relative"
  },
  shadeFoulLine: {
    backgroundColor: "#c7c0b3",
    bottom: 3,
    height: 1,
    position: "absolute",
    width: 63,
    zIndex: 3
  },
  shadeFoulLineLeft: {
    left: 1,
    transform: [{ rotate: "42deg" }]
  },
  shadeFoulLineRight: {
    right: 1,
    transform: [{ rotate: "-42deg" }]
  },
  shadeHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between"
  },
  shadeHeaderSide: {
    color: "#1f68a9",
    fontSize: 11,
    fontWeight: "900"
  },
  shadeHeaderText: {
    color: "#736f66",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0
  },
  shadeHomePlate: {
    alignSelf: "center",
    backgroundColor: "#1a2230",
    borderRadius: 3,
    bottom: 3,
    height: 6,
    position: "absolute",
    width: 8,
    zIndex: 4
  },
  shadeLabelCell: {
    alignItems: "center",
    flex: 1,
    gap: 1
  },
  shadeLabels: {
    flexDirection: "row",
    gap: 4
  },
  shadeLabelText: {
    color: "#8b867d",
    fontSize: 9,
    fontWeight: "800"
  },
  shadeLane: {
    alignItems: "center",
    flex: 1,
    justifyContent: "flex-end"
  },
  shadeLaneFill: {
    backgroundColor: "#9fb9cf",
    borderColor: "rgba(26, 34, 48, 0.12)",
    borderRadius: 9,
    borderWidth: 1,
    width: 24
  },
  shadeLaneFillDominant: {
    backgroundColor: "#1f68a9",
    borderColor: "#15598f"
  },
  shadeLanes: {
    alignItems: "flex-end",
    bottom: 9,
    flexDirection: "row",
    gap: 6,
    left: 10,
    position: "absolute",
    right: 10,
    top: 8,
    zIndex: 2
  },
  shadeValueDominant: {
    color: "#15598f"
  },
  shadeValueText: {
    color: "#1a2230",
    fontSize: 13,
    fontWeight: "900"
  },
  screenTitle: {
    color: "#f6f1dc",
    fontSize: 34,
    fontWeight: "900"
  },
  scoutButton: {
    backgroundColor: "#203822",
    borderColor: "#4d7d44",
    borderRadius: 8,
    borderWidth: 1,
    minHeight: 72,
    justifyContent: "center",
    paddingHorizontal: 18
  },
  scoutButtonText: {
    color: "#f6f1dc",
    fontSize: 22,
    fontWeight: "900"
  },
  sendMicRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    minHeight: 64
  },
  sendMicRowLive: {
    backgroundColor: "#260d0d",
    borderColor: "#a83232",
    borderRadius: 8,
    borderWidth: 1,
    padding: 5
  },
  scoutCard: {
    backgroundColor: "#17231c",
    borderColor: "#324437",
    borderRadius: 8,
    borderWidth: 1,
    gap: 8,
    padding: 14
  },
  scoutCardLabel: {
    color: "#f3b23f",
    fontSize: 12,
    fontWeight: "900",
    textTransform: "uppercase"
  },
  scoutCardText: {
    color: "#d1dacd",
    fontSize: 15,
    fontWeight: "700",
    lineHeight: 21
  },
  scoutCardTitle: {
    color: "#f6f1dc",
    fontSize: 20,
    fontWeight: "900",
    lineHeight: 26
  },
  scoutGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10
  },
  scoutHeader: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between"
  },
  scoutHeroName: {
    color: "#f6f1dc",
    fontSize: 30,
    fontWeight: "900",
    lineHeight: 36
  },
  scoutList: {
    gap: 10
  },
  scoutListItem: {
    backgroundColor: "#17231c",
    borderColor: "#324437",
    borderRadius: 8,
    borderWidth: 1,
    gap: 5,
    minHeight: 68,
    justifyContent: "center",
    padding: 14
  },
  scoutListMeta: {
    color: "#a8b8a5",
    fontSize: 13,
    fontWeight: "800",
    lineHeight: 18
  },
  scoutListTitle: {
    color: "#f6f1dc",
    fontSize: 19,
    fontWeight: "900"
  },
  scoutMiniCard: {
    backgroundColor: "#17231c",
    borderColor: "#324437",
    borderRadius: 8,
    borderWidth: 1,
    flexBasis: "48%",
    gap: 6,
    minHeight: 92,
    justifyContent: "center",
    padding: 12
  },
  scoutMiniTitle: {
    color: "#f6f1dc",
    fontSize: 17,
    fontWeight: "900",
    lineHeight: 22
  },
  scoutSwitch: {
    alignItems: "center",
    backgroundColor: "#fffefb",
    borderColor: "#c9c6bc",
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: "row",
    gap: 4,
    height: 38,
    paddingLeft: 7,
    paddingRight: 2
  },
  scoutSwitchText: {
    color: "#6f6c65",
    fontSize: 11,
    fontWeight: "900"
  },
  sequenceStrip: {
    alignItems: "center",
    backgroundColor: "#f1f0ea",
    borderColor: "#d7d3ca",
    borderRadius: 10,
    borderWidth: 1,
    minHeight: 30,
    justifyContent: "center",
    paddingHorizontal: 10
  },
  sequenceText: {
    color: "#4d4a44",
    fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }),
    fontSize: 12,
    fontWeight: "800"
  },
  settingsActionRow: {
    flexDirection: "row",
    gap: 8
  },
  settingsCloseButton: {
    alignItems: "center",
    backgroundColor: "#fffefb",
    borderColor: "#c9c6bc",
    borderRadius: 10,
    borderWidth: 1,
    minHeight: 38,
    justifyContent: "center",
    paddingHorizontal: 14
  },
  settingsDangerButton: {
    alignItems: "center",
    backgroundColor: "#f8e6e6",
    borderColor: "#d8c1c1",
    borderRadius: 10,
    borderWidth: 1,
    minHeight: 48,
    justifyContent: "center"
  },
  settingsDangerText: {
    color: "#b42a3a",
    fontSize: 15,
    fontWeight: "900"
  },
  settingsHelp: {
    color: "#6f6c65",
    fontSize: 14,
    fontWeight: "600",
    lineHeight: 20
  },
  settingsPrimaryButton: {
    alignItems: "center",
    backgroundColor: "#1f68a9",
    borderRadius: 10,
    minHeight: 52,
    justifyContent: "center"
  },
  settingsPrimaryText: {
    color: "#f6f1dc",
    fontSize: 16,
    fontWeight: "900"
  },
  settingsSecondaryButton: {
    alignItems: "center",
    backgroundColor: "#fffefb",
    borderColor: "#c9c6bc",
    borderRadius: 10,
    borderWidth: 1,
    flex: 1,
    minHeight: 46,
    justifyContent: "center"
  },
  settingsSecondaryText: {
    color: "#1f1f1b",
    fontSize: 14,
    fontWeight: "900"
  },
  settingsSheet: {
    backgroundColor: "#f3f1ec",
    borderColor: "#c9c6bc",
    borderRadius: 16,
    borderWidth: 1,
    gap: 12,
    maxHeight: "78%",
    padding: 14
  },
  settingsSheetBackdrop: {
    backgroundColor: "rgba(31,31,27,0.38)",
    flex: 1,
    justifyContent: "flex-end",
    padding: 12
  },
  settingsTitle: {
    color: "#1f1f1b",
    fontSize: 24,
    fontWeight: "900",
    lineHeight: 29
  },
  sprayCenter: {
    backgroundColor: "#86bee8"
  },
  sprayDirectionBand: {
    borderTopLeftRadius: 52,
    borderTopRightRadius: 52,
    flexDirection: "row",
    gap: 2,
    height: 58,
    overflow: "hidden"
  },
  sprayEmptyText: {
    color: "#6f6c65",
    fontSize: 12,
    fontWeight: "800"
  },
  sprayFan: {
    alignItems: "stretch",
    height: 78,
    justifyContent: "flex-end",
    width: 124
  },
  sprayFanEmpty: {
    alignItems: "center",
    backgroundColor: "#eeece4",
    borderColor: "#d7d3ca",
    borderRadius: 12,
    borderWidth: 1,
    justifyContent: "center"
  },
  sprayInfieldBand: {
    alignSelf: "center",
    borderTopColor: "#fffefb",
    borderTopWidth: 2,
    flexDirection: "row",
    gap: 2,
    height: 28,
    overflow: "hidden",
    width: 84
  },
  sprayOppo: {
    backgroundColor: "#c8d9e5"
  },
  sprayOutfieldBand: {
    borderTopLeftRadius: 62,
    borderTopRightRadius: 62,
    flexDirection: "row",
    gap: 2,
    height: 42,
    overflow: "hidden"
  },
  sprayPull: {
    backgroundColor: "#66aee5"
  },
  sprayText: {
    color: "#1f1f1b",
    fontSize: 10,
    fontWeight: "900"
  },
  sprayTextSmall: {
    fontSize: 9
  },
  sprayWedge: {
    alignItems: "center",
    borderColor: "rgba(255,254,251,0.55)",
    borderWidth: 0.5,
    flex: 1,
    justifyContent: "center"
  },
  sprayWedgeSmall: {
    minWidth: 0
  },
  statusMini: {
    color: "#6f6c65",
    flex: 1,
    fontSize: 12,
    fontWeight: "500",
    textAlign: "right"
  },
  surfaceEyebrow: {
    color: "#6f6c65",
    fontSize: 14,
    fontWeight: "500"
  },
  surfaceHitterCard: {
    alignItems: "stretch",
    backgroundColor: "#f3f1ec",
    borderRadius: 14,
    borderWidth: 0,
    flexDirection: "row",
    gap: 10,
    minHeight: 120,
    padding: 12
  },
  surfaceHitterLeft: {
    flex: 1,
    gap: 5,
    justifyContent: "center"
  },
  surfaceHitterName: {
    color: "#1f1f1b",
    fontSize: 23,
    fontWeight: "900",
    lineHeight: 28
  },
  surfaceMicButton: {
    alignItems: "center",
    backgroundColor: "#fffefb",
    borderColor: "#c9c6bc",
    borderRadius: 10,
    borderWidth: 1,
    height: 64,
    justifyContent: "center",
    width: 64
  },
  surfaceMicButtonLive: {
    backgroundColor: "#b42a3a",
    borderColor: "#b42a3a"
  },
  surfaceMicIcon: {
    color: "#1f1f1b",
    fontSize: 15,
    fontWeight: "900"
  },
  surfaceMockBadge: {
    alignItems: "center",
    backgroundColor: "#f1f0ea",
    borderRadius: 10,
    height: 32,
    justifyContent: "center",
    paddingHorizontal: 7
  },
  surfaceMockBadgeText: {
    color: "#6f6c65",
    fontSize: 9,
    fontWeight: "900"
  },
  surfaceSendButton: {
    alignItems: "center",
    backgroundColor: "#a9c9e2",
    borderRadius: 10,
    borderWidth: 0,
    flex: 1,
    height: 64,
    justifyContent: "center",
    paddingHorizontal: 12
  },
  surfaceSendButtonFailed: {
    backgroundColor: "#b42a3a"
  },
  surfaceSendButtonLive: {
    backgroundColor: "#b42a3a"
  },
  surfaceSendButtonReady: {
    backgroundColor: "#1f68a9"
  },
  surfaceSendButtonSent: {
    backgroundColor: "#35770b"
  },
  surfaceSendText: {
    color: "#f6f1dc",
    fontSize: 18,
    fontWeight: "900"
  },
  surfaceSprayColumn: {
    alignItems: "center",
    gap: 4,
    justifyContent: "center",
    width: 132
  },
  surfaceVerdict: {
    color: "#6f6c65",
    fontSize: 16,
    fontWeight: "500",
    lineHeight: 22
  },
  secondaryButton: {
    backgroundColor: "#17231c",
    borderColor: "#364a3b",
    borderRadius: 8,
    borderWidth: 1,
    minHeight: 72,
    justifyContent: "center",
    paddingHorizontal: 18
  },
  secondaryButtonText: {
    color: "#f6f1dc",
    fontSize: 22,
    fontWeight: "900"
  },
  section: {
    gap: 8
  },
  sectionTitle: {
    color: "#a8b8a5",
    fontSize: 12,
    fontWeight: "900",
    textTransform: "uppercase"
  },
  selection: {
    color: "#f6f1dc",
    fontSize: 24,
    fontWeight: "900"
  },
  statusLine: {
    color: "#a8b8a5",
    fontSize: 14,
    fontWeight: "700"
  },
  testButton: {
    alignItems: "center",
    backgroundColor: "#f3b23f",
    borderRadius: 8,
    justifyContent: "center",
    minHeight: 42,
    paddingHorizontal: 16
  },
  testButtonDisabled: {
    opacity: 0.6
  },
  testButtonText: {
    color: "#151208",
    fontSize: 14,
    fontWeight: "900"
  },
  testDetail: {
    color: "#a8b8a5",
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 16
  },
  testDot: {
    borderRadius: 5,
    height: 10,
    marginTop: 4,
    width: 10
  },
  testDot_fail: {
    backgroundColor: "#d94b3d"
  },
  testDot_idle: {
    backgroundColor: "#647063"
  },
  testDot_pass: {
    backgroundColor: "#43c26f"
  },
  testDot_running: {
    backgroundColor: "#f3b23f"
  },
  testDot_warn: {
    backgroundColor: "#d69c32"
  },
  testHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    justifyContent: "space-between"
  },
  testLabel: {
    color: "#f6f1dc",
    fontSize: 13,
    fontWeight: "900"
  },
  testPanel: {
    backgroundColor: "#101912",
    borderColor: "#314133",
    borderRadius: 8,
    borderWidth: 1,
    gap: 10,
    padding: 12
  },
  testRow: {
    flexDirection: "row",
    gap: 9
  },
  testRows: {
    gap: 8
  },
  testServerLine: {
    color: "#f3b23f",
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 16
  },
  testSubtitle: {
    color: "#a8b8a5",
    fontSize: 12,
    fontWeight: "700",
    marginTop: 2
  },
  testTextBlock: {
    flex: 1,
    gap: 2
  },
  testTitle: {
    color: "#f6f1dc",
    fontSize: 16,
    fontWeight: "900"
  },
  subtitle: {
    color: "#a8b8a5",
    fontSize: 13,
    fontWeight: "700",
    marginTop: 2,
    maxWidth: 220
  },
  talkButton: {
    alignItems: "center",
    backgroundColor: "#314024",
    borderColor: "#658442",
    borderRadius: 8,
    borderWidth: 1,
    flex: 1.25,
    minHeight: 54,
    justifyContent: "center"
  },
  talkButtonActive: {
    backgroundColor: "#a43f2e",
    borderColor: "#f7a057"
  },
  tile: {
    alignItems: "center",
    backgroundColor: "#17231c",
    borderColor: "#344739",
    borderRadius: 8,
    borderWidth: 1,
    flexBasis: "31.8%",
    minHeight: 58,
    justifyContent: "center",
    paddingHorizontal: 8
  },
  tileCompact: {
    flex: 1,
    flexBasis: 0,
    minHeight: 48,
    paddingHorizontal: 4
  },
  tileSelected: {
    backgroundColor: "#f3b23f",
    borderColor: "#ffd27a"
  },
  tileText: {
    color: "#f6f1dc",
    fontSize: 15,
    fontWeight: "900",
    textAlign: "center"
  },
  tileTextSelected: {
    color: "#141108"
  },
  title: {
    color: "#f6f1dc",
    fontSize: 26,
    fontWeight: "900"
  },
  utilityButton: {
    alignItems: "center",
    backgroundColor: "#fffefb",
    borderColor: "#c9c6bc",
    borderRadius: 10,
    borderWidth: 1,
    flex: 1,
    minHeight: 38,
    justifyContent: "center"
  },
  utilityRow: {
    flexDirection: "row",
    gap: 8
  },
  utilityText: {
    color: "#1f1f1b",
    fontSize: 12,
    fontWeight: "900"
  },
  toggleButton: {
    alignItems: "center",
    backgroundColor: "#213026",
    borderColor: "#3b4f3f",
    borderRadius: 8,
    borderWidth: 1,
    minHeight: 52,
    justifyContent: "center"
  },
  toggleButtonActive: {
    backgroundColor: "#f3b23f",
    borderColor: "#ffd27a"
  },
  toggleButtonText: {
    color: "#f6f1dc",
    fontSize: 16,
    fontWeight: "900"
  },
  toggleButtonTextActive: {
    color: "#141108"
  },
  voiceLine: {
    color: "#f3b23f",
    fontSize: 14,
    fontWeight: "900"
  },
  outcomeBackdrop: {
    backgroundColor: "rgba(0, 0, 0, 0.72)",
    flex: 1,
    justifyContent: "flex-end"
  },
  outcomeCard: {
    backgroundColor: "#0f1813",
    borderColor: "#344739",
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderWidth: 1,
    gap: 14,
    maxHeight: "90%",
    padding: 20
  },
  zoneGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 7
  },
  zoneHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    minHeight: 18
  },
  zoneLegend: {
    color: "#9c9a93",
    fontSize: 13,
    fontWeight: "500"
  }
});
