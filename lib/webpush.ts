export function normalizeVapidSubject(
  raw: string | null | undefined
): string {
  const value = (raw ?? "").trim();
  if (!value) return "mailto:no-reply@example.com";

  if (/^mailto:/i.test(value) || /^https?:\/\//i.test(value)) {
    return value;
  }

  // Allow plain email in env var and normalize automatically.
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) {
    return `mailto:${value}`;
  }

  return value;
}

