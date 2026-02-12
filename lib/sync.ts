import { fetchLatestSnapshot } from "@/lib/kccg";
import { computeChanges, fanoutNotifications } from "@/lib/notify";
import {
  getLatestSnapshot,
  listSubscriptions,
  pushNotifications,
  saveSnapshot
} from "@/lib/storage";
import { SyncResult } from "@/lib/types";

function snapshotsEqual(a: string, b: string): boolean {
  return a === b;
}

export async function runDailySync(trigger: string): Promise<SyncResult> {
  try {
    const previous = await getLatestSnapshot();
    const current = await fetchLatestSnapshot();

    const prevHash = previous ? JSON.stringify(previous.bySpecialist) : "";
    const currHash = JSON.stringify(current.bySpecialist);

    if (
      previous &&
      previous.sourcePdfUrl === current.sourcePdfUrl &&
      previous.sourcePdfDate === current.sourcePdfDate &&
      snapshotsEqual(prevHash, currHash)
    ) {
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
