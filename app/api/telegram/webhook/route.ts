import {
  disableSubscription,
  listSubscriptions,
  setDebugValue,
  upsertSubscription
} from "@/lib/storage";
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

type SlotsApiResponse = {
  query: string;
  sourcePdfDate?: string | null;
  answer?: {
    kind?: string;
    status?: "HAS_SLOTS" | "NO_SLOTS";
    firstAvailable?: string | null;
    specialist?: string;
  };
  items?: Array<{
    status: "HAS_SLOTS" | "NO_SLOTS";
    firstAvailable: string | null;
    specialist: string;
    section: string;
  }>;
  relatedItems?: Array<{
    status: "HAS_SLOTS" | "NO_SLOTS";
    firstAvailable: string | null;
    specialist: string;
    section: string;
  }>;
  total?: number;
};

async function telegramSendMessage(chatId: number, text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;

  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text
      })
    });
  } catch (error) {
    console.error("telegram sendMessage failed:", error);
    // Don't throw; webhook must stay fast and always 200 OK.
  }
}

async function fetchSlotsForQuery(req: NextRequest, query: string): Promise<SlotsApiResponse | null> {
  const origin = new URL(req.url).origin;
  const url = `${origin}/api/slots?q=${encodeURIComponent(query)}&limit=50`;
  const res = await fetch(url, {
    method: "GET",
    headers: { "content-type": "application/json" },
    cache: "no-store",
    next: { revalidate: 0 }
  });
  if (!res.ok) return null;
  const data = (await res.json().catch(() => null)) as SlotsApiResponse | null;
  return data ?? null;
}

function formatNowAnswer(query: string, data: SlotsApiResponse): string {
  const source = data.sourcePdfDate ? `Izvjestaj: ${data.sourcePdfDate}` : null;

  const statusFromAnswer = data.answer?.status;
  const firstFromAnswer = data.answer?.firstAvailable ?? null;
  const specialistFromAnswer = data.answer?.specialist ?? null;

  // Prefer explicit answer status when available (endo/cardio/neuro combined logic).
  if (statusFromAnswer === "HAS_SLOTS") {
    const first = firstFromAnswer ?? "nepoznato";
    const line2 = specialistFromAnswer ? `Prvi dostupni termin: ${first} (${specialistFromAnswer})` : `Prvi dostupni termin: ${first}`;
    return [ "IMA TERMINA", line2, source ].filter(Boolean).join("\n");
  }

  if (statusFromAnswer === "NO_SLOTS") {
    return [ "NEMA TERMINA", source ].filter(Boolean).join("\n");
  }

  const items = Array.isArray(data.items) ? data.items : [];
  if (!items.length) {
    return [ `Nijesam nasao rezultate za: ${query}`, source ].filter(Boolean).join("\n");
  }

  // Items from /api/slots are already sorted by status and date, so the first HAS_SLOTS is the earliest one.
  const best = items.find((x) => x.status === "HAS_SLOTS" && x.firstAvailable);
  if (best) {
    return [
      "IMA TERMINA",
      `Prvi dostupni termin: ${best.firstAvailable} (${best.specialist})`,
      source,
      items.length > 1 ? "Ako zelis preciznije, posalji naziv ambulante iz liste na sajtu." : null
    ].filter(Boolean).join("\n");
  }

  return [ "NEMA TERMINA", source ].filter(Boolean).join("\n");
}

function startText(): string {
  return [
    "Ima li terminaaa!?",
    "",
    "Kako da dobijas obavjestenja:",
    "1) /sub <specijalista> (npr. /sub reumatolog)",
    "2) /list (vidi pretplate)",
    "3) /unsub <id> ili /unsuball (odjava)",
    "",
    "Provjera: samo posalji rijec (npr. reumatolog).",
    "Test odmah: /sync (pokreni provjeru sad)"
  ].join("\n");
}

function helpText(): string {
  // Keep it short (same as /start) to reduce confusion for non-technical users.
  return startText();
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

  const receivedAt = nowIso();
  const raw = await req.text().catch(() => "");

  let update: TelegramUpdate | null = null;
  let parseError: string | null = null;
  try {
    update = (raw ? (JSON.parse(raw) as TelegramUpdate) : null) ?? null;
  } catch (error) {
    parseError = error instanceof Error ? error.message : String(error);
  }

  const msg = update?.message;
  const text = String(msg?.text ?? "").trim();
  const chatId = msg?.chat?.id;

  // Save last update for debugging "bot is silent" situations.
  await setDebugValue("telegram:last", {
    receivedAt,
    parseOk: Boolean(update),
    parseError,
    rawLength: raw.length,
    updateId: update?.update_id ?? null,
    chatId: chatId ?? null,
    text: text || null,
    from: msg?.from
      ? {
          id: msg.from.id,
          username: msg.from.username ?? null,
          first_name: msg.from.first_name ?? null,
          last_name: msg.from.last_name ?? null
        }
      : null
  });

  if (!chatId || !text) {
    // Telegram expects 200 OK for webhooks even if we ignore the update.
    return NextResponse.json({ ok: true });
  }

  const userId = `tg:${chatId}`;
  const { cmd, args } = normalizeCommand(text);

  try {
    if (cmd === "/start") {
      await telegramSendMessage(chatId, startText());
      return NextResponse.json({ ok: true });
    }

    if (cmd === "/help") {
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

    // /sub -> save subscription + show current status
    if (cmd === "/sub") {
      const query = args.trim();
      if (!query) {
        await telegramSendMessage(chatId, "Usage: /sub <specijalista>");
        return NextResponse.json({ ok: true });
      }

      await telegramSendMessage(chatId, "Treba mi 10 sekundi.");
      const data = await fetchSlotsForQuery(req, query);

      const now = nowIso();
      const sub: Subscription = {
        id: randomId("sub"),
        userId,
        query,
        channel: "telegram",
        telegramChatId: String(chatId),
        active: true,
        createdAt: now,
        updatedAt: now
      };
      await upsertSubscription(sub);

      const statusText = data ? formatNowAnswer(query, data) : `Nijesam uspio da provjerim trenutno stanje za: ${query}`;
      await telegramSendMessage(chatId, `${statusText}\n\nPretplata sacuvana: ${sub.id}`);
      return NextResponse.json({ ok: true });
    }

    // Plain text -> check "right now" status (no auto-subscribe).
    const query = text.trim();
    await telegramSendMessage(chatId, "Treba mi 10 sekundi.");
    const data = await fetchSlotsForQuery(req, query);
    if (!data) {
      await telegramSendMessage(chatId, `Nijesam uspio da provjerim trenutno stanje za: ${query}`);
      return NextResponse.json({ ok: true });
    }

    await telegramSendMessage(chatId, formatNowAnswer(query, data));
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
