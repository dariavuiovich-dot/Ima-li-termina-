import { fetchLatestSnapshot } from "@/lib/kccg";
import { computeChanges, fanoutNotifications } from "@/lib/notify";
import {
  getDebugValue,
  getMonthlyApiUsage,
  getLatestSnapshot,
  listSubscriptions,
  pushNotifications,
  saveSnapshot,
  setDebugValue,
  usingRedis
} from "@/lib/storage";
import { SlotsSnapshot, SyncResult } from "@/lib/types";

function snapshotsEqual(a: string, b: string): boolean {
  return a === b;
}

function snapshotScore(snapshot: SlotsSnapshot): number {
  const specialists = snapshot.bySpecialist.length;
  const hasSlots = snapshot.bySpecialist.filter((x) => x.status === "HAS_SLOTS").length;
  return snapshot.recordsCount * 5 + specialists * 8 + hasSlots;
}

function isSuspiciousSnapshot(
  current: SlotsSnapshot,
  previous: SlotsSnapshot | null
): boolean {
  const minRecords = Math.max(
    80,
    Number.parseInt(process.env.SYNC_MIN_RECORDS ?? "140", 10) || 140
  );
  const maxDropRatio = Math.min(
    0.9,
    Math.max(0.1, Number.parseFloat(process.env.SYNC_MAX_DROP_RATIO ?? "0.45") || 0.45)
  );

  if (current.recordsCount < minRecords) return true;
  if (!previous) return false;

  const prevRecords = Math.max(previous.recordsCount, 1);
  const drop = (prevRecords - current.recordsCount) / prevRecords;
  return drop > maxDropRatio;
}

function safeInt(raw: string | undefined, fallback: number): number {
  const n = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

function safePercent(raw: string | undefined, fallback: number): number {
  const n = Number.parseFloat(raw ?? "");
  if (!Number.isFinite(n) || n <= 0 || n >= 1) return fallback;
  return n;
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function parseSnapshotDate(input: string | null | undefined): Date | null {
  if (!input) return null;
  const v = input.trim();
  if (!v) return null;

  const dmY = v.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (dmY) {
    const d = Number(dmY[1]);
    const m = Number(dmY[2]);
    const y = Number(dmY[3]);
    const dt = new Date(Date.UTC(y, m - 1, d));
    return Number.isFinite(dt.getTime()) ? dt : null;
  }

  const iso = new Date(v);
  return Number.isFinite(iso.getTime()) ? iso : null;
}

function diffDaysUtc(from: Date, to: Date): number {
  const a = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const b = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  return Math.floor((b - a) / (24 * 60 * 60 * 1000));
}

async function maybeAlertRecordsDrop(
  current: SlotsSnapshot,
  previous: SlotsSnapshot | null
): Promise<void> {
  if (!previous) return;

  const minDrop = Math.max(
    1,
    Number.parseInt(process.env.OPS_RECORDS_DROP_ALERT_MIN ?? "12", 10) || 12
  );
  const delta = previous.recordsCount - current.recordsCount;
  if (delta < minDrop) return;

  const alertKey = `ops:records_drop:${current.sourcePdfDate}:${previous.recordsCount}:${current.recordsCount}:${minDrop}`;
  const alreadySent = await getDebugValue<{ sentAt: string }>(alertKey);
  if (alreadySent) return;

  await sendTelegramOpsAlert(
    [
      "Upozorenje: nakon parsiranja PDF-a broj redova je manji nego obicno.",
      `sourcePdfDate: ${current.sourcePdfDate}`,
      `records: ${current.recordsCount} (prev: ${previous.recordsCount}, delta: -${delta})`,
      `specialists: ${current.bySpecialist.length} (prev: ${previous.bySpecialist.length})`,
      "Provjeriti da li je KCCG promijenio format tabele ili je parser preskocio dio PDF-a."
    ].join("\n")
  );

  await setDebugValue(alertKey, {
    sentAt: new Date().toISOString(),
    sourcePdfDate: current.sourcePdfDate,
    previousRecordsCount: previous.recordsCount,
    currentRecordsCount: current.recordsCount,
    previousSpecialistsCount: previous.bySpecialist.length,
    currentSpecialistsCount: current.bySpecialist.length,
    delta,
    minDrop
  });
}

async function maybeSendUsageAlert80(): Promise<void> {
  const usage = await getMonthlyApiUsage();
  const monthlyLimit = safeInt(process.env.MONTHLY_API_LIMIT, 100000);
  const thresholdRatio = safePercent(process.env.API_USAGE_ALERT_THRESHOLD, 0.8);
  const thresholdCount = Math.ceil(monthlyLimit * thresholdRatio);
  if (usage.total < thresholdCount) return;

  const alertKey = `usage:alert:${usage.month}:${thresholdCount}`;
  const alreadySent = await getDebugValue<{ sentAt: string }>(alertKey);
  if (alreadySent) return;

  const percent = monthlyLimit > 0 ? Math.round((usage.total / monthlyLimit) * 100) : 0;
  await sendTelegramOpsAlert(
    [
      "Upozorenje: API usage je presao prag.",
      `Mjesec: ${usage.month}`,
      `Ukupno poziva: ${usage.total}`,
      `Limit: ${monthlyLimit}`,
      `Prag (${Math.round(thresholdRatio * 100)}%): ${thresholdCount}`,
      `Trenutno: ${percent}%`
    ].join("\n")
  );
  await setDebugValue(alertKey, {
    sentAt: new Date().toISOString(),
    usageMonth: usage.month,
    usageTotal: usage.total,
    monthlyLimit,
    thresholdCount,
    thresholdRatio
  });
}

function resolvePublicBaseUrl(): string | null {
  const direct =
    (process.env.APP_BASE_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "").trim() || null;
  if (direct) return direct.replace(/\/+$/, "");

  const vercelUrl = (process.env.VERCEL_URL ?? "").trim();
  if (vercelUrl) return `https://${vercelUrl}`.replace(/\/+$/, "");

  return null;
}

async function tgGet<T>(
  token: string,
  method: string
): Promise<{ ok: true; result: T } | { ok: false; description?: string }> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "GET",
      headers: { "content-type": "application/json" },
      next: { revalidate: 0 }
    });
    const data = (await res.json().catch(() => null)) as unknown;
    return (data ?? { ok: false, description: "Invalid JSON from Telegram" }) as
      | { ok: true; result: T }
      | { ok: false; description?: string };
  } catch (error) {
    return {
      ok: false,
      description: error instanceof Error ? error.message : "Telegram GET failed"
    };
  }
}

