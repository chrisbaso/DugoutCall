const defaultPitches = [
  "Fastball",
  "Curveball",
  "Change-up"
];
const locations = ["Up", "Down", "In", "Away", "Middle", "Up/In", "Up/Away", "Down/In", "Down/Away"];
const contexts = ["0-0", "Ahead", "Behind", "2 Strikes", "Runner On"];
const defaultPresets = [
  ["FB Away", "Fastball", "Away"],
  ["FB Up", "Fastball", "Up"],
  ["Curve Down", "Curveball", "Down"],
  ["Curve Away", "Curveball", "Away"],
  ["Change Down", "Change-up", "Down"],
  ["Change Away", "Change-up", "Away"],
  ["Waste", "Fastball", "Up/Away"],
  ["FB In", "Fastball", "In"]
];
const customizationKey = "dugoutcall.customizations.v2";

const state = {
  role: "",
  roomCode: "",
  token: "",
  socket: null,
  pitch: "",
  location: "",
  context: "",
  lastCall: "",
  localStream: null,
  peer: null,
  remoteDescriptionSet: false,
  pendingCandidates: [],
  audioUnlocked: false,
  diagnosticsTimer: null,
  clientConfig: {
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
  },
  pitchLabels: [...defaultPitches],
  presets: defaultPresets.map(([label, pitch, location]) => ({ label, pitch, location }))
};

const $ = (id) => document.getElementById(id);
const now = () => Date.now();
const clock = () => new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
const configuredServerURL = () => window.DUGOUTCALL_CONFIG?.serverUrl?.replace(/\/$/, "") || "";
const apiURL = (path) => `${configuredServerURL()}${path}`;
const baseURL = () => configuredServerURL() || window.location.origin;
const wsURL = () => {
  const url = new URL(baseURL());
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
};

function show(screenId) {
  document.querySelectorAll(".screen").forEach((screen) => screen.classList.remove("active"));
  $(screenId).classList.add("active");
  if (screenId === "customizeScreen") renderCustomizationEditors();
}

function setNetwork(text, connected = false) {
  $("networkBadge").textContent = text;
  $("networkBadge").classList.toggle("connected", connected);
}

function setCatcherDiagnostic(text) {
  const element = $("catcherDiagnostics");
  if (element) element.textContent = `${clock()} - ${text}`;
}

function setServerDiagnostic(text) {
  const element = $("serverDiagnostics");
  if (element) element.textContent = `${clock()} - ${text}`;
}

function phrase(pitch, location) {
  if (!pitch) return "";
  if (!location) return pitch;
  return `${pitch} ${location.replace("/", " ").toLowerCase()}`;
}

function renderButtons(containerId, values, key) {
  const container = $(containerId);
  container.innerHTML = "";
  values.forEach((value) => {
    const button = document.createElement("button");
    button.className = "tile";
    button.textContent = value;
    button.onclick = () => {
      state[key] = state[key] === value ? "" : value;
      syncSelection();
    };
    container.appendChild(button);
  });
}

function renderPresets() {
  const grid = $("presetGrid");
  grid.innerHTML = "";
  state.presets.forEach(({ label, pitch, location }) => {
    const button = document.createElement("button");
    button.className = "tile";
    button.textContent = label;
    button.onclick = () => sendPresetCall({ label, pitch, location }, button);
    grid.appendChild(button);
  });
}

function syncSelection() {
  document.querySelectorAll("#pitchGrid button").forEach((button) => {
    button.classList.toggle("selected", button.textContent === state.pitch);
  });
  document.querySelectorAll("#locationGrid button").forEach((button) => {
    button.classList.toggle("selected", button.textContent === state.location);
  });
  document.querySelectorAll("#contextGrid button").forEach((button) => {
    button.classList.toggle("selected", button.textContent === state.context);
  });
  updateSelectionSummary();
}

function updateSelectionSummary() {
  const text = phrase(state.pitch, state.location);
  $("selectionSummary").textContent = text || "Select pitch and location";
}

