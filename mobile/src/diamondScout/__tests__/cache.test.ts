import { describe, expect, it } from "vitest";
import { ScoutingCacheRepository } from "../cache";
import { MemoryStore } from "./support";

describe("ScoutingCacheRepository", () => {
  it("scopes cached scouting to both device and game", async () => {
    const store = new MemoryStore();
    const cache = new ScoutingCacheRepository(store, () => 1234);
    await cache.write("org-a-device", 9, { hitter: "A" });
    expect((await cache.read<{ hitter: string }>("org-a-device", 9))?.value.hitter).toBe("A");
    expect(await cache.read("org-b-device", 9)).toBeNull();
    expect(await cache.read("org-a-device", 10)).toBeNull();
  });

  it("purges every indexed scouting record on unpair", async () => {
    const store = new MemoryStore();
    const cache = new ScoutingCacheRepository(store);
    await cache.write("device-a", 1, { a: 1 });
    await cache.write("device-b", 2, { b: 2 });
    await cache.purgeAll();
    expect(await cache.read("device-a", 1)).toBeNull();
    expect(await cache.read("device-b", 2)).toBeNull();
  });
});