async function tgPost<T>(
  token: string,
  method: string,
  body: Record<string, unknown>
): Promise<{ ok: true; result: T } | { ok: false; description?: string }> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      next: { revalidate: 0 }
    });
    const data = (await res.json().catch(() => null)) as unknown;
    return (data ?? { ok: false, description: "Invalid JSON from Telegram" }) as
      | { ok: true; result: T }
      | { ok: false; description?: string };
  } catch (error) {
    return {
      ok: false,
      description: error instanceof Error ? error.message : "Telegram POST failed"
    };
  }
}

async function maybeAlertRedisFallback(): Promise<void> {
  if (process.env.VERCEL_ENV !== "production") return;
  if (usingRedis()) return;

  const alertKey = `ops:redis_fallback:${todayKey()}`;
  const alreadySent = await getDebugValue<{ sentAt: string }>(alertKey);
  if (alreadySent) return;

  await sendTelegramOpsAlert(
    [
      "Upozorenje: aplikacija je pala na in-memory storage.",
      "Redis nije aktivan (provjeriti UPSTASH/REDIS env varijable).",
      "Podaci i notifikacije nece biti trajno sacuvani dok se Redis ne vrati."
    ].join("\n")
  );

  await setDebugValue(alertKey, { sentAt: new Date().toISOString() });
}

