import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { API_CONTRACT_VERSION } from "../types";

describe("committed cross-repository contract", () => {
  it("pins the API version, production paths, and call-only protection", () => {
    const contract = JSON.parse(
      readFileSync(resolve(process.cwd(), "..", "docs", "contracts", "diamond-dugoutcall-2026-08-17.json"), "utf8")
    );
    expect(contract.schema_version).toBe(API_CONTRACT_VERSION);
    expect(contract.required_paths["/api/v1/games/{game_id}/lineup-summaries"]).toContain("GET");
    expect(contract.required_paths).not.toHaveProperty("/api/v1/opponents/{opponent_id}/hitter-summaries");
    expect(contract.events.call_intent_projects_statistics).toBe(false);
    expect(contract.events.confirmed_outcome_projects_statistics).toBe(true);
    expect(contract.privacy.catcher_receives_diamond_credential).toBe(false);
  });
});
