import type { DiamondScoutClient } from "./client";
import type { DeviceSession, PairingExchange } from "./types";

export interface SecretStore {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

export const DEVICE_CREDENTIAL_KEY = "dugoutcall.diamond.deviceCredential.v1";
export const DEVICE_PROFILE_KEY = "dugoutcall.diamond.deviceProfile.v1";
export const APP_INSTANCE_KEY = "dugoutcall.installationId.v1";

export class DevicePairingService {
  constructor(
    private readonly secrets: SecretStore,
    private readonly makeClient: (credential: string | null) => DiamondScoutClient,
    private readonly randomId: () => string
  ) {}

  async appInstanceId(): Promise<string> {
    const existing = await this.secrets.getItemAsync(APP_INSTANCE_KEY);
    if (existing) return existing;
    const created = this.randomId();
    await this.secrets.setItemAsync(APP_INSTANCE_KEY, created);
    return created;
  }

  async pair(code: string, deviceLabel = "Coach iPhone"): Promise<PairingExchange> {
    const normalized = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (normalized.length !== 8) throw new Error("Enter the 8-character Diamond pairing code.");
    const result = await this.makeClient(null).exchangePairingCode(normalized, deviceLabel, await this.appInstanceId());
    await this.secrets.setItemAsync(DEVICE_CREDENTIAL_KEY, result.credential);
    await this.secrets.setItemAsync(DEVICE_PROFILE_KEY, JSON.stringify({ device: result.device, program: result.program }));
    return result;
  }

  credential(): Promise<string | null> {
    return this.secrets.getItemAsync(DEVICE_CREDENTIAL_KEY);
  }

  async validate(): Promise<DeviceSession | null> {
    const credential = await this.credential();
    if (!credential) return null;
    return this.makeClient(credential).session();
  }

  async unpair(purgeLocalData: () => Promise<void>): Promise<void> {
    await Promise.all([
      this.secrets.deleteItemAsync(DEVICE_CREDENTIAL_KEY),
      this.secrets.deleteItemAsync(DEVICE_PROFILE_KEY),
      purgeLocalData()
    ]);
  }
}
