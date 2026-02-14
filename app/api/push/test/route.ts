import { hasAdminAccess } from "@/lib/auth";
import { listSubscriptions } from "@/lib/storage";
import { NextRequest, NextResponse } from "next/server";

function getBearerToken(value: string | null): string | null {
  if (!value) return null;
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? null;
}

export async function POST(req: NextRequest) {
  if (!hasAdminAccess(req)) {
    const expected =
      (process.env.ADMIN_API_TOKEN ?? process.env.CRON_SECRET)?.trim() ?? "";
    const auth = req.headers.get("authorization");
    const bearer = getBearerToken(auth);
    const direct = req.headers.get("x-admin-token");

    return NextResponse.json(
      {
        error: "Unauthorized",
        vercelEnv: process.env.VERCEL_ENV ?? null,
        vercelGitCommitSha: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
        hint: "Provide x-admin-token: <ADMIN_API_TOKEN> or Authorization: Bearer <ADMIN_API_TOKEN>",
        expectedTokenLength: expected ? expected.length : null,
        received: {
          hasAuthorization: !!auth,
          authorizationLength: auth ? auth.length : null,
          bearerLength: bearer ? bearer.length : null,
          xAdminTokenLength: direct ? direct.trim().length : null
        }
      },
      { status: 401 }
    );
  }

  try {
    const body = await req.json().catch(() => ({}));
    const targetUserId = String(body?.userId ?? "").trim();
    const title = String(body?.title ?? "Ima li terminaaa!?").trim();
    const message = String(body?.message ?? "Test push notification").trim();

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

    const module = await import("web-push");
    const webPush = module.default ?? module;
    webPush.setVapidDetails(subject, publicKey, privateKey);

    const all = await listSubscriptions(targetUserId || undefined);
    const targets = all.filter(
      (item) =>
        item.active && item.channel === "web_push" && item.pushSubscription
    );

    let sent = 0;
    let failed = 0;

    await Promise.all(
      targets.map(async (item) => {
        try {
          await webPush.sendNotification(
            item.pushSubscription as Parameters<
              typeof webPush.sendNotification
            >[0],
            JSON.stringify({
              title,
              body: message,
              data: {
                kind: "test",
                userId: item.userId,
                subscriptionId: item.id
              }
            })
          );
          sent += 1;
        } catch (error) {
          console.error("web_push sendNotification failed:", error);
          failed += 1;
        }
      })
    );

    return NextResponse.json({
      ok: true,
      userId: targetUserId || null,
      totalTargets: targets.length,
      sent,
      failed
    });
  } catch (error) {
    console.error("push test endpoint failed:", error);
    return NextResponse.json(
      {
        error: "InternalError",
        message: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}
