const POLIKLINIKA_URL = "https://www.kccg.me/poliklinika/poliklinika-kccg/";

export type DoctorScheduleItem = {
  id: string;
  ambulanta: string;
  doctor: string;
  schedule: string;
  ambulantaHours: string | null;
  location: string | null;
  sourceUrl: string;
};

type RawAccordionItem = {
  ambulanta: string;
  html: string;
};

const DOCTOR_NAME_REGEX =
  /(?:prof\.?|doc\.?|prim\.?|mr\.?\s*sc\.?\s*med\.?|dr\.?\s*sc\.?\s*med\.?|dr\.?)\s+[\p{L}][\p{L}\-']+(?:\s+[\p{L}][\p{L}\-']+){0,4}/giu;

function decodeHtmlEntities(input: string): string {
  const named: Record<string, string> = {
    nbsp: " ",
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    ndash: "-",
    mdash: "-",
    rsquo: "'",
    lsquo: "'",
    rdquo: '"',
    ldquo: '"'
  };

  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (_m, entity: string) => {
    if (entity.startsWith("#x") || entity.startsWith("#X")) {
      const code = Number.parseInt(entity.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : "";
    }
    if (entity.startsWith("#")) {
      const code = Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : "";
    }
    return named[entity] ?? "";
  });
}

function stripHtmlToLines(html: string): string[] {
  const normalized = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, " ");

  return decodeHtmlEntities(normalized)
    .replace(/\u00a0/g, " ")
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function normalizeSearch(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "dj")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokenVariants(token: string): string[] {
  const out = new Set<string>([token]);

  if (token.startsWith("neurolog") || token.startsWith("nevrolog")) {
    out.add("neuro");
    out.add("neurol");
    out.add("nevrol");
  }

  if (token.startsWith("endokrinolog") || token.startsWith("endocrinolog")) {
    out.add("endokrin");
    out.add("endocrin");
  }

  if (token.startsWith("kardiolog")) {
    out.add("kardio");
    out.add("kardiol");
  }

  if (
    token.startsWith("pulmolog") ||
    token.startsWith("pulmonolog") ||
    token.startsWith("pneumolog")
  ) {
    out.add("pulmolo");
    out.add("pulmolos");
    out.add("pulmon");
    out.add("pneumo");
  }

  if (token.startsWith("dermatolog")) {
    out.add("dermato");
  }

  return [...out];
}

