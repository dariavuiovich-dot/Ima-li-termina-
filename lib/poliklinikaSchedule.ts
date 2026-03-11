import { DoctorScheduleItem, DoctorScheduleSnapshot } from "@/lib/types";

const POLIKLINIKA_URL = "https://www.kccg.me/poliklinika/poliklinika-kccg/";

type RawAccordionItem = {
  ambulanta: string;
  html: string;
};

const DOCTOR_NAME_REGEX =
  /(?:(?:prof\.?|doc\.?|prim\.?|mr\.?|dr\.?)\s*)+(?:(?:sci\.?|sc\.?|med\.?)\s*)*[\p{L}][\p{L}\-']+(?:\s+(?!(?:prva?|prvi|druga?|tre(?:\u0107|c)a?|cetvrta?|zadnja|poslednja|posljednja|poslednji|posljednji|pslednji|ponedjeljak|ponedeljak|utorak|srijeda|sreda|(?:\u010d|c)?etvrtak|petak|subota|nedjelja|nedelja|u|mjesecu|od|do|h|ordinira|ordiniraju|specijalista|specijalistkinja)\b)[\p{L}][\p{L}\-']+){1,3}/giu;
const INFO_LINE_REGEX =
  /potrebne informacije|pozivom na broj|broj telefona|telefon|\bkontakt\b|u periodu od/i;
const TITLE_TOKEN_REGEX =
  /^(?:dr|doc|prof|prim|mr|sc|sci|med|spec|specijalista|supspec|subspec)\.?$/i;
const NON_NAME_TOKEN_REGEX =
  /^(?:ponedjeljak|ponedeljak|utorak|srijeda|sreda|cetvrtak|četvrtak|petak|subota|nedjelja|nedelja|prva|prvi|druga|treca|treća|cetvrta|četvrta|zadnja|poslednja|posljednja|poslednji|posljednji|pslednji|u|mjesecu|od|do|h|ambulanta|br|ordinira|ordiniraju)$/i;

const DAY_PATTERNS: Array<{ label: string; re: RegExp }> = [
  { label: "Ponedjeljak", re: /\bponedjelj(?:ak|kom|ka)?\b|\bponedelj(?:ak|kom|ka)?\b/i },
  { label: "Utorak", re: /\butor(?:ak|kom|ka)?\b/i },
  { label: "Srijeda", re: /\bsrijed(?:a|om|e)?\b|\bsred(?:a|om|e)?\b/i },
  { label: "Cetvrtak", re: /\b(?:\u010d|c)?etvrt(?:ak|kom|ka)?\b/i },
  { label: "Petak", re: /\bpet(?:ak|kom|ka)?\b/i },
  { label: "Subota", re: /\bsubot(?:a|om|e)?\b/i },
  { label: "Nedjelja", re: /\bnedjelj(?:a|om|e)?\b|\bnedelj(?:a|om|e)?\b/i },
  { label: "Radnim danima", re: /\bradnim?\s+danima\b/i }
];

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
    .replace(/<li[^>]*>/gi, "- ")
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
    .replace(/\u0111/g, "dj")
    .replace(/\u00f0/g, "dj")
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

  if (
    token.startsWith("okuloplast") ||
    token.startsWith("okuloplasti") ||
    token.startsWith("okulopladt") ||
    token.startsWith("oculoplast") ||
    token.startsWith("okulo")
  ) {
    out.add("okuloplast");
    out.add("okuloplasti");
    out.add("oculoplast");
    out.add("suzne");
  }

  if (token.startsWith("plastic") || token.startsWith("plast")) {
    out.add("plasticn");
    out.add("plasti");
  }

  if (token.startsWith("grud")) {
    out.add("torakaln");
    out.add("torakal");
    out.add("ezofag");
  }

  if (token.startsWith("torak") || token.startsWith("ezofag")) {
    out.add("grud");
  }

  // Better tolerance for surname case endings / transliteration variants:
  // "abdic" <-> "abdica", "vlaisavljevic" <-> "vlaisavljevica", etc.
  if (token.length >= 5) out.add(token.slice(0, 5));
  if (token.length >= 6) out.add(token.slice(0, token.length - 1));
  if (token.length >= 7 && token.endsWith("a")) out.add(token.slice(0, -1));

  if (token.length >= 6) out.add(token.slice(0, 6));
  if (token.length >= 7) out.add(token.slice(0, 7));

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
  for (let i = idx + 1; i < Math.min(lines.length, idx + 6); i += 1) {
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
  const normalized = cleanHoursLine(line).replace(/^ljekari?\s+ordiniraju\s*/i, "").trim();
  return normalized || null;
}

