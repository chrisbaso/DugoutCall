import * as Speech from "expo-speech";
import React, { useMemo, useRef, useState } from "react";
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

type Role = "coach" | "catcher";
type AppMode = "game" | "practice";
type ConnectionState = "idle" | "connecting" | "connected" | "disconnected";

type RoomResponse = {
  code: string;
  mode: AppMode;
  expiresAt: number;
  token: string;
};

type PitchCallMessage = {
  type: "pitch_call";
  id: string;
  pitch: string;
  location?: string;
  spokenText: string;
  timestamp: number;
};

type ServerMessage =
  | { type: "role_assigned"; code: string; role: Role; mode: AppMode; expiresAt: number }
  | PitchCallMessage
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

const defaultBackendUrl = "https://dugoutcall.onrender.com";
const pitches = ["Fastball", "Curveball", "Change-up"];
const locations = ["Up", "Down", "In", "Away", "Middle", "Up/In", "Up/Away", "Down/In", "Down/Away"];
const contextButtons = ["0-0", "Ahead", "Behind", "2 Strikes", "Runner On"];
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

const normalizeBaseUrl = (value: string) => value.trim().replace(/\/$/, "");

const websocketUrl = (baseUrl: string) => {
  const normalized = normalizeBaseUrl(baseUrl);
  if (normalized.startsWith("https://")) return normalized.replace("https://", "wss://");
  if (normalized.startsWith("http://")) return normalized.replace("http://", "ws://");
  return normalized;
};

const callId = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;

const phrase = (pitch: string, location?: string) => {
  if (!location || pitch === "Pitchout" || pitch === "Pickoff") return pitch;
  return `${pitch} ${location.replace("/", " ").toLowerCase()}`;
};

