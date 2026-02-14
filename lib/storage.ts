import { Redis } from "@upstash/redis";
import { createClient } from "redis";
import { SlotsSnapshot, Subscription, UserNotification } from "@/lib/types";

const LATEST_SNAPSHOT_KEY = "kccg:snapshot:latest";
const SNAPSHOT_BY_DATE_PREFIX = "kccg:snapshot:date:";
const SUBSCRIPTIONS_KEY = "kccg:subscriptions";
const NOTIFICATION_PREFIX = "kccg:notifications:user:";
const MAX_NOTIFICATIONS_PER_USER = 200;
const DEBUG_PREFIX = "kccg:debug:";

type MemoryStore = {
  latestSnapshot: SlotsSnapshot | null;
  snapshotsByDate: Record<string, SlotsSnapshot>;
  subscriptions: Subscription[];
  notificationsByUser: Record<string, UserNotification[]>;
  debugByKey: Record<string, unknown>;
};

declare global {
  // eslint-disable-next-line no-var
  var __kccgMemoryStore: MemoryStore | undefined;
}

function getMemoryStore(): MemoryStore {
  if (!globalThis.__kccgMemoryStore) {
    globalThis.__kccgMemoryStore = {
      latestSnapshot: null,
      snapshotsByDate: {},
      subscriptions: [],
      notificationsByUser: {},
      debugByKey: {}
    };
  }
  return globalThis.__kccgMemoryStore;
}

function createRedisClient(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;

  if (!url || !token) return null;
  return new Redis({ url, token });
}

type RedisMode =
  | { kind: "upstash"; client: Redis }
  | { kind: "tcp"; client: ReturnType<typeof createClient>; ready: Promise<unknown> }
  | null;

function normalizeRedisUrl(raw: string): string {
  const value = raw.trim();
  if (!value) return value;
  if (value.startsWith("redis://") || value.startsWith("rediss://")) return value;

  // Allow plain host:port from Redis Cloud UI.
  const useTls = process.env.REDIS_TLS !== "false";
  const protocol = useTls ? "rediss" : "redis";
  const username = encodeURIComponent(process.env.REDIS_USERNAME ?? "default");
  const password = process.env.REDIS_PASSWORD
    ? `:${encodeURIComponent(process.env.REDIS_PASSWORD)}`
    : "";
  const auth = `${username}${password}@`;
  return `${protocol}://${auth}${value}`;
}

function createRedisMode(): RedisMode {
  const upstash = createRedisClient();
  if (upstash) return { kind: "upstash", client: upstash };

  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) return null;

  try {
    const client = createClient({ url: normalizeRedisUrl(redisUrl) });
    client.on("error", (error) => {
      console.error("Redis TCP client error:", error);
    });

    const ready = client.connect();
    return { kind: "tcp", client, ready };
  } catch (error) {
    console.error("Invalid REDIS_URL. Falling back to in-memory storage.", error);
    return null;
  }
}

const redis = createRedisMode();

