import { describe, expect, it } from "vitest";
import { readiness } from "../diagnostics";
import { createPitchCall } from "../pitchCalls";
import { roomSocketJoin } from "../rooms";

describe("DugoutCall services", () => {
  it("keeps the signed room token in socket authentication", () => {
    expect(roomSocketJoin({ code: "123456", mode: "game", expiresAt: 9, token: "signed" }, "catcher", "Catcher")).toEqual({
      type: "join_room",
      code: "123456",
      role: "catcher",
      displayName: "Catcher",
      token: "signed"
    });
  });

  it("creates correlation IDs for call intent without a statistical outcome", () => {
    const call = createPitchCall("Fastball", "Away", () => "call-1", () => 123);
    expect(call).toEqual({
      type: "pitch_call",
      id: "call-1",
      pitch: "Fastball",
      location: "Away",
      spokenText: "Fastball Away",
      timestamp: 123
    });
    expect(call).not.toHaveProperty("result");
  });

  it("reduces field checks to Ready, Warning, or Blocked", () => {
    const base = {
      backendReachable: true,
      diamondReachable: true,
      cacheAvailable: true,
      gameSelected: true,
      roomCreated: true,
      socketConnected: true,
      liveKitConnected: true,
      microphoneAllowed: true,
      catcherJoined: true,
      bluetoothRoute: true
    };
    expect(readiness(base, "coach")).toBe("Ready");
    expect(readiness({ ...base, diamondReachable: false, cacheAvailable: false }, "coach")).toBe("Warning");
    expect(readiness({ ...base, socketConnected: false }, "catcher")).toBe("Blocked");
  });
});
