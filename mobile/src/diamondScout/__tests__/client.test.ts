import { describe, expect, it, vi } from "vitest";
import { DiamondScoutClient } from "../client";
import { API_CONTRACT_VERSION } from "../types";
import { jsonResponse } from "./support";

describe("DiamondScoutClient", () => {
  it("sends the credential only to Diamond and validates the session contract", async () => {
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer device-secret");
      return jsonResponse({
        schema_version: API_CONTRACT_VERSION,
        program: { name: "Pilot Nine", season: "2026" },
        capabilities: { current_hitter: true },
        device: null,
        count_rules_version: API_CONTRACT_VERSION,
        enums: { pitch_results: ["ball"] }
      });
    });
    const session = await new DiamondScoutClient("https://diamond.example/", "device-secret", fetcher).session();
    expect(session.program.name).toBe("Pilot Nine");
    expect(fetcher).toHaveBeenCalledWith("https://diamond.example/api/v1/session", expect.any(Object));
  });

  it("fails safely on malformed JSON, contract drift, and revocation", async () => {
    const malformed = new DiamondScoutClient("https://diamond.example", "secret", async () => new Response("nope"));
    await expect(malformed.session()).rejects.toMatchObject({ code: "malformed_response" });

    const drift = new DiamondScoutClient("https://diamond.example", "secret", async () => jsonResponse({ schema_version: "old" }));
    await expect(drift.session()).rejects.toMatchObject({ code: "contract_mismatch" });

    const revoked = new DiamondScoutClient("https://diamond.example", "secret", async () =>
      jsonResponse({ error: { code: "unauthorized", message: "Revoked" } }, 401)
    );
    await expect(revoked.session()).rejects.toMatchObject({ status: 401, code: "unauthorized" });
  });

  it("uses the game-oriented lineup endpoint", async () => {
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse({
      schema_version: API_CONTRACT_VERSION,
      game_id: 7,
      opponent_id: 8,
      summaries: []
    }));
    await new DiamondScoutClient("https://diamond.example", "secret", fetcher).lineupSummaries(7);
    expect(fetcher.mock.calls[0]?.[0]).toContain("/api/v1/games/7/lineup-summaries");
    expect(fetcher.mock.calls[0]?.[0]).not.toContain("hitter-summaries");
  });
});
