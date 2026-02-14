import { disableSubscription, listSubscriptions, upsertSubscription } from "@/lib/storage";
import { runDailySync } from "@/lib/sync";
import { Subscription } from "@/lib/types";
import { nowIso, randomId } from "@/lib/utils";
import { NextRequest, NextResponse } from "next/server";

type TelegramUpdate = {
  update_id?: number;
  message?: TelegramMessage;
};

type TelegramMessage = {
  message_id?: number;
  text?: string;
  chat: { id: number };
  from?: { id: number; username?: string; first_name?: string; last_name?: string };
};

async function telegramSendMessage(chatId: number, text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;

  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text
    })
  });
}

function helpText(): string {
  return [
    "Ima li terminaaa!? (Telegram bot)",
    "",
    "Commands:",
    "/start - show this help",
    "/id - show your chat id",
    "/test - send a test message",
    "/sync - run sync now (fetch latest KCCG PDF and send notifications)",
    "/sub <query> - subscribe to updates (example: /sub reumatolog)",
    "/list - list your subscriptions",
    "/unsub <id> - disable subscription by id",
    "/unsuball - disable all subscriptions",
    "",
    "Tip: you can also just send a word (example: reumatolog) and it will be treated as /sub."
  ].join("\n");
}

function normalizeCommand(raw: string): { cmd: string; args: string } {
  const text = raw.trim();
  if (!text) return { cmd: "", args: "" };

  const firstSpace = text.indexOf(" ");
  const head = (firstSpace >= 0 ? text.slice(0, firstSpace) : text).trim();
  const args = (firstSpace >= 0 ? text.slice(firstSpace + 1) : "").trim();

  // Telegram can send /cmd@botname
  const cmd = head.split("@")[0].toLowerCase();
  return { cmd, args };
}

export async function GET() {
  // Simple reachability check for debugging webhook URL.
  return NextResponse.json({
    ok: true,
    vercelEnv: process.env.VERCEL_ENV ?? null,
    vercelGitCommitSha: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    secretConfigured: Boolean(process.env.TELEGRAM_WEBHOOK_SECRET?.trim()),
    botTokenConfigured: Boolean(process.env.TELEGRAM_BOT_TOKEN?.trim())
  });
}

export async function POST(req: NextRequest) {
  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (expectedSecret) {
    const header = req.headers.get("x-telegram-bot-api-secret-token") ?? "";
    if (header.trim() !== expectedSecret.trim()) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const update = (await req.json().catch(() => null)) as TelegramUpdate | null;
  const msg = update?.message;
  const text = String(msg?.text ?? "").trim();
  const chatId = msg?.chat?.id;

  if (!chatId || !text) {
    // Telegram expects 200 OK for webhooks even if we ignore the update.
    return NextResponse.json({ ok: true });
  }

  const userId = `tg:${chatId}`;
  const { cmd, args } = normalizeCommand(text);

  try {
    if (cmd === "/start" || cmd === "/help") {
      await telegramSendMessage(chatId, helpText());
      return NextResponse.json({ ok: true });
    }

    if (cmd === "/test") {
      await telegramSendMessage(chatId, "OK. Bot is alive.");
      return NextResponse.json({ ok: true });
    }

    if (cmd === "/sync") {
      await telegramSendMessage(chatId, "Running sync... (this can take ~10-30s)");
      const result = await runDailySync("telegram");
      await telegramSendMessage(
        chatId,
        result.ok
          ? [
              "Sync done.",
              `sourcePdfDate: ${result.sourcePdfDate ?? "-"}`,
              `changes: ${result.changesCount}`,
              `notifications: ${result.notificationsCount}`,
              result.skipped ? `skipped: yes (${result.reason ?? "no changes"})` : "skipped: no"
            ].join("\n")
          : `Sync failed: ${result.reason ?? "unknown error"}`
      );
      return NextResponse.json({ ok: true });
    }

    if (cmd === "/id") {
      await telegramSendMessage(chatId, `chat_id: ${chatId}\nuser_id: ${userId}`);
      return NextResponse.json({ ok: true });
    }

    if (cmd === "/list") {
      const items = (await listSubscriptions(userId)).slice(0, 25);
      if (!items.length) {
        await telegramSendMessage(chatId, "No subscriptions yet. Use /sub <query>.");
        return NextResponse.json({ ok: true });
      }

      const lines = items.map((x) => `${x.id} | ${x.active ? "ON" : "OFF"} | ${x.query}`);
      await telegramSendMessage(chatId, ["Your subscriptions:", ...lines].join("\n"));
      return NextResponse.json({ ok: true });
    }

    if (cmd === "/unsuball") {
      const items = await listSubscriptions(userId);
      let count = 0;
      for (const item of items) {
        if (!item.active) continue;
        await disableSubscription(item.id);
        count += 1;
      }
      await telegramSendMessage(chatId, `Disabled: ${count}`);
      return NextResponse.json({ ok: true });
    }

    if (cmd === "/unsub") {
      const id = args.split(/\s+/)[0]?.trim();
      if (!id) {
        await telegramSendMessage(chatId, "Usage: /unsub <id>");
        return NextResponse.json({ ok: true });
      }

      const items = await listSubscriptions(userId);
      const owned = items.find((x) => x.id === id);
      if (!owned) {
        await telegramSendMessage(chatId, "Not found. Use /list to see ids.");
        return NextResponse.json({ ok: true });
      }

      await disableSubscription(id);
      await telegramSendMessage(chatId, `Disabled: ${id}`);
      return NextResponse.json({ ok: true });
    }

    // /sub or plain text -> create a subscription.
    const query = cmd === "/sub" ? args : text;
    if (!query.trim()) {
      await telegramSendMessage(chatId, "Usage: /sub <query>");
      return NextResponse.json({ ok: true });
    }

    const now = nowIso();
    const sub: Subscription = {
      id: randomId("sub"),
      userId,
      query: query.trim(),
      channel: "telegram",
      telegramChatId: String(chatId),
      active: true,
      createdAt: now,
      updatedAt: now
    };
    await upsertSubscription(sub);
    await telegramSendMessage(chatId, `Saved subscription:\n${sub.id}\nQuery: ${sub.query}`);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("telegram webhook error:", error);
    // Still return 200 OK so Telegram doesn't retry aggressively.
    await telegramSendMessage(
      chatId,
      "Something went wrong while processing your command. Try again in a minute."
    ).catch(() => {});
    return NextResponse.json({ ok: true });
  }
}
