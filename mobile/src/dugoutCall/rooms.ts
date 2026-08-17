export type RoomRole = "coach" | "catcher";
export type RoomCredentials = {
  code: string;
  mode: "game" | "practice";
  expiresAt: number;
  token: string;
  livekit?: { serverUrl: string; token: string; roomName: string } | null;
};

const normalize = (baseUrl: string) => baseUrl.trim().replace(/\/+$/, "");

export class DugoutRoomClient {
  constructor(private readonly baseUrl: string, private readonly fetcher: typeof fetch = fetch) {}

  private async post(path: string, body: object): Promise<RoomCredentials> {
    const response = await this.fetcher(`${normalize(this.baseUrl)}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body)
    });
    const payload = await response.json();
    if (!response.ok || typeof payload?.token !== "string" || !/^\d{6}$/.test(payload?.code ?? "")) {
      throw new Error(payload?.error ?? "Room service returned an invalid response.");
    }
    return payload as RoomCredentials;
  }

  create(coachName: string, teamName: string): Promise<RoomCredentials> {
    return this.post("/rooms", { coachName, teamName, mode: "game" });
  }

  join(code: string, displayName: string): Promise<RoomCredentials> {
    return this.post(`/rooms/${encodeURIComponent(code)}/join`, { role: "catcher", displayName });
  }
}

export const roomSocketJoin = (room: RoomCredentials, role: RoomRole, displayName: string) => ({
  type: "join_room" as const,
  code: room.code,
  role,
  displayName,
  token: room.token
});