async function redisGet<T>(key: string): Promise<T | null> {
  if (!redis) return null;

  if (redis.kind === "upstash") {
    try {
      return (await redis.client.get<T>(key)) ?? null;
    } catch (error) {
      console.error("Upstash redis get error:", error);
      return null;
    }
  }

  try {
    await redis.ready;
    const value = await redis.client.get(key);
    if (!value) return null;
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

async function redisSet<T>(key: string, value: T): Promise<void> {
  if (!redis) return;

  if (redis.kind === "upstash") {
    try {
      await redis.client.set(key, value);
    } catch (error) {
      console.error("Upstash redis set error:", error);
    }
    return;
  }

  try {
    await redis.ready;
    await redis.client.set(key, JSON.stringify(value));
  } catch {
    // Ignore transient Redis errors and keep app responsive.
  }
}

export function usingRedis(): boolean {
  return Boolean(redis);
}

export async function getLatestSnapshot(): Promise<SlotsSnapshot | null> {
  if (redis) {
    const value = await redisGet<SlotsSnapshot>(LATEST_SNAPSHOT_KEY);
    return value ?? null;
  }
  return getMemoryStore().latestSnapshot;
}

export async function saveSnapshot(snapshot: SlotsSnapshot): Promise<void> {
  if (redis) {
    await redisSet(LATEST_SNAPSHOT_KEY, snapshot);
    await redisSet(`${SNAPSHOT_BY_DATE_PREFIX}${snapshot.sourcePdfDate}`, snapshot);
    return;
  }

  const memory = getMemoryStore();
  memory.latestSnapshot = snapshot;
  memory.snapshotsByDate[snapshot.sourcePdfDate] = snapshot;
}

export async function listSubscriptions(userId?: string): Promise<Subscription[]> {
  if (redis) {
    const value = (await redisGet<Subscription[]>(SUBSCRIPTIONS_KEY)) ?? [];
    if (!userId) return value;
    return value.filter((x) => x.userId === userId);
  }

  const all = getMemoryStore().subscriptions;
  if (!userId) return all;
  return all.filter((x) => x.userId === userId);
}

export async function upsertSubscription(subscription: Subscription): Promise<void> {
  const all = await listSubscriptions();
  const idx = all.findIndex((x) => x.id === subscription.id);
  if (idx >= 0) all[idx] = subscription;
  else all.push(subscription);

  if (redis) {
    await redisSet(SUBSCRIPTIONS_KEY, all);
    return;
  }
  getMemoryStore().subscriptions = all;
}

export async function disableSubscription(
  id: string
): Promise<Subscription | null> {
  const all = await listSubscriptions();
  const idx = all.findIndex((x) => x.id === id);
  if (idx < 0) return null;

  const updated: Subscription = {
    ...all[idx],
    active: false,
    updatedAt: new Date().toISOString()
  };
  all[idx] = updated;

  if (redis) {
    await redisSet(SUBSCRIPTIONS_KEY, all);
  } else {
    getMemoryStore().subscriptions = all;
  }
  return updated;
}

export async function pushNotifications(
  notifications: UserNotification[]
): Promise<void> {
  if (!notifications.length) return;

  if (redis) {
    const groups = new Map<string, UserNotification[]>();
    for (const item of notifications) {
      const list = groups.get(item.userId) ?? [];
      list.push(item);
      groups.set(item.userId, list);
    }

    for (const [userId, list] of groups.entries()) {
      const key = `${NOTIFICATION_PREFIX}${userId}`;
      const existing = (await redisGet<UserNotification[]>(key)) ?? [];
      const merged = [...list, ...existing].slice(0, MAX_NOTIFICATIONS_PER_USER);
      await redisSet(key, merged);
    }
    return;
  }

  const memory = getMemoryStore();
  for (const item of notifications) {
    const existing = memory.notificationsByUser[item.userId] ?? [];
    memory.notificationsByUser[item.userId] = [item, ...existing].slice(
      0,
      MAX_NOTIFICATIONS_PER_USER
    );
  }
}

export async function getNotifications(
  userId: string,
  limit = 50
): Promise<UserNotification[]> {
  const safeLimit = Math.max(1, Math.min(limit, 200));
  if (redis) {
    const key = `${NOTIFICATION_PREFIX}${userId}`;
    const value = (await redisGet<UserNotification[]>(key)) ?? [];
    return value.slice(0, safeLimit);
  }

  return (getMemoryStore().notificationsByUser[userId] ?? []).slice(0, safeLimit);
}

export async function setDebugValue(key: string, value: unknown): Promise<void> {
  const k = `${DEBUG_PREFIX}${key}`;
  if (redis) {
    await redisSet(k, value);
    return;
  }
  getMemoryStore().debugByKey[k] = value;
}

export async function getDebugValue<T>(key: string): Promise<T | null> {
  const k = `${DEBUG_PREFIX}${key}`;
  if (redis) {
    return (await redisGet<T>(k)) ?? null;
  }
  return (getMemoryStore().debugByKey[k] as T | null) ?? null;
}
