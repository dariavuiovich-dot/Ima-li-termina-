import {
  POLIKLINIKA_URL,
  fetchDoctorSchedule,
  filterDoctorSchedule
} from "@/lib/poliklinikaSchedule";
import { NextRequest, NextResponse } from "next/server";

function toSafeLimit(value: string | null, fallback = 50): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(Math.floor(n), 200));
}

export async function GET(req: NextRequest) {
  try {
    const query = (req.nextUrl.searchParams.get("q") ?? "").trim();
    const limit = toSafeLimit(req.nextUrl.searchParams.get("limit"), 50);

    if (!query) {
      return NextResponse.json({
        query,
        total: 0,
        items: [],
        sourceUrl: POLIKLINIKA_URL
      });
    }

    const all = await fetchDoctorSchedule();
    const matched = filterDoctorSchedule(all, query).slice(0, limit);

    return NextResponse.json({
      query,
      total: matched.length,
      items: matched,
      sourceUrl: POLIKLINIKA_URL
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
