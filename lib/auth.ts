import { NextRequest } from "next/server";

function getBearerToken(value: string | null): string | null {
  if (!value) return null;
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? null;
}

export function hasCronAccess(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  const token = getBearerToken(req.headers.get("authorization"));
  return token === secret;
}

export function hasAdminAccess(req: NextRequest): boolean {
  const secret = process.env.ADMIN_API_TOKEN ?? process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";

  const bearer = getBearerToken(req.headers.get("authorization"));
  const direct = req.headers.get("x-admin-token");
  return bearer === secret || direct === secret;
}
