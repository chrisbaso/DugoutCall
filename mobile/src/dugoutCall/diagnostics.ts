export type Readiness = "Ready" | "Warning" | "Blocked";
export type ReadinessInput = {
  backendReachable: boolean;
  diamondReachable: boolean;
  cacheAvailable: boolean;
  gameSelected: boolean;
  roomCreated: boolean;
  socketConnected: boolean;
  liveKitConnected: boolean;
  microphoneAllowed: boolean;
  catcherJoined?: boolean;
  bluetoothRoute?: boolean;
};

export function readiness(input: ReadinessInput, role: "coach" | "catcher"): Readiness {
  const blocking = role === "coach"
    ? !input.backendReachable || !input.gameSelected || !input.roomCreated || !input.socketConnected || !input.microphoneAllowed
    : !input.backendReachable || !input.roomCreated || !input.socketConnected;
  if (blocking) return "Blocked";
  const warning = role === "coach"
    ? (!input.diamondReachable && !input.cacheAvailable) || !input.liveKitConnected || !input.catcherJoined
    : !input.liveKitConnected || !input.bluetoothRoute;
  return warning ? "Warning" : "Ready";
}
