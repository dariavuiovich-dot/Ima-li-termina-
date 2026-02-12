import { usingRedis } from "@/lib/storage";
import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    ok: true,
    storage: usingRedis() ? "upstash-redis" : "in-memory",
    now: new Date().toISOString()
  });
}
