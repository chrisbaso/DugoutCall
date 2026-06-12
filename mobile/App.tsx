import { Audio, InterruptionModeAndroid, InterruptionModeIOS } from "expo-av";
import * as Speech from "expo-speech";
import { AudioSession as LiveKitAudioSession } from "@livekit/react-native";
import { ConnectionState as LiveKitConnectionState, Room, RoomEvent, Track } from "livekit-client";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
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

type Role = "coach" | "catcher";
type AppMode = "game" | "practice";
type ConnectionState = "idle" | "connecting" | "connected" | "disconnected";
type DiagnosticStatus = "idle" | "running" | "pass" | "warn" | "fail";

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

type AppScreen = "role" | "coach" | "catcher" | "diamondScout";
type DiamondScoutView = "home" | "opponents" | "games" | "gameDetail" | "currentHitter" | "hitterCard" | "debug";

type ScoutHitter = {
  id: string;
  name: string;
  bats: string;
  position: string;
  plan: string;
  chaseZone: string;
  damageZone: string;
  speed: string;
};

const testTone = require("./assets/test-tone.wav");
const defaultBackendUrl = "https://dugoutcall.onrender.com";
const pitches = ["Fastball", "Curveball", "Change-up"];
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
    name: "Mason Keller",
    bats: "R",
    position: "SS",
    plan: "Start soft away. Fastballs must stay up or off the plate.",
    chaseZone: "Slider down away",
    damageZone: "Middle-in fastball",
    speed: "Above average"
  },
  {
    id: "h2",
    name: "Eli Brooks",
    bats: "L",
    position: "CF",
    plan: "Fastball up early, change-up down when ahead.",
    chaseZone: "Change-up below zone",
    damageZone: "Outer-half curveball",
    speed: "Plus"
  },
  {
    id: "h3",
    name: "Noah Price",
    bats: "R",
    position: "1B",
    plan: "Do not double up middle. Curveball for called strike.",
    chaseZone: "Fastball above hands",
    damageZone: "Down and in",
    speed: "Limited"
  }
];