function showSentFeedback(text) {
  $("selectionSummary").textContent = `Sent: ${text}`;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchJSONWithRetry(path, options, statusElementId) {
  const delays = [0, 1200, 2500, 5000];
  let lastError = new Error("Request failed");

  for (let attempt = 0; attempt < delays.length; attempt += 1) {
    if (delays[attempt] > 0) {
      if (statusElementId) $(statusElementId).textContent = "Waking server...";
      setNetwork("Waking server");
      await sleep(delays[attempt]);
    }

    try {
      const response = await fetch(apiURL(path), { ...options, cache: "no-store" });
      if (response.ok) {
        setNetwork("Online", true);
        return response.json();
      }
      lastError = new Error(`Server returned ${response.status}`);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Network request failed");
    }
  }

  throw lastError;
}

async function createRoom() {
  $("createRoom").disabled = true;
  $("coachConnection").textContent = "Creating room...";
  const room = await fetchJSONWithRetry("/rooms", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ coachName: "Coach", teamName: "Demo", mode: "game" })
  }, "coachConnection");
  state.role = "coach";
  state.roomCode = room.code;
  state.token = room.token;
  $("coachRoomCode").textContent = room.code;
  $("coachBannerCode").textContent = room.code;
  $("coachRoomCard").classList.remove("hidden");
  $("enterCoachDashboard").classList.remove("hidden");
  $("coachConnection").textContent = "Room ready";
  $("createRoom").disabled = false;
  connectSocket("coach", room.code, "Coach");
}

