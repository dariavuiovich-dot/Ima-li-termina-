import { hasCronAccess } from "@/lib/auth";
import { recordApiCall } from "@/lib/storage";
import { runScheduleSync } from "@/lib/scheduleSync";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  await recordApiCall("/api/cron/schedule-sync");

  if (!hasCronAccess(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await runScheduleSync("cron");
  const status = result.ok ? 200 : 500;
  return NextResponse.json(result, { status });
}