function containsDoctorMarker(line: string): boolean {
  return /\b(dr|doc\.?|prof\.?|prim\.?|mr\.?)\b/i.test(line);
}

function containsScheduleMarker(line: string): boolean {
  return /(poned|utor|srijed|sred|(?:\u010d|c)?etvrt|petak|subot|nedjel|nedelj|radnim danima|svake|svakog|prva|prvi|druga|tre(?:\u0107|c)a|zadnja|poslednja|posljednja|poslednji|posljednji|pslednji|u mjesecu|od\s*\d{1,2}|ordinira|ordiniraju)/i.test(
    line
  );
}

function extractMonthlyQualifier(text: string | null): string | null {
  if (!text) return null;
  const normalized = text.replace(/\s+/g, " ").trim();
  const match = normalized.match(
    /\b(prva|prvi|druga|tre(?:\u0107|c)a|cetvrta|zadnja|poslednja|posljednja|poslednji|posljednji|pslednji)\s+(ponedjeljak|ponedeljak|utorak|srijeda|sreda|(?:\u010d|c)?etvrtak|petak|subota|nedjelja|nedelja)\b(?:\s+u\s+mjesecu)?/i
  );
  if (!match) return null;
  const rawOrdinal = match[1].toLowerCase();
  const rawDay = match[2].toLowerCase();

  const ordinal =
    rawOrdinal === "pslednji"
      ? "poslednji"
      : rawOrdinal === "posljednji"
        ? "poslednji"
        : rawOrdinal;
  const day =
    rawDay === "ponedeljak"
      ? "ponedjeljak"
      : rawDay === "sreda"
        ? "srijeda"
        : rawDay === "nedelja"
          ? "nedjelja"
          : rawDay;

  return `${ordinal} ${day} u mjesecu`;
}
function isNonScheduleInfoLine(line: string): boolean {
  return INFO_LINE_REGEX.test(line);
}

