export interface LocalStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

type CacheEnvelope<T> = {
  schema: 1;
  deviceId: string;
  gameId: number;
  cachedAt: number;
  value: T;
};

const INDEX_KEY = "diamond-cache:v1:index";
const scopeKey = (deviceId: string, gameId: number) => `diamond-cache:v1:${encodeURIComponent(deviceId)}:${gameId}`;

export class ScoutingCacheRepository {
  constructor(private readonly store: LocalStore, private readonly now = Date.now) {}

  async write<T>(deviceId: string, gameId: number, value: T): Promise<CacheEnvelope<T>> {
    const key = scopeKey(deviceId, gameId);
    const envelope: CacheEnvelope<T> = { schema: 1, deviceId, gameId, cachedAt: this.now(), value };
    await this.store.setItem(key, JSON.stringify(envelope));
    const index = await this.index();
    if (!index.includes(key)) await this.store.setItem(INDEX_KEY, JSON.stringify([...index, key]));
    return envelope;
  }

  async read<T>(deviceId: string, gameId: number): Promise<CacheEnvelope<T> | null> {
    const raw = await this.store.getItem(scopeKey(deviceId, gameId));
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as CacheEnvelope<T>;
      if (parsed.schema !== 1 || parsed.deviceId !== deviceId || parsed.gameId !== gameId) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  async purgeAll(): Promise<void> {
    const index = await this.index();
    await Promise.all(index.map((key) => this.store.removeItem(key)));
    await this.store.removeItem(INDEX_KEY);
  }

  private async index(): Promise<string[]> {
    try {
      const value = JSON.parse((await this.store.getItem(INDEX_KEY)) ?? "[]");
      return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
    } catch {
      return [];
    }
  }
}
