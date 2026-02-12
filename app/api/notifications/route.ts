import { getNotifications } from "@/lib/storage";
import { NextRequest, NextResponse } from "next/server";

function toSafeLimit(value: string | null, fallback = 20): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(Math.floor(n), 200));
}

export async function GET(req: NextRequest) {
  const userId = (req.nextUrl.searchParams.get("userId") ?? "").trim();
  if (!userId) {
    return NextResponse.json(
      { error: "userId query parameter is required" },
      { status: 400 }
    );
  }

  const limit = toSafeLimit(req.nextUrl.searchParams.get("limit"), 20);
  const items = await getNotifications(userId, limit);
  return NextResponse.json({ userId, total: items.length, items });
}