function normalizeDoctorName(candidate: string): string | null {
  let value = candidate.replace(/\s+/g, " ").trim();
  value = value
    .replace(
      /\b(ordinira|ordiniraju|specijalista|specijalistkinja|supspecijalista|subspecijalista)\b.*$/i,
      ""
    )
    .trim();
  value = value
    .replace(
      /\b(prva|prvi|druga|tre(?:\u0107|c)a|cetvrta|zadnja|poslednja|posljednja|poslednji|posljednji|pslednji)\b.*$/i,
      ""
    )
    .trim();
  value = value
    .replace(
      /\b(ponedjeljak|ponedeljak|utorak|srijeda|sreda|(?:\u010d|c)?etvrtak|petak|subota|nedjelja|nedelja|u|mjesecu)\b.*$/i,
      ""
    )
    .trim();
  value = value.replace(/[,;:\s]+$/g, "").trim();
  value = value.replace(/\bmr\.?\s*sc\.?\s*med\.?$/i, "").trim();
  value = value.replace(/\bmr\.?\s*sc\.?$/i, "").trim();
  if (!value) return null;

  const nameTokens = value
    .split(/\s+/)
    .map((x) => x.replace(/[^\p{L}'-]/gu, ""))
    .filter(Boolean)
    .filter((x) => !TITLE_TOKEN_REGEX.test(x))
    .filter((x) => !NON_NAME_TOKEN_REGEX.test(x));

  if (nameTokens.length < 2) return null;
  const capitalized = nameTokens.filter((x) => /^\p{Lu}/u.test(x));
  if (capitalized.length < 2) return null;
  return `Dr ${capitalized.slice(0, 4).join(" ")}`;
}

function extractDoctorNames(line: string): string[] {
  const found = line.match(DOCTOR_NAME_REGEX);
  if (!found) return [];
  const cleaned = found
    .map((x) => normalizeDoctorName(x))
    .filter((x): x is string => Boolean(x));
  return [...new Set(cleaned)];
}

function extractDayLabel(text: string | null): string | null {
  if (!text) return null;
  for (const day of DAY_PATTERNS) {
    if (day.re.test(text)) return day.label;
  }
  return null;
}

function extractAmbulantaNumber(text: string | null): string | null {
  if (!text) return null;
  const match = text.match(/ambulanta\s*br\.?\s*\d+/i);
  return match?.[0]?.replace(/\s+/g, " ").trim() ?? null;
}

function extractTimeRange(text: string | null): string | null {
  if (!text) return null;
  const normalized = text.replace(/\s+/g, " ");

  const odDo =
    normalized.match(
      /\bod\s*\d{1,2}(?:[.:]\d{2})?\s*h?\s*do\s*\d{1,2}(?:[.:]\d{2})?\s*h?\b/i
    )?.[0] ??
    normalized.match(/\b\d{1,2}(?:[.:]\d{2})?\s*h?\s*do\s*\d{1,2}(?:[.:]\d{2})?\s*h?\b/i)?.[0];
  if (odDo) {
    const value = odDo.replace(/\s+/g, " ").trim();
    return value.toLowerCase().startsWith("od ") ? value : `od ${value}`;
  }

  const dash = normalized.match(/\b(\d{1,2}(?:[.:]\d{2})?)\s*-\s*(\d{1,2}(?:[.:]\d{2})?)\s*h?\b/i);
  if (dash) {
    return `od ${dash[1]} h do ${dash[2]} h`;
  }
  return null;
}

function cleanScheduleLine(line: string): string {
  const timeRangeMatch = line.match(
    /\bod\s*\d{1,2}(?:[.:]\d{2})?\s*h?\s*do\s*\d{1,2}(?:[.:]\d{2})?\s*h?\b/i
  );
  const timeRange = timeRangeMatch?.[0]?.replace(/\s+/g, " ").trim() ?? null;

  const withoutNames = line.replace(DOCTOR_NAME_REGEX, " ");
  const normalized = withoutNames
    .replace(/(?:\b(?:prof|doc|prim|mr|sci|sc|med|dr)\.?\s*){1,8}/gi, " ")
    .replace(/\bmr\.?\s*sc\.?\s*med\.?\b/gi, " ")
    .replace(/\bdr\.?\s*sc\.?\s*med\.?\b/gi, " ")
    .replace(/\bdoc\.?\s*prim\.?\s*dr\.?\s*sci\.?\s*med\.?\b/gi, " ")
    .replace(/\b(specijalista|specijalistkinja)\b[^,;:]*(?:[,;:]|$)/gi, " ")
    .replace(/\bordinira(?:ju)?\b/gi, " ")
    .replace(/\s+/g, " ")
    .replace(/\s*:\s*:/g, ": ")
    .replace(/:\s*(,|;|i)\b/gi, ": ")
    .replace(/\(\s*\)/g, " ")
    .replace(/\s+,/g, ",")
    .replace(/\s+;/g, ";")
    .replace(/[:;,]\s*(od\s*\d)/gi, " $1")
    .trim()
    .replace(/[:;,\s]+$/g, "")
    .trim();

  if (timeRange && !/\bod\b.*\bdo\b/i.test(normalized)) {
    return `${normalized} ${timeRange}`.replace(/\s+/g, " ").trim();
  }
  return normalized || line;
}

function unifyScheduleDisplay(
  schedule: string,
  ambulantaHours: string | null,
  dayContext: string | null
): string {
  const monthlyQualifier = extractMonthlyQualifier(schedule);
  if (monthlyQualifier) {
    const time = extractTimeRange(schedule) ?? extractTimeRange(ambulantaHours);
    return time ? `${monthlyQualifier} ${time}`.replace(/\s+/g, " ").trim() : monthlyQualifier;
  }

  const day = extractDayLabel(schedule) ?? dayContext ?? extractDayLabel(ambulantaHours);
  const time = extractTimeRange(schedule) ?? (day ? extractTimeRange(ambulantaHours) : null);
  const ambNo = extractAmbulantaNumber(schedule);

  if (!day && !time && !ambNo) return schedule;

  let out = day ?? "";
  if (ambNo) out = out ? `${out} (${ambNo})` : ambNo;
  if (time) out = out ? `${out} ${time}` : time;
  return out.replace(/\s+/g, " ").trim();
}

function isOculoplasticItem(item: DoctorScheduleItem): boolean {
  const hay = normalizeSearch(
    `${item.ambulanta} ${item.doctor} ${item.schedule} ${item.location ?? ""}`
  );
  return (
    hay.includes("okuloplast") ||
    hay.includes("oculoplast") ||
    hay.includes("suzne puteve")
  );
}

function isPlasticSurgeryItem(item: DoctorScheduleItem): boolean {
  const hay = normalizeSearch(
    `${item.ambulanta} ${item.doctor} ${item.schedule} ${item.location ?? ""}`
  );
  return hay.includes("plastic") && hay.includes("hirurg") && !isOculoplasticItem(item);
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
    let currentDayContext: string | null = null;
    let currentHoursContext: string | null = fallbackAmbulantaHours;

    for (const line of lines) {
      if (isNonScheduleInfoLine(line)) continue;

      const hasDoctor = containsDoctorMarker(line);
      const hasSchedule = containsScheduleMarker(line);
      const hasHours = /ljekari?\s+ordiniraju|radno\s+vrijeme/i.test(line);

      if (hasHours) {
        currentHoursContext = cleanHoursLine(line);
        const hoursAsSchedule = scheduleFromHoursLine(line);
        if (hoursAsSchedule) {
          currentScheduleContext = hoursAsSchedule;
          currentDayContext = extractDayLabel(hoursAsSchedule) ?? currentDayContext;
        }
      }

      if (hasSchedule && !hasDoctor) {
        const nextContext = hasHours
          ? scheduleFromHoursLine(line) ?? cleanScheduleLine(line)
          : cleanScheduleLine(line);
        if (nextContext) {
          currentScheduleContext = nextContext;
          currentDayContext = extractDayLabel(nextContext) ?? currentDayContext;
        }
        continue;
      }
      if (!hasDoctor) continue;

      const names = extractDoctorNames(line);
      if (!names.length) {
        if (hasSchedule) {
          const fallbackSchedule = cleanScheduleLine(line);
          if (fallbackSchedule) {
            currentScheduleContext = fallbackSchedule;
            currentDayContext = extractDayLabel(fallbackSchedule) ?? currentDayContext;
          }
        }
        continue;
      }

      const normalizedSchedule = hasSchedule ? cleanScheduleLine(line) : currentScheduleContext;
      if (hasSchedule && normalizedSchedule) {
        currentScheduleContext = normalizedSchedule;
        currentDayContext = extractDayLabel(normalizedSchedule) ?? currentDayContext;
      }

      const rowHours = currentHoursContext ?? fallbackAmbulantaHours;
      const rowScheduleRaw = normalizedSchedule ?? line;
      const rowSchedule = unifyScheduleDisplay(rowScheduleRaw, rowHours, currentDayContext);
      currentDayContext = extractDayLabel(rowSchedule) ?? currentDayContext;

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

export async function fetchDoctorScheduleSnapshot(): Promise<DoctorScheduleSnapshot> {
  const items = await fetchDoctorSchedule();
  return {
    generatedAt: new Date().toISOString(),
    sourceUrl: POLIKLINIKA_URL,
    recordsCount: items.length,
    items
  };
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

  const wantsOculoplastic =
    /\bokuloplast|\boculoplast|\bokulopladt|\bokulo/.test(q) ||
    tokenGroups.some((group) => group.some((x) => x.includes("okuloplast")));
  const wantsPlastic = /\bplasticn|\bplasticni\b|\bplasti/.test(q) && !wantsOculoplastic;

  const scoped = wantsOculoplastic
    ? matched.filter((item) => isOculoplasticItem(item))
    : wantsPlastic
      ? matched.filter((item) => isPlasticSurgeryItem(item))
      : matched;

  return scoped.sort((a, b) => {
    const aa = normalizeSearch(`${a.doctor} ${a.ambulanta}`);
    const bb = normalizeSearch(`${b.doctor} ${b.ambulanta}`);
    return aa.localeCompare(bb);
  });
}

export { POLIKLINIKA_URL };
