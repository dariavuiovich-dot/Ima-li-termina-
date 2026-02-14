import { getDebugValue } from "@/lib/storage";
import { NextResponse } from "next/server";

export async function GET() {
  const last = await getDebugValue<unknown>("telegram:last");
  return NextResponse.json({
    ok: true,
    vercelEnv: process.env.VERCEL_ENV ?? null,
    vercelGitCommitSha: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    last: last ?? null
  });
}

