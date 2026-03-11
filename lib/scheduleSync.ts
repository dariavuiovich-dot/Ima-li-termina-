import { fetchDoctorScheduleSnapshot } from "@/lib/poliklinikaSchedule";
import {
  getDebugValue,
  getLatestScheduleSnapshot,
  saveScheduleSnapshot,
  setDebugValue
} from "@/lib/storage";
import { DoctorScheduleItem, ScheduleSyncResult } from "@/lib/types";

function safeInt(raw: string | undefined, fallback: number): number {
  const n = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

function isWeekendUtc(now: Date): boolean {
  const day = now.getUTCDay();
  return day === 0 || day === 6;
}

function daysBetweenUtc(from: Date, to: Date): number {
  const a = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const b = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  return Math.floor((b - a) / (24 * 60 * 60 * 1000));
}

function parseIsoDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function hashSchedule(items: DoctorScheduleItem[]): string {
  return JSON.stringify(items);
}

function scheduleChangeCount(
  prev: DoctorScheduleItem[] | null,
  curr: DoctorScheduleItem[]
): number {
  if (!prev) return curr.length;
  const prevIds = new Set(prev.map((x) => x.id));
  const currIds = new Set(curr.map((x) => x.id));

  let added = 0;
  for (const id of currIds) {
    if (!prevIds.has(id)) added += 1;
  }
  let removed = 0;
  for (const id of prevIds) {
    if (!currIds.has(id)) removed += 1;
  }
  return added + removed;
}

export async function runScheduleSync(trigger: string): Promise<ScheduleSyncResult> {
  const now = new Date();
  const minDays = safeInt(process.env.SCHEDULE_SYNC_MIN_DAYS, 15);

  try {
    const previous = await getLatestScheduleSnapshot();

    if (trigger === "cron" && !isWeekendUtc(now)) {
      const result: ScheduleSyncResult = {
        ok: true,
        skipped: true,
        trigger,
        recordsCount: previous?.recordsCount ?? 0,
        changesCount: 0,
        reason: "Skipped: schedule sync via cron runs only on weekend"
      };
      await setDebugValue("schedule_sync:last_result", {
        at: now.toISOString(),
        ...result
      });
      return result;
    }

    if (trigger === "cron") {
      const lastSuccess = await getDebugValue<{ at?: string }>(
        "schedule_sync:last_success"
      );
      const lastSuccessAt = parseIsoDate(lastSuccess?.at ?? null);
      if (lastSuccessAt) {
        const diff = daysBetweenUtc(lastSuccessAt, now);
        if (diff < minDays) {
          const result: ScheduleSyncResult = {
            ok: true,
            skipped: true,
            trigger,
            recordsCount: previous?.recordsCount ?? 0,
            changesCount: 0,
            reason: `Skipped: min interval ${minDays} days (last success ${diff} days ago)`
          };
          await setDebugValue("schedule_sync:last_result", {
            at: now.toISOString(),
            ...result
          });
          return result;
        }
      }
    }

    const current = await fetchDoctorScheduleSnapshot();
    const prevHash = previous ? hashSchedule(previous.items) : "";
    const currHash = hashSchedule(current.items);

    if (previous && prevHash === currHash) {
      const result: ScheduleSyncResult = {
        ok: true,
        skipped: true,
        trigger,
        recordsCount: current.recordsCount,
        changesCount: 0,
        reason: "No schedule changes since previous snapshot"
      };
      await setDebugValue("schedule_sync:last_result", {
        at: now.toISOString(),
        ...result
      });
      await setDebugValue("schedule_sync:last_success", {
        at: now.toISOString(),
        recordsCount: current.recordsCount,
        sourceUrl: current.sourceUrl,
        unchanged: true
      });
      return result;
    }

    const changesCount = scheduleChangeCount(previous?.items ?? null, current.items);
    await saveScheduleSnapshot(current);

    const result: ScheduleSyncResult = {
      ok: true,
      skipped: false,
      trigger,
      recordsCount: current.recordsCount,
      changesCount
    };
    await setDebugValue("schedule_sync:last_result", {
      at: now.toISOString(),
      ...result
    });
    await setDebugValue("schedule_sync:last_success", {
      at: now.toISOString(),
      recordsCount: current.recordsCount,
      sourceUrl: current.sourceUrl,
      unchanged: false
    });
    return result;
  } catch (error) {
    const result: ScheduleSyncResult = {
      ok: false,
      skipped: false,
      trigger,
      recordsCount: 0,
      changesCount: 0,
      reason:
        error instanceof Error ? error.message : "Unknown schedule sync error"
    };
    await setDebugValue("schedule_sync:last_result", {
      at: now.toISOString(),
      ...result
    });
    await setDebugValue("schedule_sync:last_error", {
      at: now.toISOString(),
      trigger,
      reason: result.reason ?? "Unknown schedule sync error"
    });
    return result;
  }
}

