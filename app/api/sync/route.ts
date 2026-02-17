import { hasAdminAccess } from "@/lib/auth";
import { recordApiCall } from "@/lib/storage";
import { runDailySync } from "@/lib/sync";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  await recordApiCall("/api/sync");

  if (!hasAdminAccess(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await runDailySync("manual");
  const status = result.ok ? 200 : 500;
  return NextResponse.json(result, { status });
}
