import { usingRedis } from "@/lib/storage";
import { NextResponse } from "next/server";

export async function GET() {
  const adminRaw = process.env.ADMIN_API_TOKEN;
  const cronRaw = process.env.CRON_SECRET;

  const normalize = (v: string | undefined): string | null => {
    if (!v) return null;
    let x = v.trim();
    if (
      (x.startsWith("\"") && x.endsWith("\"")) ||
      (x.startsWith("'") && x.endsWith("'"))
    ) {
      x = x.slice(1, -1).trim();
    }
    if (/^(ADMIN_API_TOKEN|CRON_SECRET)\s*=/.test(x)) {
      x = x.replace(/^(ADMIN_API_TOKEN|CRON_SECRET)\s*=\s*/i, "").trim();
    }
    return x || null;
  };

  const vapidPublic =
    process.env.VAPID_PUBLIC_KEY ?? process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const vapidPrivate = process.env.VAPID_PRIVATE_KEY;

  return NextResponse.json({
    ok: true,
    storage: usingRedis() ? "upstash-redis" : "in-memory",
    now: new Date().toISOString(),
    vercelEnv: process.env.VERCEL_ENV ?? null,
    vercelGit: {
      commitSha: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
      commitRef: process.env.VERCEL_GIT_COMMIT_REF ?? null
    },
    adminAuth: {
      adminTokenConfigured: !!adminRaw,
      adminTokenRawLength: adminRaw ? adminRaw.trim().length : null,
      adminTokenNormalizedLength: normalize(adminRaw)?.length ?? null,
      cronSecretConfigured: !!cronRaw,
      cronSecretRawLength: cronRaw ? cronRaw.trim().length : null,
      cronSecretNormalizedLength: normalize(cronRaw)?.length ?? null
    },
    webPush: {
      vapidPublicConfigured: !!vapidPublic,
      vapidPrivateConfigured: !!vapidPrivate
    }
  });
}
