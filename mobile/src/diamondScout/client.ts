import {
  isCurrentHitter,
  isDeviceSession,
  isEventPostResult,
  isGameDetail,
  isGamesResponse,
  isLineupSummary,
  isPairingExchange,
  type CurrentHitter,
  type DeviceSession,
  type DiamondEvent,
  type EventPostResult,
  type GameDetail,
  type GameSummary,
  type LineupSummary,
  type PairingExchange
} from "./types";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class DiamondClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string
  ) {
    super(message);
  }
}

const cleanBaseUrl = (value: string) => value.trim().replace(/\/+$/, "");

export class DiamondScoutClient {
  constructor(
    private readonly baseUrl: string,
    private readonly credential: string | null,
    private readonly fetcher: FetchLike = fetch
  ) {}

  private async request<T>(path: string, validator: (value: unknown) => value is T, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set("Accept", "application/json");
    if (init.body) headers.set("Content-Type", "application/json");
    if (this.credential) headers.set("Authorization", `Bearer ${this.credential}`);
    let response: Response;
    try {
      response = await this.fetcher(`${cleanBaseUrl(this.baseUrl)}${path}`, { ...init, headers });
    } catch (error) {
      throw new DiamondClientError(error instanceof Error ? error.message : "Diamond is unreachable", 0, "network_error");
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new DiamondClientError("Diamond returned malformed JSON", response.status, "malformed_response");
    }
    if (!response.ok) {
      const envelope = payload as { error?: { code?: string; message?: string } };
      throw new DiamondClientError(
        envelope.error?.message ?? `Diamond request failed (${response.status})`,
        response.status,
        envelope.error?.code ?? "request_failed"
      );
    }
    if (!validator(payload)) throw new DiamondClientError("Diamond response does not match the pilot contract", response.status, "contract_mismatch");
    return payload;
  }

  exchangePairingCode(code: string, deviceLabel: string, appInstanceId: string): Promise<PairingExchange> {
    return this.request("/api/v1/device-pairings/exchange", isPairingExchange, {
      method: "POST",
      body: JSON.stringify({ code, device_label: deviceLabel, app_instance_id: appInstanceId })
    });
  }

  session(): Promise<DeviceSession> {
    return this.request("/api/v1/session", isDeviceSession);
  }

  async games(): Promise<GameSummary[]> {
    return (await this.request("/api/v1/games", isGamesResponse)).games;
  }

  game(gameId: number): Promise<GameDetail> {
    return this.request(`/api/v1/games/${gameId}`, isGameDetail);
  }

  createGame(payload: Record<string, unknown>): Promise<GameDetail & { created: boolean }> {
    return this.request(
      "/api/v1/games",
      (value): value is GameDetail & { created: boolean } =>
        isGameDetail(value) && typeof (value as unknown as { created?: unknown }).created === "boolean",
      { method: "POST", body: JSON.stringify(payload) }
    );
  }

  currentHitter(gameId: number): Promise<CurrentHitter> {
    return this.request(`/api/v1/games/${gameId}/current-hitter`, isCurrentHitter);
  }

  lineupSummaries(gameId: number): Promise<LineupSummary> {
    return this.request(`/api/v1/games/${gameId}/lineup-summaries`, isLineupSummary);
  }

  postEvents(gameId: number, events: DiamondEvent[]): Promise<EventPostResult> {
    return this.request(`/api/v1/games/${gameId}/events`, isEventPostResult, {
      method: "POST",
      body: JSON.stringify({ events })
    });
  }

  advance(gameId: number, payload: Record<string, unknown>): Promise<CurrentHitter & { advanced: boolean; event_id: string }> {
    return this.request(
      `/api/v1/games/${gameId}/advance`,
      (value): value is CurrentHitter & { advanced: boolean; event_id: string } =>
        isCurrentHitter(value) &&
        typeof (value as { advanced?: unknown }).advanced === "boolean",
      { method: "POST", body: JSON.stringify(payload) }
    );
  }

  telemetry(eventType: string, metadata?: Record<string, string | number | boolean>): Promise<{ accepted: true }> {
    return this.request(
      "/api/v1/telemetry",
      (value): value is { accepted: true } => typeof value === "object" && value !== null && (value as { accepted?: unknown }).accepted === true,
      { method: "POST", body: JSON.stringify({ event_type: eventType, metadata }) }
    );
  }
}