async function maybeAlertStaleSnapshot(snapshot: SlotsSnapshot): Promise<void> {
  const staleDays = safeInt(process.env.OPS_SNAPSHOT_STALE_DAYS, 2);
  const sourceDate = parseSnapshotDate(snapshot.sourcePdfDate);
  if (!sourceDate) return;

  const ageDays = diffDaysUtc(sourceDate, new Date());
  if (ageDays < staleDays) return;

  const alertKey = `ops:stale_snapshot:${snapshot.sourcePdfDate}:${staleDays}`;
  const alreadySent = await getDebugValue<{ sentAt: string }>(alertKey);
  if (alreadySent) return;

  await sendTelegramOpsAlert(
    [
      "Upozorenje: source PDF izgleda zastarjelo.",
      `sourcePdfDate: ${snapshot.sourcePdfDate}`,
      `starost: ${ageDays} dana`,
      `sourcePdfUrl: ${snapshot.sourcePdfUrl}`
    ].join("\n")
  );

  await setDebugValue(alertKey, {
    sentAt: new Date().toISOString(),
    sourcePdfDate: snapshot.sourcePdfDate,
    sourcePdfUrl: snapshot.sourcePdfUrl,
    ageDays,
    staleDays
  });
}

async function maybeEnsureTelegramWebhook(): Promise<void> {
  if (process.env.OPS_TELEGRAM_WEBHOOK_SELF_HEAL === "false") return;

  const token = (process.env.TELEGRAM_BOT_TOKEN ?? "").trim();
  if (!token) return;

  const baseUrl = resolvePublicBaseUrl();
  if (!baseUrl) return;
  const desiredUrl = `${baseUrl}/api/telegram/webhook`;

  const info = await tgGet<{
    url?: string;
    pending_update_count?: number;
    last_error_message?: string;
  }>(token, "getWebhookInfo");

  if (!info.ok) {
    const errKey = `ops:telegram_webhook_info_error:${todayKey()}`;
    const already = await getDebugValue<{ sentAt: string }>(errKey);
    if (!already) {
      await sendTelegramOpsAlert(
        `Upozorenje: getWebhookInfo neuspjesan (${info.description ?? "unknown error"}).`
      );
      await setDebugValue(errKey, {
        sentAt: new Date().toISOString(),
        description: info.description ?? null
      });
    }
    return;
  }

  const currentUrl = (info.result.url ?? "").trim();
  if (currentUrl === desiredUrl) {
    await setDebugValue("ops:telegram_webhook_last", {
      checkedAt: new Date().toISOString(),
      desiredUrl,
      currentUrl,
      pendingUpdateCount: info.result.pending_update_count ?? null,
      lastErrorMessage: info.result.last_error_message ?? null,
      status: "ok"
    });
    return;
  }

  const secret = (process.env.TELEGRAM_WEBHOOK_SECRET ?? "").trim() || undefined;
  const set = await tgPost<unknown>(token, "setWebhook", {
    url: desiredUrl,
    secret_token: secret
  });

  await setDebugValue("ops:telegram_webhook_last", {
    checkedAt: new Date().toISOString(),
    desiredUrl,
    previousUrl: currentUrl,
    status: set.ok ? "repaired" : "error",
    error: set.ok ? null : set.description ?? "setWebhook failed"
  });

  if (!set.ok) {
    const errKey = `ops:telegram_webhook_set_error:${todayKey()}`;
    const already = await getDebugValue<{ sentAt: string }>(errKey);
    if (!already) {
      await sendTelegramOpsAlert(
        [
          "Upozorenje: Telegram webhook auto-heal nije uspio.",
          `desired: ${desiredUrl}`,
          `previous: ${currentUrl || "-"}`,
          `error: ${set.description ?? "unknown"}`
        ].join("\n")
      );
      await setDebugValue(errKey, {
        sentAt: new Date().toISOString(),
        desiredUrl,
        previousUrl: currentUrl || null,
        error: set.description ?? null
      });
    }
  }
}

async function runOpsSelfHeal(snapshot: SlotsSnapshot): Promise<void> {
  await Promise.allSettled([
    maybeSendUsageAlert80(),
    maybeAlertRedisFallback(),
    maybeAlertStaleSnapshot(snapshot),
    maybeEnsureTelegramWebhook()
  ]);
}

async function sendTelegramOpsAlert(text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;

  const chatIds = new Set<string>();
  const adminChatId = (process.env.ADMIN_TELEGRAM_CHAT_ID ?? "").trim();
  if (adminChatId) chatIds.add(adminChatId);

  if (!chatIds.size) {
    const subs = (await listSubscriptions()).filter(
      (x) => x.active && x.channel === "telegram" && x.telegramChatId
    );
    for (const s of subs) {
      if (s.telegramChatId) chatIds.add(String(s.telegramChatId));
    }
  }

  for (const chatId of chatIds) {
    try {
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text
        })
      });
    } catch {
      // Keep sync resilient.
    }
  }
}

