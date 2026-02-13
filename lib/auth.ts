import { NextRequest } from "next/server";

function stripQuotes(value: string): string {
  const v = value.trim();
  if (
    (v.startsWith("\"") && v.endsWith("\"")) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    return v.slice(1, -1).trim();
  }
  return v;
}

function normalizeSecret(value: string | null | undefined): string | null {
  if (!value) return null;
  let v = stripQuotes(value);

  // Users sometimes paste "ADMIN_API_TOKEN=..." into the value field by mistake.
  // Accept that format to reduce config friction.
  if (/^(ADMIN_API_TOKEN|CRON_SECRET)\s*=/.test(v)) {
    v = v.replace(/^(ADMIN_API_TOKEN|CRON_SECRET)\s*=\s*/i, "").trim();
  }

  return v || null;
}

function getAuthToken(value: string | null): string | null {
  if (!value) return null;
  const raw = stripQuotes(value);
  const match = raw.match(/^Bearer\s+(.+)$/i);
  return (match?.[1] ?? raw).trim() || null;
}

export function hasCronAccess(req: NextRequest): boolean {
  const secret = normalizeSecret(process.env.CRON_SECRET);
  if (!secret) return process.env.NODE_ENV !== "production";
  const token = normalizeSecret(getAuthToken(req.headers.get("authorization")));
  return !!token && token === secret;
}

export function hasAdminAccess(req: NextRequest): boolean {
  const secret = normalizeSecret(
    process.env.ADMIN_API_TOKEN ?? process.env.CRON_SECRET
  );
  if (!secret) return process.env.NODE_ENV !== "production";

  const bearer = normalizeSecret(getAuthToken(req.headers.get("authorization")));
  const direct = normalizeSecret(req.headers.get("x-admin-token"));
  return (!!bearer && bearer === secret) || (!!direct && direct === secret);
}
