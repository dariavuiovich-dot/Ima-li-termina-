import {
  SlotChange,
  SlotsSnapshot,
  Subscription,
  UserNotification,
  WebPushSubscriptionData
} from "@/lib/types";
import { normalizeForSearch, parseSlotDate, randomId } from "@/lib/utils";

export function computeChanges(
  previous: SlotsSnapshot | null,
  current: SlotsSnapshot
): SlotChange[] {
  if (!previous) {
    return current.bySpecialist
      .filter((item) => item.status === "HAS_SLOTS")
      .map((item) => ({
        key: item.key,
        section: item.section,
        specialist: item.specialist,
        reason: "NEW_SPECIALIST_WITH_SLOTS" as const,
        previousStatus: null,
        previousFirstAvailable: null,
        currentStatus: item.status,
        currentFirstAvailable: item.firstAvailable
      }));
  }

  const prevMap = new Map(previous.bySpecialist.map((x) => [x.key, x]));
  const changes: SlotChange[] = [];

  for (const currentItem of current.bySpecialist) {
    const prevItem = prevMap.get(currentItem.key);
    if (!prevItem) {
      if (currentItem.status === "HAS_SLOTS") {
        changes.push({
          key: currentItem.key,
          section: currentItem.section,
          specialist: currentItem.specialist,
          reason: "NEW_SPECIALIST_WITH_SLOTS",
          previousStatus: null,
          previousFirstAvailable: null,
          currentStatus: currentItem.status,
          currentFirstAvailable: currentItem.firstAvailable
        });
      }
      continue;
    }

    if (prevItem.status === "NO_SLOTS" && currentItem.status === "HAS_SLOTS") {
      changes.push({
        key: currentItem.key,
        section: currentItem.section,
        specialist: currentItem.specialist,
        reason: "OPENED_SLOTS",
        previousStatus: prevItem.status,
        previousFirstAvailable: prevItem.firstAvailable,
        currentStatus: currentItem.status,
        currentFirstAvailable: currentItem.firstAvailable
      });
      continue;
    }

    if (prevItem.status === "HAS_SLOTS" && currentItem.status === "HAS_SLOTS") {
      const prevDate = parseSlotDate(prevItem.firstAvailable);
      const currDate = parseSlotDate(currentItem.firstAvailable);
      if (
        prevDate &&
        currDate &&
        currDate.getTime() < prevDate.getTime() &&
        currentItem.firstAvailable !== prevItem.firstAvailable
      ) {
        changes.push({
          key: currentItem.key,
          section: currentItem.section,
          specialist: currentItem.specialist,
          reason: "EARLIER_SLOT",
          previousStatus: prevItem.status,
          previousFirstAvailable: prevItem.firstAvailable,
          currentStatus: currentItem.status,
          currentFirstAvailable: currentItem.firstAvailable
        });
      }
    }
  }

  return changes;
}

function subscriptionMatchesChange(
  subscription: Subscription,
  change: SlotChange
): boolean {
  if (!subscription.active) return false;
  const needle = normalizeForSearch(subscription.query);
  if (!needle) return false;

  const haystack = normalizeForSearch(
    `${change.specialist} ${change.section} ${change.key}`
  );

  return haystack.includes(needle);
}

function createNotification(
  subscription: Subscription,
  change: SlotChange
): UserNotification {
  const title = `Slot update: ${change.specialist}`;
  const message =
    change.reason === "OPENED_SLOTS"
      ? `Slots opened. First available: ${change.currentFirstAvailable ?? "unknown"}`
      : change.reason === "EARLIER_SLOT"
        ? `Earlier slot found: ${change.currentFirstAvailable ?? "unknown"} (was ${change.previousFirstAvailable ?? "unknown"})`
        : `New specialist with slots. First available: ${change.currentFirstAvailable ?? "unknown"}`;

  return {
    id: randomId("notif"),
    userId: subscription.userId,
    createdAt: new Date().toISOString(),
    title,
    message,
    payload: change,
    channel: subscription.channel
  };
}

async function sendWebhook(url: string, notification: UserNotification): Promise<void> {
  await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(notification)
  });
}

async function sendTelegram(
  chatId: string,
  notification: UserNotification
): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  const text = `${notification.title}\n${notification.message}`;
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text
    })
  });
}

let webPushConfigured = false;

async function sendWebPush(
  subscription: WebPushSubscriptionData,
  notification: UserNotification
): Promise<void> {
  const publicKey =
    process.env.VAPID_PUBLIC_KEY ?? process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT ?? "mailto:no-reply@example.com";
  if (!publicKey || !privateKey) return;

  const module = await import("web-push");
  const webPush = (module.default ?? module) as typeof module.default;

  if (!webPushConfigured) {
    webPush.setVapidDetails(subject, publicKey, privateKey);
    webPushConfigured = true;
  }

  await webPush.sendNotification(
    subscription as unknown as Parameters<typeof webPush.sendNotification>[0],
    JSON.stringify({
      title: notification.title,
      body: notification.message,
      data: {
        id: notification.id,
        userId: notification.userId
      }
    })
  );
}

export async function fanoutNotifications(
  subscriptions: Subscription[],
  changes: SlotChange[]
): Promise<UserNotification[]> {
  const notifications: UserNotification[] = [];

  for (const sub of subscriptions) {
    for (const change of changes) {
      if (!subscriptionMatchesChange(sub, change)) continue;

      const notification = createNotification(sub, change);
      notifications.push(notification);

      try {
        if (sub.channel === "webhook" && sub.webhookUrl) {
          await sendWebhook(sub.webhookUrl, notification);
        }
        if (sub.channel === "telegram" && sub.telegramChatId) {
          await sendTelegram(sub.telegramChatId, notification);
        }
        if (sub.channel === "web_push" && sub.pushSubscription) {
          await sendWebPush(sub.pushSubscription, notification);
        }
      } catch {
        // Delivery failures are ignored so sync stays resilient.
      }
    }
  }

  return notifications;
}