export async function runDailySync(trigger: string): Promise<SyncResult> {
  try {
    const previous = await getLatestSnapshot();
    const candidates: SlotsSnapshot[] = [];
    candidates.push(await fetchLatestSnapshot());

    // Self-heal: if parse quality looks suspicious, retry immediately and keep the best candidate.
    if (isSuspiciousSnapshot(candidates[0], previous)) {
      candidates.push(await fetchLatestSnapshot());
    }

    let current = candidates[0];
    for (const s of candidates) {
      if (snapshotScore(s) > snapshotScore(current)) current = s;
    }

    const suspiciousFinal = isSuspiciousSnapshot(current, previous);
    await maybeAlertRecordsDrop(current, previous);

    if (suspiciousFinal) {
      const prevCount = previous?.recordsCount ?? 0;
      await sendTelegramOpsAlert(
        [
          "Upozorenje: moguca promjena formata KCCG PDF.",
          `sourcePdfDate: ${current.sourcePdfDate}`,
          `records: ${current.recordsCount} (prev: ${prevCount})`,
          `specialists: ${current.bySpecialist.length}`,
          "Sistem je automatski pokusao fallback parsiranje i izabrao najbolji rezultat."
        ].join("\n")
      );
    }

    await setDebugValue("sync:last_quality", {
      at: new Date().toISOString(),
      trigger,
      attempts: candidates.length,
      scores: candidates.map((x) => ({
        sourcePdfDate: x.sourcePdfDate,
        recordsCount: x.recordsCount,
        specialistsCount: x.bySpecialist.length,
        score: snapshotScore(x)
      })),
      selected: {
        sourcePdfDate: current.sourcePdfDate,
        recordsCount: current.recordsCount,
        specialistsCount: current.bySpecialist.length,
        suspicious: suspiciousFinal
      }
    });

    const prevHash = previous ? JSON.stringify(previous.bySpecialist) : "";
    const currHash = JSON.stringify(current.bySpecialist);

    if (
      previous &&
      previous.sourcePdfUrl === current.sourcePdfUrl &&
      previous.sourcePdfDate === current.sourcePdfDate &&
      snapshotsEqual(prevHash, currHash)
    ) {
      await runOpsSelfHeal(current);
      const result: SyncResult = {
        ok: true,
        skipped: true,
        trigger,
        sourcePdfDate: current.sourcePdfDate,
        sourcePdfUrl: current.sourcePdfUrl,
        recordsCount: current.recordsCount,
        specialistsCount: current.bySpecialist.length,
        changesCount: 0,
        notificationsCount: 0,
        reason: "No changes since previous snapshot"
      };
      await setDebugValue("sync:last_result", {
        at: new Date().toISOString(),
        ...result
      });
      return result;
    }

    const changes = computeChanges(previous, current);
    const subscriptions = (await listSubscriptions()).filter((x) => x.active);
    const notifications = await fanoutNotifications(subscriptions, changes);

    await saveSnapshot(current);
    await pushNotifications(notifications);
    await runOpsSelfHeal(current);

    const result: SyncResult = {
      ok: true,
      skipped: false,
      trigger,
      sourcePdfDate: current.sourcePdfDate,
      sourcePdfUrl: current.sourcePdfUrl,
      recordsCount: current.recordsCount,
      specialistsCount: current.bySpecialist.length,
      changesCount: changes.length,
      notificationsCount: notifications.length
    };
    await setDebugValue("sync:last_result", {
      at: new Date().toISOString(),
      ...result
    });
    return result;
  } catch (error) {
    const result: SyncResult = {
      ok: false,
      skipped: false,
      trigger,
      sourcePdfDate: null,
      sourcePdfUrl: null,
      recordsCount: 0,
      specialistsCount: 0,
      changesCount: 0,
      notificationsCount: 0,
      reason: error instanceof Error ? error.message : "Unknown sync error"
    };
    await setDebugValue("sync:last_result", {
      at: new Date().toISOString(),
      ...result
    });
    await setDebugValue("sync:last_error", {
      at: new Date().toISOString(),
      trigger,
      reason: result.reason ?? "Unknown sync error"
    });
    return result;
  }
}