async function joinRoom() {
  const code = $("joinCode").value.trim();
  if (code.length !== 6) return;
  $("joinRoom").disabled = true;
  try {
    const joined = await fetchJSONWithRetry(`/rooms/${code}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "catcher", displayName: "Catcher" })
    }, "catcherConnection");
    state.token = joined.token;
  } catch {
    $("catcherConnection").textContent = "Join failed";
    $("joinRoom").disabled = false;
    return;
  }
  state.role = "catcher";
  state.roomCode = code;
  $("catcherBannerCode").textContent = code;
  connectSocket("catcher", code, "Catcher");
  startDiagnosticsPolling(code);
  show("catcherScreen");
  playText("DugoutCall connected.");
}

function startDiagnosticsPolling(code) {
  if (state.diagnosticsTimer) window.clearInterval(state.diagnosticsTimer);
  pollDiagnostics(code);
  state.diagnosticsTimer = window.setInterval(() => pollDiagnostics(code), 2000);
}

async function pollDiagnostics(code) {
  try {
    const response = await fetchJSONWithRetry(`/rooms/${code}/diagnostics`, {
      method: "GET",
      headers: state.token ? { Authorization: `Bearer ${state.token}` } : undefined
    });
    const pitchCount = response.counters?.pitch_call || 0;
    const socketJoins = response.counters?.socket_joined || 0;
    const lastEvent = response.recentEvents?.at(-1);
    const last = lastEvent
      ? `${lastEvent.kind}${lastEvent.role ? `/${lastEvent.role}` : ""}${typeof lastEvent.recipientCount === "number" ? ` recipients=${lastEvent.recipientCount}` : ""}`
      : "none";
    setServerDiagnostic(`Server: pitches=${pitchCount}, socketJoins=${socketJoins}, last=${last}`);
  } catch (error) {
    setServerDiagnostic(`Server diagnostics unavailable: ${error.message}`);
  }
}

function connectSocket(role, code, displayName = role) {
  state.socket?.close();
  state.socket = new WebSocket(wsURL());
  setNetwork("Connecting");

  state.socket.onopen = () => {
    setNetwork("Connected", true);
    if (role === "catcher") setCatcherDiagnostic(`Socket opened for room ${code}`);
    state.socket.send(JSON.stringify({ type: "join_room", code, role, displayName, token: state.token }));
  };
  state.socket.onclose = () => {
    setNetwork("Disconnected");
    if (role === "catcher") $("catcherConnection").textContent = "Disconnected";
    if (role === "catcher") setCatcherDiagnostic("Socket disconnected");
    if (role === "coach") $("coachConnection").textContent = "Disconnected";
  };
  state.socket.onerror = () => {
    setNetwork("Socket error");
    if (role === "catcher") setCatcherDiagnostic("Socket error");
  };
  state.socket.onmessage = (event) => handleMessage(JSON.parse(event.data));
}

function send(message) {
  if (!state.socket || state.socket.readyState !== WebSocket.OPEN) {
    return;
  }
  state.socket.send(JSON.stringify(message));
}

function handleMessage(message) {
  if (message.type === "role_assigned") {
    setNetwork("Connected", true);
    if (message.role === "catcher") {
      $("catcherConnection").textContent = "Connected";
      setCatcherDiagnostic(`Catcher confirmed in room ${message.code}`);
    }
    return;
  }
  if (message.type === "pitch_call") {
    setCatcherDiagnostic(`Pitch message received: ${message.spokenText}`);
    receivePitchCall(message.spokenText);
    return;
  }
  if (message.type === "ptt_start") {
    $("catcherSubstate").textContent = "Receiving voice";
    setCatcherDiagnostic("Push-to-talk started");
    return;
  }
  if (message.type === "ptt_stop") {
    $("catcherSubstate").textContent = "Waiting for call";
    setCatcherDiagnostic("Push-to-talk stopped");
    return;
  }
  if (message.type === "webrtc_offer") {
    setCatcherDiagnostic("WebRTC offer received");
    handleOffer(message.sdp);
    return;
  }
  if (message.type === "webrtc_answer") {
    setCatcherDiagnostic("WebRTC answer received");
    handleAnswer(message.sdp);
    return;
  }
  if (message.type === "ice_candidate") {
    setCatcherDiagnostic("ICE candidate received");
    handleIceCandidate(message);
  }
}

function sendPitchCall(text, pitch = state.pitch, location = state.location) {
  if (!text) return;
  state.lastCall = text;
  state.pitch = pitch || state.pitch;
  state.location = location || "";
  syncSelection();
  showSentFeedback(text);
  send({
    type: "pitch_call",
    id: crypto.randomUUID(),
    pitch,
    location,
    spokenText: text,
    timestamp: now()
  });
}

function sendPresetCall(preset, button) {
  const pitch = normalizePitchName(preset.pitch, state.pitchLabels[0]);
  const location = locations.includes(preset.location) ? preset.location : "";
  const text = phrase(pitch, location);
  button.classList.add("sent");
  window.setTimeout(() => button.classList.remove("sent"), 420);
  sendPitchCall(text, pitch, location);
}

function receivePitchCall(text) {
  $("catcherState").textContent = "Connected";
  $("catcherSubstate").textContent = "Receiving call";
  $("spokenLog").textContent = `Heard: "${text}"`;
  playText(text);
}

function playText(text) {
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 0.95;
  utterance.volume = 1;
  utterance.onend = () => {
    if (state.role === "catcher") $("catcherSubstate").textContent = "Waiting for call";
  };
  window.speechSynthesis.speak(utterance);
}

async function unlockBrowserAudio() {
  state.audioUnlocked = true;
  try {
    const remoteAudio = $("remoteAudio");
    remoteAudio.muted = false;
    await remoteAudio.play();
  } catch {
    // The element may not have a stream yet; the user gesture still helps unlock future playback.
  }
}

function createPeer() {
  const peer = new RTCPeerConnection({
    iceServers: state.clientConfig.iceServers
  });
  peer.onicecandidate = (event) => {
    if (!event.candidate) return;
    send({
      type: "ice_candidate",
      candidate: event.candidate.candidate,
      sdpMid: event.candidate.sdpMid,
      sdpMLineIndex: event.candidate.sdpMLineIndex
    });
  };
  peer.ontrack = (event) => {
    setCatcherDiagnostic("Remote voice track received");
    $("remoteAudio").srcObject = event.streams[0];
    $("remoteAudio").muted = false;
    $("remoteAudio").play().catch(() => {
      $("catcherSubstate").textContent = "Tap Play test audio to unlock audio";
      setCatcherDiagnostic("Browser blocked voice autoplay; tap Play test audio");
    });
  };
  peer.oniceconnectionstatechange = () => {
    if (state.role === "catcher") setCatcherDiagnostic(`Voice ICE state: ${peer.iceConnectionState}`);
  };
  peer.onconnectionstatechange = () => {
    if (state.role === "catcher") setCatcherDiagnostic(`Voice connection: ${peer.connectionState}`);
  };
  return peer;
}

async function ensureCoachAudioPeer() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Microphone requires Safari/Chrome over HTTPS or localhost.");
  }
  if (!state.localStream) {
    state.localStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false
    });
    state.localStream.getAudioTracks().forEach((track) => {
      track.enabled = false;
    });
  }
  if (!state.peer) {
    state.peer = createPeer();
    state.localStream.getAudioTracks().forEach((track) => state.peer.addTrack(track, state.localStream));
    const offer = await state.peer.createOffer();
    await state.peer.setLocalDescription(offer);
    send({ type: "webrtc_offer", sdp: offer.sdp });
  }
}

async function startTalk() {
  try {
    await ensureCoachAudioPeer();
    state.localStream.getAudioTracks().forEach((track) => {
      track.enabled = true;
    });
    $("talkButton").classList.add("active");
    $("talkButton").textContent = "Talking";
    $("coachVoiceStatus").textContent = "Live voice";
    send({ type: "ptt_start", timestamp: now() });
  } catch (error) {
    $("coachNotice").textContent = error.message;
  }
}

function stopTalk() {
  if (state.localStream) {
    state.localStream.getAudioTracks().forEach((track) => {
      track.enabled = false;
    });
  }
  $("talkButton").classList.remove("active");
  $("talkButton").textContent = "Hold to Talk";
  $("coachVoiceStatus").textContent = "Voice ready";
  send({ type: "ptt_stop", timestamp: now() });
}

async function ensureCatcherPeer() {
  if (!state.peer) {
    state.peer = createPeer();
  }
}

async function handleOffer(sdp) {
  try {
    await ensureCatcherPeer();
    await state.peer.setRemoteDescription({ type: "offer", sdp });
    state.remoteDescriptionSet = true;
    await flushPendingCandidates();
    const answer = await state.peer.createAnswer();
    await state.peer.setLocalDescription(answer);
    send({ type: "webrtc_answer", sdp: answer.sdp });
    setCatcherDiagnostic("WebRTC answer sent");
  } catch (error) {
    setCatcherDiagnostic(`WebRTC offer failed: ${error.message}`);
  }
}

async function handleAnswer(sdp) {
  if (!state.peer) return;
  try {
    await state.peer.setRemoteDescription({ type: "answer", sdp });
    state.remoteDescriptionSet = true;
    await flushPendingCandidates();
  } catch (error) {
    if (state.role === "catcher") setCatcherDiagnostic(`WebRTC answer failed: ${error.message}`);
  }
}

async function handleIceCandidate(message) {
  const candidate = {
    candidate: message.candidate,
    sdpMid: message.sdpMid,
    sdpMLineIndex: message.sdpMLineIndex
  };
  if (!state.peer || !state.remoteDescriptionSet) {
    state.pendingCandidates.push(candidate);
    return;
  }
  try {
    await state.peer.addIceCandidate(candidate);
  } catch (error) {
    if (state.role === "catcher") setCatcherDiagnostic(`ICE failed: ${error.message}`);
  }
}

async function flushPendingCandidates() {
  while (state.pendingCandidates.length > 0) {
    await state.peer.addIceCandidate(state.pendingCandidates.shift());
  }
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
}

function loadCustomizations() {
  try {
    const saved = JSON.parse(localStorage.getItem(customizationKey) || "null");
    if (Array.isArray(saved?.pitchLabels) && saved.pitchLabels.length === defaultPitches.length) {
      state.pitchLabels = saved.pitchLabels.map((label, index) => cleanLabel(label, defaultPitches[index]));
    }
    if (Array.isArray(saved?.presets) && saved.presets.length > 0) {
      state.presets = saved.presets.slice(0, 12).map((preset, index) => ({
        label: cleanLabel(preset.label, defaultPresets[index]?.[0] || "Preset"),
        pitch: normalizePitchName(preset.pitch, defaultPresets[index]?.[1] || state.pitchLabels[0]),
        location: locations.includes(preset.location) ? preset.location : ""
      }));
    }
  } catch {
    resetCustomizationState();
  }
}

function cleanLabel(value, fallback) {
  const label = String(value || "").trim();
  return label ? label.slice(0, 18) : fallback;
}

function normalizePitchName(value, fallback) {
  const pitch = cleanLabel(value, fallback);
  if (state.pitchLabels.includes(pitch)) return pitch;
  const compact = pitch.toLowerCase().replace(/[^a-z0-9]/g, "");
  const match = state.pitchLabels.find((label) => label.toLowerCase().replace(/[^a-z0-9]/g, "") === compact);
  if (match) return match;
  if (compact === "changeup") return "Change-up";
  return fallback;
}

function saveCustomizations() {
  const pitchInputs = [...document.querySelectorAll("[data-pitch-index]")];
  state.pitchLabels = pitchInputs.map((input, index) => cleanLabel(input.value, defaultPitches[index]));
  const presetRows = [...document.querySelectorAll("[data-preset-index]")];
  state.presets = presetRows.map((row, index) => ({
    label: cleanLabel(row.querySelector("[data-preset-label]").value, defaultPresets[index]?.[0] || "Preset"),
    pitch: row.querySelector("[data-preset-pitch]").value,
    location: row.querySelector("[data-preset-location]").value
  }));
  localStorage.setItem(customizationKey, JSON.stringify({
    pitchLabels: state.pitchLabels,
    presets: state.presets
  }));
  renderCoachControls();
  show("coachScreen");
}

function resetCustomizationState() {
  state.pitchLabels = [...defaultPitches];
  state.presets = defaultPresets.map(([label, pitch, location]) => ({ label, pitch, location }));
}

function resetCustomizations() {
  localStorage.removeItem(customizationKey);
  resetCustomizationState();
  renderCoachControls();
  renderCustomizationEditors();
}

function renderCoachControls() {
  if (!state.pitchLabels.includes(state.pitch)) state.pitch = "";
  renderButtons("pitchGrid", state.pitchLabels, "pitch");
  renderButtons("locationGrid", locations, "location");
  renderButtons("contextGrid", contexts, "context");
  renderPresets();
  syncSelection();
}

function renderCustomizationEditors() {
  const pitchEditor = $("pitchEditor");
  pitchEditor.innerHTML = "";
  state.pitchLabels.forEach((label, index) => {
    const field = document.createElement("div");
    field.className = "editor-field";
    field.innerHTML = `
      <label>Pitch ${index + 1}</label>
      <input data-pitch-index="${index}" value="${escapeHtml(label)}" maxlength="18" />
    `;
    pitchEditor.appendChild(field);
  });

  const presetEditor = $("presetEditor");
  presetEditor.innerHTML = "";
  state.presets.forEach((preset, index) => {
    const row = document.createElement("div");
    row.className = "preset-row";
    row.dataset.presetIndex = String(index);
    row.innerHTML = `
      <div>
        <label>Button</label>
        <input data-preset-label value="${escapeHtml(preset.label)}" maxlength="18" />
      </div>
      <div>
        <label>Pitch</label>
        <select data-preset-pitch>${state.pitchLabels.map((pitch) => `<option value="${escapeHtml(pitch)}"${pitch === preset.pitch ? " selected" : ""}>${escapeHtml(pitch)}</option>`).join("")}</select>
      </div>
      <div>
        <label>Location</label>
        <select data-preset-location>
          <option value="">None</option>
          ${locations.map((location) => `<option value="${escapeHtml(location)}"${location === preset.location ? " selected" : ""}>${escapeHtml(location)}</option>`).join("")}
        </select>
      </div>
    `;
    presetEditor.appendChild(row);
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function showSecurityNotice() {
  if (window.isSecureContext || window.location.hostname === "localhost") return;
  const warning = "Push-to-talk microphone access requires HTTPS on iPhone.";
  $("coachNotice").textContent = warning;
  $("networkBadge").textContent = "HTTPS needed for mic";
}

async function loadClientConfig() {
  try {
    const response = await fetch(apiURL("/config"), { cache: "no-store" });
    if (!response.ok) return;
    const config = await response.json();
    if (Array.isArray(config.iceServers) && config.iceServers.length > 0) {
      state.clientConfig = config;
    }
  } catch {
    state.clientConfig = {
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
    };
  }
}

loadCustomizations();
renderCoachControls();
registerServiceWorker();
showSecurityNotice();
loadClientConfig();

$("coachMode").onclick = () => show("coachPairingScreen");
$("catcherMode").onclick = () => show("catcherPairingScreen");
$("createRoom").onclick = () => createRoom().catch((error) => {
  $("coachConnection").textContent = error.message || "Could not create room";
  $("createRoom").disabled = false;
});
$("enterCoachDashboard").onclick = () => show("coachScreen");
$("customizeButton").onclick = () => show("customizeScreen");
$("backToCoach").onclick = () => show("coachScreen");
$("saveCustomizations").onclick = () => saveCustomizations();
$("resetCustomizations").onclick = () => resetCustomizations();
$("joinRoom").onclick = () => joinRoom().catch(() => {
  $("catcherConnection").textContent = "Join failed";
  $("joinRoom").disabled = false;
});
$("joinCode").oninput = (event) => {
  event.target.value = event.target.value.replace(/\D/g, "").slice(0, 6);
};
$("sendCall").onclick = () => sendPitchCall(phrase(state.pitch, state.location));
$("repeatLast").onclick = () => sendPitchCall(state.lastCall);
$("clearSelection").onclick = () => {
  state.pitch = "";
  state.location = "";
  state.context = "";
  syncSelection();
};
$("testAudio").onclick = () => {
  unlockBrowserAudio();
  playText("DugoutCall connected.");
  setCatcherDiagnostic("Browser audio unlocked");
};
$("disconnect").onclick = () => {
  state.socket?.close();
  if (state.diagnosticsTimer) window.clearInterval(state.diagnosticsTimer);
  $("catcherState").textContent = "Disconnected";
  $("catcherSubstate").textContent = "Emergency disconnect";
};

const talk = $("talkButton");
talk.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  startTalk();
});
talk.addEventListener("pointerup", stopTalk);
talk.addEventListener("pointercancel", stopTalk);
talk.addEventListener("pointerleave", stopTalk);
