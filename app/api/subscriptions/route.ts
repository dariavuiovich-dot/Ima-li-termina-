import { disableSubscription, listSubscriptions, upsertSubscription } from "@/lib/storage";
import { DeliveryChannel, Subscription, WebPushSubscriptionData } from "@/lib/types";
import { nowIso, randomId } from "@/lib/utils";
import { NextRequest, NextResponse } from "next/server";

function isChannel(value: string): value is DeliveryChannel {
  return (
    value === "in_app" ||
    value === "webhook" ||
    value === "telegram" ||
    value === "web_push"
  );
}

function toWebPushSubscription(value: unknown): WebPushSubscriptionData | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const endpoint = String(item.endpoint ?? "").trim();
  if (!endpoint) return null;

  const keysRaw =
    item.keys && typeof item.keys === "object"
      ? (item.keys as Record<string, unknown>)
      : undefined;

  return {
    endpoint,
    expirationTime:
      typeof item.expirationTime === "number" || item.expirationTime === null
        ? (item.expirationTime as number | null)
        : undefined,
    keys: keysRaw
      ? {
          p256dh: String(keysRaw.p256dh ?? "").trim() || undefined,
          auth: String(keysRaw.auth ?? "").trim() || undefined
        }
      : undefined
  };
}

export async function GET(req: NextRequest) {
  const userId = (req.nextUrl.searchParams.get("userId") ?? "").trim();
  if (!userId) {
    return NextResponse.json(
      { error: "userId query parameter is required" },
      { status: 400 }
    );
  }

  const items = await listSubscriptions(userId);
  return NextResponse.json({ userId, total: items.length, items });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const userId = String(body.userId ?? "").trim();
  const query = String(body.query ?? "").trim();
  const channel = String(body.channel ?? "in_app").trim();
  const webhookUrl = String(body.webhookUrl ?? "").trim();
  const telegramChatId = String(body.telegramChatId ?? "").trim();
  const pushSubscription = toWebPushSubscription(body.pushSubscription);
  const id = String(body.id ?? "").trim();

  if (!userId || !query) {
    return NextResponse.json(
      { error: "userId and query are required" },
      { status: 400 }
    );
  }
  if (!isChannel(channel)) {
    return NextResponse.json(
      { error: "channel must be one of: in_app, webhook, telegram, web_push" },
      { status: 400 }
    );
  }
  if (channel === "webhook" && !webhookUrl) {
    return NextResponse.json(
      { error: "webhookUrl is required for webhook channel" },
      { status: 400 }
    );
  }
  if (channel === "telegram" && !telegramChatId) {
    return NextResponse.json(
      { error: "telegramChatId is required for telegram channel" },
      { status: 400 }
    );
  }
  if (channel === "web_push" && !pushSubscription) {
    return NextResponse.json(
      { error: "pushSubscription is required for web_push channel" },
      { status: 400 }
    );
  }

  const now = nowIso();
  const subscription: Subscription = {
    id: id || randomId("sub"),
    userId,
    query,
    channel,
    webhookUrl: webhookUrl || undefined,
    telegramChatId: telegramChatId || undefined,
    pushSubscription: pushSubscription ?? undefined,
    active: true,
    createdAt: now,
    updatedAt: now
  };

  await upsertSubscription(subscription);
  return NextResponse.json({ ok: true, item: subscription });
}

export async function DELETE(req: NextRequest) {
  const id = (req.nextUrl.searchParams.get("id") ?? "").trim();
  if (!id) {
    return NextResponse.json(
      { error: "id query parameter is required" },
      { status: 400 }
    );
  }

  const item = await disableSubscription(id);
  if (!item) {
    return NextResponse.json({ error: "Subscription not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, item });
}
