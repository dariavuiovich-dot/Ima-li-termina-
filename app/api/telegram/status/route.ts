import { NextResponse } from "next/server";

type TgOk<T> = { ok: true; result: T };
type TgErr = { ok: false; error_code?: number; description?: string };

async function tgGet<T>(token: string, method: string): Promise<TgOk<T> | TgErr> {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "GET",
    headers: { "content-type": "application/json" },
    next: { revalidate: 0 }
  });
  const data = (await res.json().catch(() => null)) as unknown;
  return (data ?? { ok: false, description: "Invalid JSON from Telegram" }) as
    | TgOk<T>
    | TgErr;
}

async function tgPost<T>(
  token: string,
  method: string,
  body: Record<string, unknown>
): Promise<TgOk<T> | TgErr> {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    next: { revalidate: 0 }
  });
  const data = (await res.json().catch(() => null)) as unknown;
  return (data ?? { ok: false, description: "Invalid JSON from Telegram" }) as
    | TgOk<T>
    | TgErr;
}

export async function GET(req: Request) {
  const token = process.env.TELEGRAM_BOT_TOKEN ?? "";
  const secretConfigured = Boolean(process.env.TELEGRAM_WEBHOOK_SECRET?.trim());

  if (!token.trim()) {
    return NextResponse.json(
      {
        ok: false,
        error: "TELEGRAM_BOT_TOKEN is not configured",
        vercelEnv: process.env.VERCEL_ENV ?? null,
        vercelGitCommitSha: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
        secretConfigured
      },
      { status: 500 }
    );
  }

  const [me, webhook] = await Promise.all([
    tgGet<{ id: number; is_bot: boolean; username?: string; first_name?: string }>(
      token,
      "getMe"
    ),
    tgGet<{
      url?: string;
      has_custom_certificate?: boolean;
      pending_update_count?: number;
      last_error_date?: number;
      last_error_message?: string;
      max_connections?: number;
      ip_address?: string;
    }>(token, "getWebhookInfo")
  ]);

  // Self-heal: if webhook isn't set (or points somewhere else), set it to this deployment.
  let origin: string | null = null;
  try {
    origin = new URL(req.url).origin;
  } catch {
    origin = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null;
  }
  const desiredUrl = origin ? `${origin}/api/telegram/webhook` : null;

  let installAttempted = false;
  let installResult: TgOk<unknown> | TgErr | null = null;
  let webhookAfter = webhook;

  const currentUrl =
    webhook.ok && webhook.result && typeof webhook.result.url === "string" ? webhook.result.url : "";

  if (desiredUrl && (!currentUrl || currentUrl !== desiredUrl)) {
    installAttempted = true;
    installResult = await tgPost(token, "setWebhook", {
      url: desiredUrl,
      // If TELEGRAM_WEBHOOK_SECRET is set, Telegram will include it in every webhook request header.
      secret_token: process.env.TELEGRAM_WEBHOOK_SECRET?.trim() || undefined
    });

    // Fetch again to show the final state.
    webhookAfter = await tgGet<{
      url?: string;
      has_custom_certificate?: boolean;
      pending_update_count?: number;
      last_error_date?: number;
      last_error_message?: string;
      max_connections?: number;
      ip_address?: string;
    }>(token, "getWebhookInfo");
  }

  return NextResponse.json({
    ok: true,
    vercelEnv: process.env.VERCEL_ENV ?? null,
    vercelGitCommitSha: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    secretConfigured,
    telegram: {
      me,
      webhook: webhookAfter,
      webhookDesiredUrl: desiredUrl,
      webhookInstallAttempted: installAttempted,
      webhookInstallResult: installResult
    }
  });
}
