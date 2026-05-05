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
  socket: null,
  pitch: "",
  location: "",
  context: "",
  lastCall: "",
  localStream: null,
  peer: null,
  remoteDescriptionSet: false,
  pendingCandidates: [],
  clientConfig: {
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
  },
  pitchLabels: [...defaultPitches],
  presets: defaultPresets.map(([label, pitch, location]) => ({ label, pitch, location }))
};

const $ = (id) => document.getElementById(id);
const now = () => Date.now();
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

async function createRoom() {
  const response = await fetch(apiURL("/rooms"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ coachName: "Coach", teamName: "Demo", mode: "game" })
  });
  if (!response.ok) throw new Error("Could not create room");
  const room = await response.json();
  state.role = "coach";
  state.roomCode = room.code;
  $("coachRoomCode").textContent = room.code;
  $("coachBannerCode").textContent = room.code;
  $("coachRoomCard").classList.remove("hidden");
  $("enterCoachDashboard").classList.remove("hidden");
  connectSocket("coach", room.code);
}

async function joinRoom() {
  const code = $("joinCode").value.trim();
  if (code.length !== 6) return;
  const response = await fetch(apiURL(`/rooms/${code}/join`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role: "catcher", displayName: "Catcher" })
  });
  if (!response.ok) {
    $("catcherConnection").textContent = "Join failed";
    return;
  }
  state.role = "catcher";
  state.roomCode = code;
  $("catcherBannerCode").textContent = code;
  connectSocket("catcher", code);
  show("catcherScreen");
  playText("DugoutCall connected.");
}

function connectSocket(role, code) {
  state.socket?.close();
  state.socket = new WebSocket(wsURL());
  setNetwork("Connecting");

  state.socket.onopen = () => {
    setNetwork("Connected", true);
    state.socket.send(JSON.stringify({ type: "join_room", code, role, displayName: role }));
  };
  state.socket.onclose = () => {
    setNetwork("Disconnected");
    if (role === "catcher") $("catcherConnection").textContent = "Disconnected";
    if (role === "coach") $("coachConnection").textContent = "Disconnected";
  };
  state.socket.onerror = () => setNetwork("Socket error");
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
    return;
  }
  if (message.type === "pitch_call") {
    receivePitchCall(message.spokenText);
    return;
  }
  if (message.type === "ptt_start") {
    $("catcherSubstate").textContent = "Receiving voice";
    return;
  }
  if (message.type === "ptt_stop") {
    $("catcherSubstate").textContent = "Waiting for call";
    return;
  }
  if (message.type === "webrtc_offer") {
    handleOffer(message.sdp);
    return;
  }
  if (message.type === "webrtc_answer") {
    handleAnswer(message.sdp);
    return;
  }
  if (message.type === "ice_candidate") {
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
    $("remoteAudio").srcObject = event.streams[0];
    $("remoteAudio").play().catch(() => {
      $("catcherSubstate").textContent = "Tap Play test audio to unlock audio";
    });
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
  await ensureCatcherPeer();
  await state.peer.setRemoteDescription({ type: "offer", sdp });
  state.remoteDescriptionSet = true;
  await flushPendingCandidates();
  const answer = await state.peer.createAnswer();
  await state.peer.setLocalDescription(answer);
  send({ type: "webrtc_answer", sdp: answer.sdp });
}

async function handleAnswer(sdp) {
  if (!state.peer) return;
  await state.peer.setRemoteDescription({ type: "answer", sdp });
  state.remoteDescriptionSet = true;
  await flushPendingCandidates();
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
  await state.peer.addIceCandidate(candidate);
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
  $("coachConnection").textContent = error.message;
});
$("enterCoachDashboard").onclick = () => show("coachScreen");
$("customizeButton").onclick = () => show("customizeScreen");
$("backToCoach").onclick = () => show("coachScreen");
$("saveCustomizations").onclick = () => saveCustomizations();
$("resetCustomizations").onclick = () => resetCustomizations();
$("joinRoom").onclick = () => joinRoom();
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
$("testAudio").onclick = () => playText("DugoutCall connected.");
$("disconnect").onclick = () => {
  state.socket?.close();
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
