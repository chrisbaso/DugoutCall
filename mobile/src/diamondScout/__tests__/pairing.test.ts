import { describe, expect, it, vi } from "vitest";
import { DevicePairingService, DEVICE_CREDENTIAL_KEY } from "../pairing";
import { MemoryStore } from "./support";

describe("DevicePairingService", () => {
  it("stores the exchanged credential in the secret store and never passes it to exchange", async () => {
    const secrets = new MemoryStore();
    const exchangePairingCode = vi.fn(async () => ({
      schema_version: "2026-08-17" as const,
      credential: "ds_private",
      device: { id: "dcd_1", label: "Coach iPhone", platform: "ios", paired_at: "now" },
      program: { name: "Pilot Nine", season: "2026" },
      scopes: ["games:read"]
    }));
    const service = new DevicePairingService(
      {
        getItemAsync: (key) => secrets.getItem(key),
        setItemAsync: (key, value) => secrets.setItem(key, value),
        deleteItemAsync: (key) => secrets.removeItem(key)
      },
      (credential) => {
        expect(credential).toBeNull();
        return { exchangePairingCode } as never;
      },
      () => "installation-1"
    );
    await service.pair("ABCD-2345");
    expect(await secrets.getItem(DEVICE_CREDENTIAL_KEY)).toBe("ds_private");
    expect(exchangePairingCode).toHaveBeenCalledWith("ABCD2345", "Coach iPhone", "installation-1");
  });

  it("purges secret and local data on unpair", async () => {
    const secrets = new MemoryStore();
    await secrets.setItem(DEVICE_CREDENTIAL_KEY, "secret");
    const purge = vi.fn(async () => undefined);
    const service = new DevicePairingService(
      {
        getItemAsync: (key) => secrets.getItem(key),
        setItemAsync: (key, value) => secrets.setItem(key, value),
        deleteItemAsync: (key) => secrets.removeItem(key)
      },
      () => ({}) as never,
      () => "id"
    );
    await service.unpair(purge);
    expect(await secrets.getItem(DEVICE_CREDENTIAL_KEY)).toBeNull();
    expect(purge).toHaveBeenCalledOnce();
  });
});
