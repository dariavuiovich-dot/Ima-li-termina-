import { NextRequest, NextResponse } from "next/server";

type WebPushSubscriptionData = {
  endpoint: string;
  expirationTime?: number | null;
  keys?: {
    p256dh?: string;
    auth?: string;
  };
};

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

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const data = body as Record<string, unknown>;
  const sub = toWebPushSubscription(data.pushSubscription ?? data.subscription);
  if (!sub) {
    return NextResponse.json(
      { error: "pushSubscription is required" },
      { status: 400 }
    );
  }

  const title = String(data.title ?? "Ima li terminaaa!?").trim();
  const message = String(data.message ?? "Test push notification").trim();

  const publicKey =
    process.env.VAPID_PUBLIC_KEY ?? process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT ?? "mailto:no-reply@example.com";

  if (!publicKey || !privateKey) {
    return NextResponse.json(
      { error: "VAPID keys are not configured" },
      { status: 400 }
    );
  }

  try {
    const module = await import("web-push");
    const webPush = module.default ?? module;
    webPush.setVapidDetails(subject, publicKey, privateKey);

    await webPush.sendNotification(
      sub as Parameters<typeof webPush.sendNotification>[0],
      JSON.stringify({ title, body: message, data: { kind: "smoke" } })
    );

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("push smoke failed:", error);
    return NextResponse.json(
      { error: "PushSendFailed", message: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

