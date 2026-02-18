import { fetchLatestSnapshot } from "@/lib/kccg";
import { computeChanges, fanoutNotifications } from "@/lib/notify";
import {
  getDebugValue,
  getMonthlyApiUsage,
  getLatestSnapshot,
  listSubscriptions,
  pushNotifications,
  saveSnapshot,
  setDebugValue
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
      await maybeSendUsageAlert80();
      return {
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
    }

    const changes = computeChanges(previous, current);
    const subscriptions = (await listSubscriptions()).filter((x) => x.active);
    const notifications = await fanoutNotifications(subscriptions, changes);

    await saveSnapshot(current);
    await pushNotifications(notifications);
    await maybeSendUsageAlert80();

    return {
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
  } catch (error) {
    return {
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
  }
}
