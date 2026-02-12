import { hasCronAccess } from "@/lib/auth";
import { runDailySync } from "@/lib/sync";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  if (!hasCronAccess(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await runDailySync("cron");
  const status = result.ok ? 200 : 500;
  return NextResponse.json(result, { status });
}
