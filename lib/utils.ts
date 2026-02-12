export function normalizeForSearch(input: string): string {
  return input
    .toLowerCase()
    .replace(/đ/g, "dj")
    .replace(/š/g, "s")
    .replace(/[čć]/g, "c")
    .replace(/ž/g, "z")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function makeKey(section: string, specialist: string): string {
  return `${section}::${specialist}`;
}

export function parseSlotDate(value: string | null): Date | null {
  if (!value) return null;
  const match = value.match(
    /^(\d{2})\.(\d{2})\.(\d{4})\.\s*(\d{2}):(\d{2})$/
  );
  if (!match) return null;

  const [, dd, mm, yyyy, hh, min] = match;
  const date = new Date(
    Number(yyyy),
    Number(mm) - 1,
    Number(dd),
    Number(hh),
    Number(min),
    0,
    0
  );
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function randomId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}