function extractAccordionItems(pageHtml: string): RawAccordionItem[] {
  const items: RawAccordionItem[] = [];
  const regex =
    /jet-toggle__label-text">([^<]+)<\/div>[\s\S]*?jet-toggle__content-inner">([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/gi;

  for (const match of pageHtml.matchAll(regex)) {
    const ambulanta = decodeHtmlEntities(match[1] ?? "").replace(/\s+/g, " ").trim();
    const html = match[2] ?? "";
    if (!ambulanta || !html) continue;
    items.push({ ambulanta, html });
  }
  return items;
}

function extractLocation(lines: string[]): string | null {
  const idx = lines.findIndex((line) => /lokacija/i.test(line));
  if (idx < 0) return null;
  for (let i = idx + 1; i < Math.min(lines.length, idx + 5); i += 1) {
    const candidate = lines[i];
    if (!candidate) continue;
    if (/potrebne informacije|telefon|radno vrijeme|ordinira|ordiniraju/i.test(candidate)) {
      continue;
    }
    return candidate;
  }
  return null;
}

function extractAmbulantaHours(lines: string[]): string | null {
  for (const line of lines) {
    if (/ljekari?\s+ordiniraju|radno\s+vrijeme/i.test(line)) {
      return line.replace(/\s+/g, " ").replace(/[:;.,\s]+$/g, "").trim();
    }
  }
  return null;
}

function cleanHoursLine(line: string): string {
  return line.replace(/\s+/g, " ").replace(/[:;.,\s]+$/g, "").trim();
}

function scheduleFromHoursLine(line: string): string | null {
  const normalized = cleanHoursLine(line)
    .replace(/^ljekari?\s+ordiniraju\s*/i, "")
    .trim();
  return normalized || null;
}

function containsDoctorMarker(line: string): boolean {
  return /\b(dr|doc\.?|prof\.?|prim\.?|mr\.?)\b/i.test(line);
}

function containsScheduleMarker(line: string): boolean {
  return /(poned|utor|srijed|cetvrt|četvrt|petak|subot|nedjel|nedelj|svake|svakog|od\s*\d{1,2}|ordinira|ordiniraju)/i.test(
    line
  );
}

function extractDoctorNames(line: string): string[] {
  const found = line.match(DOCTOR_NAME_REGEX);
  if (!found) return [];
  const cleaned = found.map((x) =>
    x
      .replace(/\s+/g, " ")
      .replace(/\b(ordinira|od|do|u|na|sa)\b.*$/i, "")
      .trim()
  );
  return [...new Set(cleaned.filter(Boolean))];
}

function cleanScheduleLine(line: string): string {
  const withoutNames = line.replace(DOCTOR_NAME_REGEX, " ");
  const normalized = withoutNames
    .replace(/\s+/g, " ")
    .replace(/\s*:\s*:/g, ": ")
    .replace(/:\s*(,|;|i)\b/gi, ": ")
    .replace(/\(\s*\)/g, " ")
    .replace(/\s+,/g, ",")
    .replace(/\s+;/g, ";")
    .trim()
    .replace(/[:;,\s]+$/g, "")
    .trim();
  return normalized || line;
}

function buildId(parts: string[]): string {
  return parts
    .map((p) => normalizeSearch(p))
    .join("|")
    .slice(0, 220);
}

function parseDoctorSchedule(pageHtml: string): DoctorScheduleItem[] {
  const out: DoctorScheduleItem[] = [];
  const seen = new Set<string>();
  const accordions = extractAccordionItems(pageHtml);

  for (const item of accordions) {
    const lines = stripHtmlToLines(item.html);
    if (!lines.length) continue;

    const location = extractLocation(lines);
    const fallbackAmbulantaHours = extractAmbulantaHours(lines);
    let currentScheduleContext: string | null = null;
    let currentHoursContext: string | null = fallbackAmbulantaHours;

    for (const line of lines) {
      const hasDoctor = containsDoctorMarker(line);
      const hasSchedule = containsScheduleMarker(line);
      const hasHours = /ljekari?\s+ordiniraju|radno\s+vrijeme/i.test(line);

      if (hasHours) {
        currentHoursContext = cleanHoursLine(line);
        const hoursAsSchedule = scheduleFromHoursLine(line);
        if (hoursAsSchedule) currentScheduleContext = hoursAsSchedule;
      }

      if (hasSchedule && !hasDoctor) {
        const nextContext = cleanScheduleLine(line);
        if (nextContext) currentScheduleContext = nextContext;
        continue;
      }
      if (!hasDoctor) continue;

      const names = extractDoctorNames(line);
      if (!names.length) continue;

      const normalizedSchedule = hasSchedule
        ? cleanScheduleLine(line)
        : currentScheduleContext;
      if (hasSchedule && normalizedSchedule) {
        currentScheduleContext = normalizedSchedule;
      }
      const rowSchedule = normalizedSchedule ?? line;
      const rowHours = currentHoursContext ?? fallbackAmbulantaHours;

      for (const doctor of names) {
        const id = buildId([item.ambulanta, doctor, rowSchedule, location ?? ""]);
        if (seen.has(id)) continue;
        seen.add(id);
        out.push({
          id,
          ambulanta: item.ambulanta,
          doctor,
          schedule: rowSchedule,
          ambulantaHours: rowHours,
          location,
          sourceUrl: POLIKLINIKA_URL
        });
      }
    }
  }

  return out;
}

export async function fetchDoctorSchedule(): Promise<DoctorScheduleItem[]> {
  const res = await fetch(POLIKLINIKA_URL, {
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; KCCG-Slots/1.0)"
    },
    cache: "no-store"
  });
  if (!res.ok) {
    throw new Error(`Failed to load KCCG schedule page: ${res.status}`);
  }

  const buffer = await res.arrayBuffer();
  const html = new TextDecoder("utf-8").decode(buffer);
  return parseDoctorSchedule(html);
}

export function filterDoctorSchedule(
  items: DoctorScheduleItem[],
  query: string
): DoctorScheduleItem[] {
  const q = normalizeSearch(query);
  if (!q) return [];
  const tokenGroups = q
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => tokenVariants(token));

  const matched = items.filter((item) => {
    const hay = normalizeSearch(
      `${item.doctor} ${item.ambulanta} ${item.schedule} ${item.location ?? ""}`
    );
    return tokenGroups.every((group) => group.some((token) => hay.includes(token)));
  });

  return matched.sort((a, b) => {
    const aa = normalizeSearch(`${a.doctor} ${a.ambulanta}`);
    const bb = normalizeSearch(`${b.doctor} ${b.ambulanta}`);
    return aa.localeCompare(bb);
  });
}

export { POLIKLINIKA_URL };