const diamondScoutMock = {
  session: "Varsity Game Prep",
  tenant: "Demo Dugout",
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
  const socketRef = useRef<WebSocket | null>(null);
  const liveKitRoomRef = useRef<Room | null>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const localAudioAddedRef = useRef(false);
  const pendingIceCandidatesRef = useRef<ICECandidateMessage[]>([]);
  const creatingOfferRef = useRef(false);
  const playedRemoteSubscriptionToneRef = useRef(false);
  const lastSpeechAtRef = useRef(0);
  const roleRef = useRef<Role | null>(null);
  const roomCodeRef = useRef("");
  const [screen, setScreen] = useState<AppScreen>("role");
  const [role, setRole] = useState<Role | null>(null);
  const [backendUrl, setBackendUrl] = useState(defaultBackendUrl);
  const [diamondScoutBaseUrl, setDiamondScoutBaseUrl] = useState("");
  const [diamondScoutToken, setDiamondScoutToken] = useState("");
  const [diamondScoutMockMode, setDiamondScoutMockMode] = useState(true);
  const [room, setRoom] = useState<RoomResponse | null>(null);
  const [joinCode, setJoinCode] = useState("");
  const [connection, setConnection] = useState<ConnectionState>("idle");
  const [status, setStatus] = useState("Ready");
  const [selectedPitch, setSelectedPitch] = useState("");
  const [selectedLocation, setSelectedLocation] = useState("");
  const [selectedContext, setSelectedContext] = useState("");
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

  useEffect(() => {
    void configureAudioForPlayback();
  }, []);

  const currentPhrase = useMemo(
    () => phrase(selectedPitch, selectedLocation),
    [selectedPitch, selectedLocation]
  );

  const apiUrl = (path: string) => `${normalizeBaseUrl(backendUrl)}${path}`;

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
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      interruptionModeAndroid: InterruptionModeAndroid.DoNotMix,
      interruptionModeIOS: InterruptionModeIOS.DoNotMix,
      playThroughEarpieceAndroid: false,
      playsInSilentModeIOS: true,
      shouldDuckAndroid: false,
      staysActiveInBackground: false
    });
    updateVoiceDiagnostics({ outputRoute: configuredOutputRoute(label) });
    setVoiceStatus("Audio playback ready");
  };

  const configureAudioForTalk = async () => {
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: true,
      interruptionModeAndroid: InterruptionModeAndroid.DoNotMix,
      interruptionModeIOS: InterruptionModeIOS.DoNotMix,
      playThroughEarpieceAndroid: false,
      playsInSilentModeIOS: true,
      shouldDuckAndroid: false,
      staysActiveInBackground: false
    });
    updateVoiceDiagnostics({ outputRoute: configuredOutputRoute("voice transmit") });
  };

  const configureAudioForVoiceReceive = async (label = "voice receive", speakerRequested = forceSpeaker) => {
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: !speakerRequested,
      interruptionModeAndroid: InterruptionModeAndroid.DoNotMix,
      interruptionModeIOS: InterruptionModeIOS.DoNotMix,
      playThroughEarpieceAndroid: false,
      playsInSilentModeIOS: true,
      shouldDuckAndroid: false,
      staysActiveInBackground: false
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
    const { sound } = await Audio.Sound.createAsync(testTone, {
      shouldPlay: true,
      volume: 1
    });
    sound.setOnPlaybackStatusUpdate((playbackStatus) => {
      if (playbackStatus.isLoaded && playbackStatus.didJustFinish) {
        void sound.unloadAsync();
      }
    });
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
          const snapshot = await requestJson<RoomDiagnosticSnapshot>(`/rooms/${code}/diagnostics`, { method: "GET" });
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
          const permission = await Audio.requestPermissionsAsync();
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

  const connectSocket = (nextRole: Role, code: string, displayName: string) => {
    disconnectSocket();
    roleRef.current = nextRole;
    roomCodeRef.current = code;
    setConnection("connecting");
    setLastNetworkEvent(`Connecting ${nextRole} socket...`);
    const socket = new WebSocket(websocketUrl(backendUrl));
    socketRef.current = socket;

    socket.onopen = () => {
      setConnection("connected");
      setLastNetworkEvent(`Socket joined ${code} at ${compactClock()}`);
      socket.send(JSON.stringify({ type: "join_room", code, role: nextRole, displayName }));
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

  const createRoom = async () => {
    try {
      setStatus("Creating room...");
      const response = await requestJson<RoomResponse>("/rooms", {
        method: "POST",
        body: JSON.stringify({ coachName: "Coach", teamName: "DugoutCall", mode: "game" })
      });
      setRoom(response);
      roomCodeRef.current = response.code;
      setCurrentRole("coach");
      setScreen("coach");
      connectSocket("coach", response.code, "Coach");
      await connectLiveKitVoice(response.livekit, "coach");
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
      connectSocket("catcher", code, "Catcher");
      await connectLiveKitVoice(response.livekit, "catcher");
      speak("DugoutCall connected.");
    } catch (error) {
      Alert.alert("Could not join room", error instanceof Error ? error.message : "Try again.");
      setStatus("Join failed");
    }
  };

  const sendPitchCall = (pitch: string, location?: string) => {
    if (!pitch) {
      setStatus("Select a pitch first");
      return;
    }

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
      updateVoiceDiagnostics({
        micActive: true,
        publishingAudio: true,
        localAudioTracks: 1
      });
      sendSocket({ type: "ptt_start", timestamp: Date.now() });
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
    void liveKitRoomRef.current?.localParticipant.setMicrophoneEnabled(false);
    setIsTalking(false);
    setStatus("Live voice off");
    setVoiceStatus("LiveKit voice ready");
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
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>DugoutCall</Text>
            <Text style={styles.subtitle}>Game Mode: one-way coach-to-catcher communication</Text>
          </View>
          <View style={[styles.badge, connection === "connected" && styles.badgeConnected]}>
            <Text style={styles.badgeText}>{connection === "connected" ? "Online" : status}</Text>
          </View>
        </View>

        {screen === "role" && (
          <ScrollView contentContainerStyle={styles.content}>
            <View style={styles.notice}>
              <Text style={styles.noticeText}>
                Use only where permitted by your league/state association. AirPods must be paired to the catcher iPhone.
              </Text>
            </View>

            <Text style={styles.label}>Backend URL</Text>
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              onChangeText={setBackendUrl}
              style={styles.input}
              value={backendUrl}
            />

            <TestModePanel
              checks={diagnosticChecks}
              isRunning={isRunningDiagnostics}
              lastServerDiagnostics={lastServerDiagnostics}
              onRun={runDiagnostics}
            />

            <Pressable style={styles.primaryButton} onPress={createRoom}>
              <Text style={styles.primaryButtonText}>Coach Mode</Text>
              <Text style={styles.buttonSubtext}>Create room</Text>
            </Pressable>
            <Pressable style={styles.scoutButton} onPress={() => setScreen("diamondScout")}>
              <Text style={styles.scoutButtonText}>Diamond Scout</Text>
              <Text style={styles.buttonSubtext}>Mock scouting cards</Text>
            </Pressable>
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

        {screen === "coach" && (
          <CoachScreen
            code={room?.code ?? "------"}
            currentPhrase={currentPhrase}
            isTalking={isTalking}
            lastStatus={status}
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
            mockMode={diamondScoutMockMode || !diamondScoutBaseUrl.trim() || !diamondScoutToken.trim()}
            onBack={() => setScreen("role")}
            setApiBaseUrl={setDiamondScoutBaseUrl}
            setBearerToken={setDiamondScoutToken}
            setMockMode={setDiamondScoutMockMode}
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
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function CoachScreen(props: {
  code: string;
  currentPhrase: string;
  isTalking: boolean;
  lastStatus: string;
  lastNetworkEvent: string;
  onClear: () => void;
  onRepeat: () => void;
  onReset: () => void;
  onSend: () => void;
  onStartTalk: () => void;
  onStopTalk: () => void;
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
  const currentHitter =
    diamondScoutMockHitters.find((hitter) => hitter.id === diamondScoutMock.currentHitterId) ?? diamondScoutMockHitters[0];

  return (
    <View style={styles.flex}>
      <ScrollView contentContainerStyle={styles.dashboard}>
        <View style={styles.banner}>
          <Text style={styles.bannerLabel}>Room</Text>
          <Text style={styles.roomCode}>{props.code}</Text>
          <Text style={styles.bannerMode}>Game Mode</Text>
        </View>

        <Text style={styles.selection}>{props.currentPhrase || "Select pitch and location"}</Text>
        <Text style={styles.statusLine}>{props.lastStatus}</Text>
        <Text style={styles.statusLine}>{props.lastNetworkEvent}</Text>
        <Text style={styles.voiceLine}>{props.voiceStatus}</Text>
        <VoiceDiagnosticsPanel diagnostics={props.voiceDiagnostics} />
        <TestModePanel
          checks={props.diagnosticChecks}
          isRunning={props.isRunningDiagnostics}
          lastServerDiagnostics={props.lastServerDiagnostics}
          onRun={props.onRunDiagnostics}
        />

        <View style={styles.coachHitterCard}>
          <View style={styles.coachHitterHeader}>
            <View style={styles.flex}>
              <Text style={styles.coachHitterLabel}>Current Hitter</Text>
              <Text style={styles.coachHitterName}>{currentHitter.name}</Text>
              <Text style={styles.coachHitterMeta}>
                {currentHitter.position} / bats {currentHitter.bats} / count {diamondScoutMock.count}
              </Text>
            </View>
            <View style={styles.mockBadgeSmall}>
              <Text style={styles.mockBadgeSmallText}>MOCK</Text>
            </View>
          </View>
          <Text style={styles.coachHitterPlan}>{currentHitter.plan}</Text>
          <View style={styles.coachHitterRows}>
            <View style={styles.coachHitterMini}>
              <Text style={styles.coachHitterMiniLabel}>Chase</Text>
              <Text style={styles.coachHitterMiniValue}>{currentHitter.chaseZone}</Text>
            </View>
            <View style={styles.coachHitterMini}>
              <Text style={styles.coachHitterMiniLabel}>Damage</Text>
              <Text style={styles.coachHitterMiniValue}>{currentHitter.damageZone}</Text>
            </View>
          </View>
          <Pressable style={styles.coachHitterLink} onPress={props.openDiamondScout}>
            <Text style={styles.coachHitterLinkText}>Open full scout card</Text>
          </Pressable>
        </View>

        <Section title="Presets">
          <View style={styles.gridFour}>
            {presets.map((preset) => (
              <Tile
                key={preset.label}
                label={preset.label}
                onPress={() => props.sendPreset(preset.pitch, preset.location)}
              />
            ))}
          </View>
        </Section>

        <Section title="Pitch">
          <View style={styles.gridThree}>
            {pitches.map((pitch) => (
              <Tile
                key={pitch}
                label={pitch}
                selected={props.selectedPitch === pitch}
                onPress={() => props.setSelectedPitch(props.selectedPitch === pitch ? "" : pitch)}
              />
            ))}
          </View>
        </Section>

        <Section title="Location">
          <View style={styles.gridThree}>
            {locations.map((location) => (
              <Tile
                key={location}
                label={location}
                selected={props.selectedLocation === location}
                onPress={() => props.setSelectedLocation(props.selectedLocation === location ? "" : location)}
              />
            ))}
          </View>
        </Section>

        <Section title="Count / Context">
          <View style={styles.gridFive}>
            {contextButtons.map((context) => (
              <Tile
                compact
                key={context}
                label={context}
                selected={props.selectedContext === context}
                onPress={() => props.setSelectedContext(props.selectedContext === context ? "" : context)}
              />
            ))}
          </View>
        </Section>
      </ScrollView>

      <View style={styles.actionBar}>
        <Pressable style={styles.actionPrimary} onPress={props.onSend}>
          <Text style={styles.actionText}>Send</Text>
        </Pressable>
        <Pressable style={styles.actionButton} onPress={props.onRepeat}>
          <Text style={styles.actionText}>Repeat</Text>
        </Pressable>
        <Pressable style={styles.actionButton} onPress={props.onClear}>
          <Text style={styles.actionText}>Clear</Text>
        </Pressable>
        <Pressable
          onPressIn={props.onStartTalk}
          onPressOut={props.onStopTalk}
          style={[styles.talkButton, props.isTalking && styles.talkButtonActive]}
        >
          <Text style={styles.actionText}>{props.isTalking ? "Talking" : "Hold Talk"}</Text>
        </Pressable>
      </View>

      <Pressable style={styles.footerLink} onPress={props.onReset}>
        <Text style={styles.footerLinkText}>Leave room</Text>
      </Pressable>
    </View>
  );
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
  mockMode: boolean;
  onBack: () => void;
  setApiBaseUrl: (value: string) => void;
  setBearerToken: (value: string) => void;
  setMockMode: (value: boolean) => void;
}) {
  const [view, setView] = useState<DiamondScoutView>("home");
  const [selectedHitterId, setSelectedHitterId] = useState(diamondScoutMock.currentHitterId);
  const currentHitter =
    diamondScoutMockHitters.find((hitter) => hitter.id === diamondScoutMock.currentHitterId) ?? diamondScoutMockHitters[0];
  const selectedHitter = diamondScoutMockHitters.find((hitter) => hitter.id === selectedHitterId) ?? currentHitter;

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
              {diamondScoutMockHitters.map((hitter) => (
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
              Mock mode is used automatically when the API base URL or Bearer token is empty.
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
        </>
      );
    }

    return (
      <>
        <View style={styles.scoutCard}>
          <Text style={styles.scoutCardLabel}>Session</Text>
          <Text style={styles.scoutHeroName}>{diamondScoutMock.session}</Text>
          <Text style={styles.scoutCardText}>
            {diamondScoutMock.tenant} / opponent {diamondScoutMock.opponent}
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
  content: {
    gap: 16,
    padding: 16,
    paddingBottom: 28
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
  hiddenRtcView: {
    height: 1,
    opacity: 0,
    width: 1
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
    backgroundColor: "#0b100d",
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
  }
});
