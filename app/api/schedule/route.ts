import {
  POLIKLINIKA_URL,
  fetchDoctorScheduleSnapshot,
  filterDoctorSchedule
} from "@/lib/poliklinikaSchedule";
import {
  getLatestScheduleSnapshot,
  recordApiCall,
  saveScheduleSnapshot
} from "@/lib/storage";
import { NextRequest, NextResponse } from "next/server";

function toSafeLimit(value: string | null, fallback = 50): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(Math.floor(n), 200));
}

export async function GET(req: NextRequest) {
  try {
    await recordApiCall("/api/schedule");

    const query = (req.nextUrl.searchParams.get("q") ?? "").trim();
    const limit = toSafeLimit(req.nextUrl.searchParams.get("limit"), 50);

    let snapshot = await getLatestScheduleSnapshot();
    if (!snapshot) {
      snapshot = await fetchDoctorScheduleSnapshot();
      await saveScheduleSnapshot(snapshot);
    }

    if (!query) {
      return NextResponse.json({
        query,
        total: 0,
        items: [],
        sourceUrl: snapshot.sourceUrl ?? POLIKLINIKA_URL,
        snapshotGeneratedAt: snapshot.generatedAt
      });
    }

    const matched = filterDoctorSchedule(snapshot.items, query).slice(0, limit);

    return NextResponse.json({
      query,
      total: matched.length,
      items: matched,
      sourceUrl: snapshot.sourceUrl ?? POLIKLINIKA_URL,
      snapshotGeneratedAt: snapshot.generatedAt
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to load doctor schedule"
      },
      { status: 500 }
    );
  }
}
