import { hasAdminAccess } from "@/lib/auth";
import { getMonthlyApiUsage } from "@/lib/storage";
import { NextRequest, NextResponse } from "next/server";

function safeInt(raw: string | undefined, fallback: number): number {
  const n = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

function safePercent(raw: string | undefined, fallback: number): number {
  const n = Number.parseFloat(raw ?? "");
  if (!Number.isFinite(n) || n <= 0 || n >= 1) return fallback;
  return n;
}

function parseMonth(raw: string | null): string | null {
  if (!raw) return null;
  const value = raw.trim();
  if (!/^\d{4}-\d{2}$/.test(value)) return null;
  return value;
}

function monthDays(month: string): number {
  const [y, m] = month.split("-").map((x) => Number(x));
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export async function GET(req: NextRequest) {
  if (!hasAdminAccess(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const selectedMonth = parseMonth(req.nextUrl.searchParams.get("month"));
  const usage = await getMonthlyApiUsage(selectedMonth ?? undefined);

  const now = new Date();
  const currentMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const thisMonth = usage.month === currentMonth;
  const dayOfMonth = thisMonth ? now.getUTCDate() : null;
  const daysInMonth = monthDays(usage.month);
  const monthlyLimit = safeInt(process.env.MONTHLY_API_LIMIT, 100000);
  const alertThresholdRatio = safePercent(process.env.API_USAGE_ALERT_THRESHOLD, 0.8);
  const alertThresholdCount = Math.ceil(monthlyLimit * alertThresholdRatio);
  const usagePercent = monthlyLimit > 0 ? Number(((usage.total / monthlyLimit) * 100).toFixed(2)) : null;
  const projectedTotal =
    dayOfMonth && dayOfMonth > 0
      ? Math.round((usage.total / dayOfMonth) * daysInMonth)
      : null;
  const projectedPercent =
    projectedTotal && monthlyLimit > 0
      ? Number(((projectedTotal / monthlyLimit) * 100).toFixed(2))
      : null;

  return NextResponse.json({
    ok: true,
    usage,
    pacing: {
      thisMonth,
      dayOfMonth,
      daysInMonth,
      projectedTotal,
      halfwayThreshold: 50000,
      passedHalfwayThreshold: Boolean(dayOfMonth && dayOfMonth <= 15 && usage.total >= 50000),
      monthlyLimit,
      usagePercent,
      projectedPercent,
      alertThresholdRatio,
      alertThresholdCount,
      passed80PercentThreshold: usage.total >= alertThresholdCount
    }
  });
}