export default function App() {
  const socketRef = useRef<WebSocket | null>(null);
  const lastSpeechAtRef = useRef(0);
  const [screen, setScreen] = useState<"role" | "coach" | "catcher">("role");
  const [role, setRole] = useState<Role | null>(null);
  const [backendUrl, setBackendUrl] = useState(defaultBackendUrl);
  const [room, setRoom] = useState<RoomResponse | null>(null);
  const [joinCode, setJoinCode] = useState("");
  const [connection, setConnection] = useState<ConnectionState>("idle");
  const [status, setStatus] = useState("Ready");
  const [selectedPitch, setSelectedPitch] = useState("");
  const [selectedLocation, setSelectedLocation] = useState("");
  const [selectedContext, setSelectedContext] = useState("");
  const [lastCall, setLastCall] = useState<PitchCallMessage | null>(null);
  const [isTalking, setIsTalking] = useState(false);
  const [catcherState, setCatcherState] = useState("Waiting for call");
  const [lastHeard, setLastHeard] = useState("No pitch call yet.");

  const currentPhrase = useMemo(
    () => phrase(selectedPitch, selectedLocation),
    [selectedPitch, selectedLocation]
  );

  const apiUrl = (path: string) => `${normalizeBaseUrl(backendUrl)}${path}`;

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

  const disconnectSocket = () => {
    socketRef.current?.close();
    socketRef.current = null;
    setConnection("disconnected");
  };

  const connectSocket = (nextRole: Role, code: string, displayName: string) => {
    disconnectSocket();
    setConnection("connecting");
    const socket = new WebSocket(websocketUrl(backendUrl));
    socketRef.current = socket;

    socket.onopen = () => {
      setConnection("connected");
      socket.send(JSON.stringify({ type: "join_room", code, role: nextRole, displayName }));
    };

    socket.onmessage = (event) => {
      const message = JSON.parse(event.data) as ServerMessage;
      handleServerMessage(message);
    };

    socket.onerror = () => {
      setStatus("Connection error");
    };

    socket.onclose = () => {
      setConnection("disconnected");
    };
  };

  const handleServerMessage = (message: ServerMessage) => {
    if (message.type === "role_assigned") {
      setStatus(`${message.role === "coach" ? "Coach" : "Catcher"} connected`);
      return;
    }

    if (message.type === "pitch_call") {
      receivePitchCall(message.spokenText);
      return;
    }

    if (message.type === "ptt_start") {
      setCatcherState("Receiving voice");
      return;
    }

    if (message.type === "ptt_stop") {
      setCatcherState("Waiting for call");
      return;
    }

    if (message.type === "error") {
      setStatus(message.message);
    }
  };

  const sendSocket = (message: unknown) => {
    if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
      setStatus("Not connected");
      return false;
    }
    socketRef.current.send(JSON.stringify(message));
    return true;
  };

  const createRoom = async () => {
    try {
      setStatus("Creating room...");
      const response = await requestJson<RoomResponse>("/rooms", {
        method: "POST",
        body: JSON.stringify({ coachName: "Coach", teamName: "DugoutCall", mode: "game" })
      });
      setRoom(response);
      setRole("coach");
      setScreen("coach");
      connectSocket("coach", response.code, "Coach");
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
      setRole("catcher");
      setScreen("catcher");
      setCatcherState("Connected");
      connectSocket("catcher", code, "Catcher");
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
    const now = Date.now();
    if (now - lastSpeechAtRef.current < 2000) Speech.stop();
    lastSpeechAtRef.current = now;
    Speech.speak(text, {
      rate: 0.48,
      pitch: 1,
      volume: 1
    });
  };

  const startTalk = () => {
    setIsTalking(true);
    setStatus("Voice signaling started");
    sendSocket({ type: "ptt_start", timestamp: Date.now() });
  };

  const stopTalk = () => {
    if (!isTalking) return;
    setIsTalking(false);
    setStatus("Voice signaling stopped");
    sendSocket({ type: "ptt_stop", timestamp: Date.now() });
  };

  const reset = () => {
    Speech.stop();
    disconnectSocket();
    setRoom(null);
    setRole(null);
    setScreen("role");
    setStatus("Ready");
    setCatcherState("Waiting for call");
    setLastHeard("No pitch call yet.");
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

            <Pressable style={styles.primaryButton} onPress={createRoom}>
              <Text style={styles.primaryButtonText}>Coach Mode</Text>
              <Text style={styles.buttonSubtext}>Create room</Text>
            </Pressable>
            <Pressable
              style={styles.secondaryButton}
              onPress={() => {
                setRole("catcher");
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
            selectedContext={selectedContext}
            selectedLocation={selectedLocation}
            selectedPitch={selectedPitch}
            setSelectedContext={setSelectedContext}
            setSelectedLocation={setSelectedLocation}
            setSelectedPitch={setSelectedPitch}
            sendPreset={sendPitchCall}
          />
        )}

        {screen === "catcher" && (
          <CatcherScreen
            code={room?.code ?? joinCode}
            catcherState={catcherState}
            joinCode={joinCode}
            lastHeard={lastHeard}
            role={role}
            setJoinCode={setJoinCode}
            joinRoom={joinRoom}
            reset={reset}
            testAudio={() => speak("DugoutCall connected.")}
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
  onClear: () => void;
  onRepeat: () => void;
  onReset: () => void;
  onSend: () => void;
  onStartTalk: () => void;
  onStopTalk: () => void;
  selectedContext: string;
  selectedLocation: string;
  selectedPitch: string;
  setSelectedContext: (value: string) => void;
  setSelectedLocation: (value: string) => void;
  setSelectedPitch: (value: string) => void;
  sendPreset: (pitch: string, location?: string) => void;
}) {
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
  lastHeard: string;
  role: Role | null;
  setJoinCode: (value: string) => void;
  joinRoom: () => void;
  reset: () => void;
  testAudio: () => void;
}) {
  const isJoined = props.role === "catcher" && props.code.length === 6;

  return (
    <ScrollView contentContainerStyle={styles.content}>
      {!isJoined ? (
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
  screenTitle: {
    color: "#f6f1dc",
    fontSize: 34,
    fontWeight: "900"
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
  }
});
