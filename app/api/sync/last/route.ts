import { hasAdminAccess } from "@/lib/auth";
import { getDebugValue, recordApiCall } from "@/lib/storage";
import { NextRequest, NextResponse } from "next/server";

type SyncLastResult = {
  at?: string;
  ok: boolean;
  skipped: boolean;
  trigger: string;
  sourcePdfDate: string | null;
  sourcePdfUrl: string | null;
  recordsCount: number;
  specialistsCount: number;
  changesCount: number;
  notificationsCount: number;
  reason?: string;
};

export async function GET(req: NextRequest) {
  await recordApiCall("/api/sync/last");

  if (!hasAdminAccess(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const lastResult = await getDebugValue<SyncLastResult>("sync:last_result");
  const lastQuality = await getDebugValue<unknown>("sync:last_quality");
  const lastError = await getDebugValue<unknown>("sync:last_error");
  const slotsMetaCheck = await getDebugValue<unknown>("slots:last_meta_check");
  const slotsMetaError = await getDebugValue<unknown>("slots:last_meta_error");

  return NextResponse.json({
    ok: true,
    vercelEnv: process.env.VERCEL_ENV ?? null,
    vercelGitCommitSha: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    sync: {
      lastResult: lastResult ?? null,
      lastQuality: lastQuality ?? null,
      lastError: lastError ?? null
    },
    slotsSourceCheck: {
      lastMetaCheck: slotsMetaCheck ?? null,
      lastMetaError: slotsMetaError ?? null
    }
  });
}

