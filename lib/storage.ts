import { Redis } from "@upstash/redis";
import { SlotsSnapshot, Subscription, UserNotification } from "@/lib/types";

const LATEST_SNAPSHOT_KEY = "kccg:snapshot:latest";
const SNAPSHOT_BY_DATE_PREFIX = "kccg:snapshot:date:";
const SUBSCRIPTIONS_KEY = "kccg:subscriptions";
const NOTIFICATION_PREFIX = "kccg:notifications:user:";
const MAX_NOTIFICATIONS_PER_USER = 200;

type MemoryStore = {
  latestSnapshot: SlotsSnapshot | null;
  snapshotsByDate: Record<string, SlotsSnapshot>;
  subscriptions: Subscription[];
  notificationsByUser: Record<string, UserNotification[]>;
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
      notificationsByUser: {}
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

const redis = createRedisClient();

export function usingRedis(): boolean {
  return Boolean(redis);
}

export async function getLatestSnapshot(): Promise<SlotsSnapshot | null> {
  if (redis) {
    const value = await redis.get<SlotsSnapshot>(LATEST_SNAPSHOT_KEY);
    return value ?? null;
  }
  return getMemoryStore().latestSnapshot;
}

export async function saveSnapshot(snapshot: SlotsSnapshot): Promise<void> {
  if (redis) {
    await redis.set(LATEST_SNAPSHOT_KEY, snapshot);
    await redis.set(`${SNAPSHOT_BY_DATE_PREFIX}${snapshot.sourcePdfDate}`, snapshot);
    return;
  }

  const memory = getMemoryStore();
  memory.latestSnapshot = snapshot;
  memory.snapshotsByDate[snapshot.sourcePdfDate] = snapshot;
}

export async function listSubscriptions(userId?: string): Promise<Subscription[]> {
  if (redis) {
    const value = (await redis.get<Subscription[]>(SUBSCRIPTIONS_KEY)) ?? [];
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
    await redis.set(SUBSCRIPTIONS_KEY, all);
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
    await redis.set(SUBSCRIPTIONS_KEY, all);
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
      const existing = (await redis.get<UserNotification[]>(key)) ?? [];
      const merged = [...list, ...existing].slice(0, MAX_NOTIFICATIONS_PER_USER);
      await redis.set(key, merged);
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
    const value = (await redis.get<UserNotification[]>(key)) ?? [];
    return value.slice(0, safeLimit);
  }

  return (getMemoryStore().notificationsByUser[userId] ?? []).slice(0, safeLimit);
}
