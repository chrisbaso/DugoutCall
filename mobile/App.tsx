import { Audio, InterruptionModeAndroid, InterruptionModeIOS } from "expo-av";
import * as Speech from "expo-speech";
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
} from "react-native-webrtc";

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
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const localAudioAddedRef = useRef(false);
  const pendingIceCandidatesRef = useRef<ICECandidateMessage[]>([]);
  const creatingOfferRef = useRef(false);
  const lastSpeechAtRef = useRef(0);
  const roleRef = useRef<Role | null>(null);
  const roomCodeRef = useRef("");
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
  const [voiceStatus, setVoiceStatus] = useState("Voice ready");
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [catcherState, setCatcherState] = useState("Waiting for call");
  const [lastHeard, setLastHeard] = useState("No pitch call yet.");
  const [lastNetworkEvent, setLastNetworkEvent] = useState("No room joined");

  useEffect(() => {
    void configureAudioForPlayback();
  }, []);

  const currentPhrase = useMemo(
    () => phrase(selectedPitch, selectedLocation),
    [selectedPitch, selectedLocation]
  );

  const apiUrl = (path: string) => `${normalizeBaseUrl(backendUrl)}${path}`;

  const configureAudioForPlayback = async () => {
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      interruptionModeAndroid: InterruptionModeAndroid.DoNotMix,
      interruptionModeIOS: InterruptionModeIOS.DoNotMix,
      playThroughEarpieceAndroid: false,
      playsInSilentModeIOS: true,
      shouldDuckAndroid: false,
      staysActiveInBackground: false
    });
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

  const closeVoiceSession = () => {
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
    localAudioAddedRef.current = false;
    pendingIceCandidatesRef.current = [];
    peerRef.current?.close();
    peerRef.current = null;
    try {
      RTCAudioSession.audioSessionDidDeactivate();
    } catch {
      // Audio session cleanup is best-effort.
    }
    setRemoteStream(null);
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

  const createPeerConnection = () => {
    if (peerRef.current) return peerRef.current;

    activateWebRTCAudio();
    const peer = new RTCPeerConnection(rtcConfiguration);
    peerRef.current = peer;

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
        (stream.getAudioTracks() as any[]).forEach((track) => {
          (track as any)._setVolume?.(10);
        });
        setRemoteStream(stream);
        setCatcherState("Receiving voice");
        setVoiceStatus("Voice connected");
      }
    });

    (peer as any).addEventListener("connectionstatechange", () => {
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
      await configureAudioForPlayback();
      activateWebRTCAudio();
      const peer = createPeerConnection();
      await peer.setRemoteDescription(new RTCSessionDescription({ type: "offer", sdp: message.sdp }));
      await addPendingIceCandidates();
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      sendSocket({ type: "webrtc_answer", sdp: answer.sdp });
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
      setVoiceStatus("Starting microphone...");
      await prepareCoachAudio();
      localStreamRef.current?.getAudioTracks().forEach((track) => {
        track.enabled = true;
      });
      setIsTalking(true);
      setStatus("Live voice on");
      setVoiceStatus("Transmitting");
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
    localStreamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = false;
    });
    void configureAudioForPlayback();
    setIsTalking(false);
    setStatus("Live voice off");
    setVoiceStatus("Voice ready");
    sendSocket({ type: "ptt_stop", timestamp: Date.now() });
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

        {screen === "catcher" && (
          <CatcherScreen
            code={room?.code ?? joinCode}
            catcherState={catcherState}
            joinCode={joinCode}
            joined={role === "catcher" && Boolean(room)}
            lastHeard={lastHeard}
            lastNetworkEvent={lastNetworkEvent}
            remoteStream={remoteStream}
            role={role}
            setJoinCode={setJoinCode}
            joinRoom={joinRoom}
            reset={reset}
            testAudio={playTestAudio}
            voiceStatus={voiceStatus}
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
  selectedContext: string;
  selectedLocation: string;
  selectedPitch: string;
  setSelectedContext: (value: string) => void;
  setSelectedLocation: (value: string) => void;
  setSelectedPitch: (value: string) => void;
  sendPreset: (pitch: string, location?: string) => void;
  voiceStatus: string;
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
        <Text style={styles.statusLine}>{props.lastNetworkEvent}</Text>
        <Text style={styles.voiceLine}>{props.voiceStatus}</Text>

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
  role: Role | null;
  setJoinCode: (value: string) => void;
  joinRoom: () => void;
  reset: () => void;
  testAudio: () => void;
  voiceStatus: string;
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
          {props.remoteStream && <RTCView streamURL={props.remoteStream.toURL()} style={styles.hiddenRtcView} />}
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
  },
  voiceLine: {
    color: "#f3b23f",
    fontSize: 14,
    fontWeight: "900"
  }
});
