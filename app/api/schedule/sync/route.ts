import { hasAdminAccess } from "@/lib/auth";
import { recordApiCall } from "@/lib/storage";
import { runScheduleSync } from "@/lib/scheduleSync";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  await recordApiCall("/api/schedule/sync");

  if (!hasAdminAccess(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await runScheduleSync("manual");
  const status = result.ok ? 200 : 500;
  return NextResponse.json(result, { status });
}

