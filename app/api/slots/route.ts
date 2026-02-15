import { fetchLatestSnapshot } from "@/lib/kccg";
import { getLatestSnapshot, saveSnapshot } from "@/lib/storage";
import { normalizeForSearch, parseSlotDate } from "@/lib/utils";
import { NextRequest, NextResponse } from "next/server";

type ApiSlotItem = {
  key: string;
  section: string;
  specialist: string;
  status: "HAS_SLOTS" | "NO_SLOTS";
  firstAvailable: string | null;
  codes: string[];
  slotKind: "INVESTIGATION" | "SPECIALIST_VISIT";
};

type NarrowSuggestion = {
  label: string;
  query: string;
};

type SlotAnswer = {
  kind: "empty" | "none" | "single" | "narrow";
  text: string;
  specialist?: string;
  section?: string;
  status?: "HAS_SLOTS" | "NO_SLOTS";
  firstAvailable?: string | null;
  suggestions?: Array<{ label: string; query: string }>;
  bannerTone?: "success" | "danger" | "info";
};

const CYR_TO_LAT_MAP: Record<string, string> = {
  "\u0430": "a",
  "\u0431": "b",
  "\u0432": "v",
  "\u0433": "g",
  "\u0434": "d",
  "\u0435": "e",
  "\u0451": "e",
  "\u0436": "zh",
  "\u0437": "z",
  "\u0438": "i",
  "\u0439": "i",
  "\u043A": "k",
  "\u043B": "l",
  "\u043C": "m",
  "\u043D": "n",
  "\u043E": "o",
  "\u043F": "p",
  "\u0440": "r",
  "\u0441": "s",
  "\u0442": "t",
  "\u0443": "u",
  "\u0444": "f",
  "\u0445": "h",
  "\u0446": "c",
  "\u0447": "ch",
  "\u0448": "sh",
  "\u0449": "shch",
  "\u044A": "",
  "\u044B": "y",
  "\u044C": "",
  "\u044D": "e",
  "\u044E": "yu",
  "\u044F": "ya",
  "\u0456": "i",
  "\u0457": "i",
  "\u0454": "e",
  "\u0491": "g",
  "\u0452": "dj",
  "\u0458": "j",
  "\u0459": "lj",
  "\u045A": "nj",
  "\u045B": "c",
  "\u045F": "dz"
};

function transliterateCyrillicToLatin(input: string): string {
  let out = "";
  for (const char of input.toLowerCase()) {
    out += CYR_TO_LAT_MAP[char] ?? char;
  }
  return out;
}

function expandNeedleVariants(rawQuery: string): string[] {
  const out = new Set<string>();

  const add = (value: string) => {
    const normalized = normalizeForSearch(value);
    if (normalized) out.add(normalized);
  };

  add(rawQuery);
  const transliterated = transliterateCyrillicToLatin(rawQuery);
  add(transliterated);

  const latin = normalizeForSearch(transliterated);

  // Russian -> local medical aliases.
  if (/(revmatolog|revmatol|reumatolog|reumatol)/.test(latin)) {
    add("reumatolog");
    add("reumatolosk");
    add("reumatoloska ambulanta");
    add("reumatoloski konzilijum");
  }

  if (/(nevrolog|neurolog|nevro|neuro)/.test(latin)) {
    add("neurolog");
    add("neuroloska ambulanta");
  }

  if (/(kardiolog|cardiolog)/.test(latin)) {
    add("kardiolog");
    add("kardioloska ambulanta");
  }

  if (/(gastroenterolog|gastroenterohepatolog|geh|gastrolog)/.test(latin)) {
    add("gastroenterohepatolog");
    add("gastroenterohepatoloska");
    add("geh");
  }

  if (/(endokrinolog)/.test(latin)) {
    add("endokrinolog");
    add("endokrinoloska ambulanta");
  }

  if (/(nefrolog)/.test(latin)) {
    add("nefrolog");
    add("nefroloska ambulanta");
  }

  if (/(pulmonolog|pneumolog)/.test(latin)) {
    add("pulmolog");
    add("pulmoloska ambulanta");
  }

  if (/(alergolog|allergolog)/.test(latin)) {
    add("alergolog");
    add("alergoloska ambulanta");
  }

  if (/(ginekolog)/.test(latin)) {
    add("ginekolog");
    add("ginekoloska ambulanta");
  }

  if (/(urolog)/.test(latin)) {
    add("urolog");
    add("uroloska ambulanta");
  }

  if (/(ortoped)/.test(latin)) {
    add("ortoped");
    add("ortopedska ambulanta");
  }

  if (/(hirurg|chirurg|surgeon)/.test(latin)) {
    add("hirurg");
    add("hirurska ambulanta");
  }

  if (/(oftalmolog|okulist)/.test(latin)) {
    add("oftalmolog");
    add("oftalmoloska ambulanta");
  }

  if (/(lor|otorino|otolaringolog)/.test(latin)) {
    add("orl");
    add("otorinolaringolog");
  }

  if (/(psihiatr|psychiatr)/.test(latin)) {
    add("psihijatar");
    add("psihijatrijska ambulanta");
  }

  if (/(onkolog)/.test(latin)) {
    add("onkolog");
    add("onkologija");
  }

  if (/(hematolog)/.test(latin)) {
    add("hematolog");
    add("hematoloska ambulanta");
  }

  if (/(dermatolog|venerolog)/.test(latin)) {
    add("dermatovenerolog");
    add("dermatovenerologija");
  }

  if (
    /(osteodenzitomet|dxa|dexa|dex|denzitomet|densitomet|gustina kost|bone density)/.test(
      latin
    )
  ) {
    add("osteodenzitometrij");
    add("osteodenzitometriju");
    add("kabinet za osteodenzitometriju");
    add("dxa");
    add("dexa");
    add("dex");
    add("denzitometrij");
    add("densitometrij");
    add("gustina kostiju");
    add("gustina kosti");
  }

  if (/\buz\b|ultrazv|ultrasound/.test(latin)) {
    add("uz");
    add("uzv");
    add("ultrazv");
    add("ultrazvuk");
    add("ultrazvuc");
    add("ultrazvucn");
    add("ultrazvucna dijagnostika");
    add("ultrzvucna dijagnostika");
  }

  // Ultrasound/Doppler are commonly used interchangeably in user language.
  if (/(dopler|doppler)/.test(latin)) {
    add("dopler");
    add("doppler");
    add("ultrazv");
    add("ultrazvuk");
    add("ultrazvuc");
    add("ultrazvucn");
    add("uzv");
    add("ultrazvucna dijagnostika");
    add("ultrzvucna dijagnostika");
    add("uz");
  }

  if (/(ultrazv|ultrazvuk|ultrazvuc|ultrzvuc|uz)/.test(latin)) {
    // Common typos: ultrzv... -> ultrazv...
    add("ultrazv");
    add("ultrazvuk");
    add("ultrazvuc");
    add("ultrazvucn");
    add("uzv");
    add("dopler");
    add("doppler");
    add("kolor dopler");
    add("color doppler");
  }

  return [...out];
}

function upperTokens(value: string): string[] {
  return (value.toUpperCase().match(/[A-Z0-9]+/g) ?? []).filter(Boolean);
}

function isCtItem(item: ApiSlotItem): boolean {
  const tokens = upperTokens(`${item.specialist} ${item.section}`);
  return tokens.includes("CT");
}

function isOctItem(item: ApiSlotItem): boolean {
  const tokens = upperTokens(`${item.specialist} ${item.section}`);
  return tokens.includes("OCT");
}

function isOphthalmologyClinic(item: ApiSlotItem): boolean {
  const sec = normalizeForSearch(item.section);
  return sec.includes("klinika za ocne bolesti");
}

function containsCtQuery(query: string): boolean {
  const q = normalizeQueryLatin(query);
  const tokens = q.split(/\s+/).filter(Boolean);
  return tokens.includes("ct");
}

function containsOctQuery(query: string): boolean {
  const q = normalizeQueryLatin(query);
  const tokens = q.split(/\s+/).filter(Boolean);
  return tokens.includes("oct");
}

function isOnlyCtQuery(query: string): boolean {
  const q = normalizeQueryLatin(query);
  const tokens = q.split(/\s+/).filter(Boolean);
  return tokens.length === 1 && tokens[0] === "ct";
}

function containsUltrasoundQuery(query: string): boolean {
  const q = normalizeQueryLatin(query);
  const tokens = q.split(/\s+/).filter(Boolean);
  return tokens.some((t) =>
    ["uz", "uzv", "ultrazv", "ultrazvuk", "ultrazvuc", "ultrzv", "dopler", "doppler"].some((k) =>
      t.includes(k)
    )
  );
}

function isUltrasoundItem(item: ApiSlotItem): boolean {
  const text = normalizeForSearch(`${item.specialist} ${item.section}`);
  if (text.includes("dopler") || text.includes("doppler")) return true;
  if (text.includes("ultrazv") || text.includes("ultrazvuk") || text.includes("ultrazvuc")) return true;
  // Word boundary-ish check for "uz" and "uzv".
  if (/(^|\\s)uzv($|\\s)/.test(text)) return true;
  if (/(^|\\s)uz($|\\s)/.test(text)) return true;
  return false;
}

function createCombinedInvestigationAnswer(
  label: string,
  items: ApiSlotItem[]
): SlotAnswer {
  if (!items.length) {
    return {
      kind: "none",
      text: `No records found for "${label}".`,
      bannerTone: "info"
    };
  }

  const withSlots = items.find((x) => x.status === "HAS_SLOTS");
  if (!withSlots) {
    return {
      kind: "single",
      text: "NEMA TERMINA",
      specialist: label,
      section: "",
      status: "NO_SLOTS",
      firstAvailable: null,
      bannerTone: "danger"
    };
  }

  return {
    kind: "single",
    text: `IMA TERMINA\nPrvi dostupni termin: ${withSlots.firstAvailable ?? "nepoznato"} (${withSlots.specialist})`,
    specialist: label,
    section: withSlots.section,
    status: "HAS_SLOTS",
    firstAvailable: withSlots.firstAvailable,
    bannerTone: "success"
  };
}

function wordWiseLooseMatch(haystack: string, needle: string): boolean {
  if (!needle) return false;

  const hWords = haystack.split(" ").filter(Boolean);
  const nWords = needle.split(" ").filter(Boolean);
  if (!nWords.length) return false;

  return nWords.every((n) =>
    hWords.some((h) => {
      if ((n === "1" && h === "i") || (n === "2" && h === "ii")) return true;
      if ((n === "i" && h === "1") || (n === "ii" && h === "2")) return true;
      // Very short needles (ct, mr, etc.) should not match inside unrelated words (e.g. ct in oct).
      if (n.length <= 2) return h === n || h.startsWith(n);
      if (h.includes(n)) return true;
      if (h.length >= 3 && n.length >= 3 && n.includes(h)) return true;
      if (h.length >= 5 && n.length >= 5) return h.slice(0, 5) === n.slice(0, 5);
      return false;
    })
  );
}

function looseTextMatch(haystackRaw: string, needleRaw: string): boolean {
  if (!needleRaw.trim()) return true;
  const haystack = normalizeForSearch(haystackRaw);
  const candidates = expandNeedleVariants(needleRaw);
  if (!candidates.length) return false;
  return candidates.some((candidate) => wordWiseLooseMatch(haystack, candidate));
}

function toSafeLimit(value: string | null, fallback = 50): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(Math.floor(n), 200));
}

function normalizeQueryLatin(query: string): string {
  return normalizeForSearch(transliterateCyrillicToLatin(query));
}

function hasChildIntent(query: string): boolean {
  const latin = normalizeQueryLatin(query);
  return /(det|reben|pediatr|children|child|kids|kid|baby|infant|pedij|pediat|deca|djeca|djec|dijete|dece|ibd|neonat)/.test(
    latin
  );
}

function containsNeurologyIntent(query: string): boolean {
  const latin = normalizeQueryLatin(query);
  return /(nevrolog|neurolog|nevrolo|neurolo)/.test(latin);
}

function hasSpecificCabinetNumber(query: string): boolean {
  const q = normalizeQueryLatin(query);
  return /\b(i|ii|iii|1|2|3)\b/.test(q);
}

function containsEndocrinologyIntent(query: string): boolean {
  const q = normalizeQueryLatin(query);
  return /(endokri|endocri|endokrinolog|endokrinologija|endokrinol)/.test(q);
}

function containsCardiologyIntent(query: string): boolean {
  const q = normalizeQueryLatin(query);
  return /(kardiolog|cardiolog|kardiolo|cardiolo|kardiologija|kardio)/.test(q);
}

function hasInvestigationIntent(query: string): boolean {
  const q = normalizeQueryLatin(query);
  return /(ct|mr|mri|mrt|eeg|emng|echo|eho|dopler|doppler|gastroskop|kolono|uz|ultrazv|ultrzv|ultrazvuc|dijagnost|kabinet|test|dxa|dexa|dex|denzitomet|densitomet|osteodenzito|gustina kost)/.test(
    q
  );
}

function isPrimaryEndocrinologyAmbulanta(item: ApiSlotItem): boolean {
  const section = normalizeForSearch(item.section);
  const specialist = normalizeForSearch(item.specialist);
  if (!section.includes("interna klinika")) return false;
  if (!specialist.includes("endokrinol")) return false;
  if (!specialist.includes("ambulanta")) return false;
  return /\b(1|2|3|i|ii|iii)\b/i.test(item.specialist);
}

function isRelatedEndocrinologyItem(item: ApiSlotItem): boolean {
  const section = normalizeForSearch(item.section);
  const specialist = normalizeForSearch(item.specialist);

  const endocrineSurgery =
    specialist.includes("endokrin") &&
    (specialist.includes("hirurg") || section.includes("hirurska klinika"));

  const gyneEndocrine =
    specialist.includes("endokrin") &&
    (specialist.includes("ginekol") ||
      section.includes("ginekologiju i akuserstvo"));

  return endocrineSurgery || gyneEndocrine;
}

function isPrimaryCardiologyItem(item: ApiSlotItem): boolean {
  const section = normalizeForSearch(item.section);
  const specialist = normalizeForSearch(item.specialist);

  const inCardiologyClinic = section.includes("klinika za bolesti srca");
  const cardiologySpecialist = specialist.includes("kardiol");
  if (!inCardiologyClinic || !cardiologySpecialist) return false;

  const numberedAmbulanta =
    specialist.includes("ambulanta") && /\b(1|2|3|i|ii|iii)\b/i.test(item.specialist);
  const controlVisit = specialist.includes("kontrol");
  const interventional = specialist.includes("intervent");

  return numberedAmbulanta || controlVisit || interventional;
}

function isCardiologyUniverseItem(item: ApiSlotItem): boolean {
  const section = normalizeForSearch(item.section);
  const specialist = normalizeForSearch(item.specialist);

  if (section.includes("klinika za bolesti srca")) return true;
  return specialist.includes("kardio") || specialist.includes("kardiol");
}

function sortByStatusAndDate(items: ApiSlotItem[]): ApiSlotItem[] {
  return [...items].sort((a, b) => {
    if (a.status !== b.status) return a.status === "HAS_SLOTS" ? -1 : 1;
    const da =
      parseSlotDate(a.firstAvailable)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const db =
      parseSlotDate(b.firstAvailable)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    if (da !== db) return da - db;
    if (a.section !== b.section) return a.section.localeCompare(b.section);
    return a.specialist.localeCompare(b.specialist);
  });
}

function sortEndocrineByAmbulantaNumber(items: ApiSlotItem[]): ApiSlotItem[] {
  const rank = (value: string): number => {
    const upper = value.toUpperCase();
    if (/\b1\b|\bI\b/.test(upper)) return 1;
    if (/\b2\b|\bII\b/.test(upper)) return 2;
    if (/\b3\b|\bIII\b/.test(upper)) return 3;
    return 99;
  };

  return [...items].sort((a, b) => {
    const ra = rank(a.specialist);
    const rb = rank(b.specialist);
    if (ra !== rb) return ra - rb;
    return a.specialist.localeCompare(b.specialist);
  });
}

function isNeurologyAmbulantaOneOrTwo(item: ApiSlotItem): boolean {
  const sec = normalizeForSearch(item.section);
  const sp = normalizeForSearch(item.specialist);
  const raw = item.specialist.toUpperCase();

  if (!sec.includes("klinika za neurologiju")) return false;
  if (!sp.includes("ambulanta")) return false;
  if (!(sp.includes("neurol") || raw.includes("NEUROLO"))) return false;
  return /\b(I|II|1|2)\b/i.test(item.specialist) || /\b(i|ii|1|2)\b/.test(sp);
}

function isPediatricItem(item: ApiSlotItem): boolean {
  const sectionNorm = normalizeForSearch(item.section);
  const specialistNorm = normalizeForSearch(item.specialist);
  const raw = `${item.section} ${item.specialist}`.toUpperCase();

  if (sectionNorm.includes("institut za bolesti djece")) return true;
  if (raw.includes("IBD") || raw.includes("DJE") || raw.includes("PEDIJ")) return true;
  return /(djec|deca|djeca|pedij|pediat|neonat|ibd)/.test(specialistNorm);
}

function isExcludedAdministrativeItem(item: ApiSlotItem): boolean {
  const combinedNorm = normalizeForSearch(`${item.specialist} ${item.section}`);
  // MVP rule: hide all consilium records from results.
  if (/(konzilij|konsilij|consilium|konsilium)/.test(combinedNorm)) {
    return true;
  }

  if (combinedNorm.includes("upucivanje pacijenata u inostranstvo")) {
    return true;
  }

  return false;
}

function detectSlotKind(item: Pick<ApiSlotItem, "section" | "specialist">):
  | "INVESTIGATION"
  | "SPECIALIST_VISIT" {
  const text = normalizeForSearch(`${item.specialist} ${item.section}`);

  const investigationPatterns = [
    "gastroskop",
    "kolono",
    "ct ",
    " ct",
    "mr ",
    " mri",
    " mrt",
    "rtg",
    "eeg",
    "emng",
    "echo",
    "eho",
    "dopler",
    "doppler",
    "uz ",
    "ultrazv",
    "ergomet",
    "holter",
    "endoskop",
    "kabinet",
    "dijagnost",
    "dxa",
    "dexa",
    "dex",
    "denzitomet",
    "densitomet",
    "osteodenzit",
    "gustina kost"
  ];

  if (investigationPatterns.some((pattern) => text.includes(pattern))) {
    return "INVESTIGATION";
  }

  return "SPECIALIST_VISIT";
}

function applyEndocrinologyVisitFilter(
  query: string,
  items: ApiSlotItem[]
): ApiSlotItem[] {
  if (!containsEndocrinologyIntent(query)) return items;
  if (hasInvestigationIntent(query)) return items;

  const visitAmbulanta = items.filter((item) => {
    const specialist = normalizeForSearch(item.specialist);
    return (
      item.slotKind === "SPECIALIST_VISIT" &&
      specialist.includes("endokrinol") &&
      specialist.includes("ambulanta")
    );
  });

  if (!visitAmbulanta.length) return items;

  const numbered = visitAmbulanta.filter((item) =>
    /\b(1|2|3|i|ii|iii)\b/i.test(item.specialist)
  );

  return numbered.length ? numbered : visitAmbulanta;
}

function createNarrowSuggestions(
  items: Array<{ section: string; specialist: string }>
): NarrowSuggestion[] {
  const out: NarrowSuggestion[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const label = `${item.specialist} (${item.section})`;
    const key = normalizeForSearch(label);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ label, query: item.specialist });
    if (out.length >= 6) break;
  }
  return out;
}

function createSingleAnswer(item: ApiSlotItem): SlotAnswer {
  if (item.status === "HAS_SLOTS") {
    return {
      kind: "single",
      text: `YES: slots are available for "${item.specialist}". First available: ${item.firstAvailable ?? "unknown"}.`,
      specialist: item.specialist,
      section: item.section,
      status: item.status,
      firstAvailable: item.firstAvailable,
      bannerTone: "success"
    };
  }
  return {
    kind: "single",
    text: `NO: there are no free slots for "${item.specialist}".`,
    specialist: item.specialist,
    section: item.section,
    status: item.status,
    firstAvailable: item.firstAvailable,
    bannerTone: "danger"
  };
}

function createNeurologyCombinedAnswer(allItems: ApiSlotItem[]): SlotAnswer {
  const relevant = allItems.filter(isNeurologyAmbulantaOneOrTwo);
  if (!relevant.length) {
    return {
      kind: "none",
      text: 'No "Neuroloska ambulanta I/II" records found in the current report.',
      bannerTone: "info"
    };
  }

  const withSlots = relevant.filter((x) => x.status === "HAS_SLOTS");
  if (!withSlots.length) {
    return {
      kind: "single",
      text: "NO: there are no free slots for neurologist (Neuroloska ambulanta I/II).",
      specialist: "Neuroloska ambulanta I/II",
      section: "KLINIKA ZA NEUROLOGIJU",
      status: "NO_SLOTS" as const,
      firstAvailable: null,
      bannerTone: "danger"
    };
  }

  const best = [...withSlots].sort((a, b) => {
    const da = parseSlotDate(a.firstAvailable)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const db = parseSlotDate(b.firstAvailable)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    return da - db;
  })[0];

  return {
    kind: "single",
    text: `YES: there are free neurologist slots (Neuroloska ambulanta I/II). Earliest: ${best.firstAvailable ?? "unknown"} in "${best.specialist}".`,
    specialist: "Neuroloska ambulanta I/II",
    section: "KLINIKA ZA NEUROLOGIJU",
    status: "HAS_SLOTS" as const,
    firstAvailable: best.firstAvailable,
    bannerTone: "success"
  };
}

function createEndocrinologyCombinedAnswer(primary: ApiSlotItem[]): SlotAnswer {
  const hasSlots = primary.some((item) => item.status === "HAS_SLOTS");
  if (!hasSlots) {
    return {
      kind: "single",
      text: "NEMA SLOBODNIH TERMINA",
      specialist: "ENDOKRINOLOSKA AMBULANTA 1/2/3",
      section: "INTERNA KLINIKA",
      status: "NO_SLOTS",
      firstAvailable: null,
      bannerTone: "danger"
    };
  }

  const best = sortByStatusAndDate(
    primary.filter((item) => item.status === "HAS_SLOTS")
  )[0];
  return {
    kind: "single",
    text: `YES: first available endocrinology slot is ${best.firstAvailable ?? "unknown"} (${best.specialist}).`,
    specialist: "ENDOKRINOLOSKA AMBULANTA 1/2/3",
    section: "INTERNA KLINIKA",
    status: "HAS_SLOTS",
    firstAvailable: best.firstAvailable,
    bannerTone: "success"
  };
}

function createCardiologyCombinedAnswer(primary: ApiSlotItem[]): SlotAnswer {
  const hasSlots = primary.some((item) => item.status === "HAS_SLOTS");
  if (!hasSlots) {
    return {
      kind: "single",
      text: "NEMA SLOBODNIH TERMINA",
      specialist: "KARDIOLOSKA AMB 1/2/3 + KONTROLA + INTERVENTNA",
      section: "KLINIKA ZA BOLESTI SRCA",
      status: "NO_SLOTS",
      firstAvailable: null,
      bannerTone: "danger"
    };
  }

  const best = sortByStatusAndDate(
    primary.filter((item) => item.status === "HAS_SLOTS")
  )[0];
  return {
    kind: "single",
    text: `YES: first available cardiology slot is ${best.firstAvailable ?? "unknown"} (${best.specialist}).`,
    specialist: "KARDIOLOSKA AMB 1/2/3 + KONTROLA + INTERVENTNA",
    section: "KLINIKA ZA BOLESTI SRCA",
    status: "HAS_SLOTS",
    firstAvailable: best.firstAvailable,
    bannerTone: "success"
  };
}

function buildAnswer(
  query: string,
  items: ApiSlotItem[],
  allItems: ApiSlotItem[]
): SlotAnswer {
  const q = query.trim();
  if (!q) {
    return {
      kind: "empty",
      text: 'Enter specialist name, for example: "Neuroloska ambulanta I".',
      bannerTone: "info"
    };
  }

  if (containsNeurologyIntent(q) && !hasSpecificCabinetNumber(q)) {
    return createNeurologyCombinedAnswer(allItems);
  }

  if (items.length === 0) {
    return {
      kind: "none",
      text: `No records found for "${q}".`,
      bannerTone: "info"
    };
  }

  if (items.length === 1) return createSingleAnswer(items[0]);

  const qNorm = normalizeQueryLatin(q);
  const exact = items.filter((item) => {
    const sp = normalizeForSearch(item.specialist);
    const sec = normalizeForSearch(item.section);
    return sp === qNorm || `${sp} ${sec}` === qNorm;
  });
  if (exact.length === 1) return createSingleAnswer(exact[0]);

  return {
    kind: "narrow",
    text: `Several matches found (${items.length}).`,
    suggestions: createNarrowSuggestions(items),
    bannerTone: "info"
  };
}

export async function GET(req: NextRequest) {
  try {
    const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
    const limit = toSafeLimit(req.nextUrl.searchParams.get("limit"), 50);
    const childIntent = hasChildIntent(q);
    const ctIntent = containsCtQuery(q) && !containsOctQuery(q);
    const octIntent = containsOctQuery(q);
    const ultrasoundIntent = containsUltrasoundQuery(q) && !ctIntent && !octIntent;

    let snapshot = await getLatestSnapshot();
    if (!snapshot) {
      snapshot = await fetchLatestSnapshot();
      await saveSnapshot(snapshot);
    }

    const allItems: ApiSlotItem[] = snapshot.bySpecialist.map((item) => ({
      key: item.key,
      section: item.section,
      specialist: item.specialist,
      status: item.status,
      firstAvailable: item.firstAvailable,
      codes: Array.isArray(item.codes) ? item.codes : [],
      slotKind: detectSlotKind({
        section: item.section,
        specialist: item.specialist
      })
    }));

    const searchableItems = childIntent
      ? allItems
      : allItems.filter((item) => !isPediatricItem(item));

    const visibleItems = searchableItems.filter(
      (item) => !isExcludedAdministrativeItem(item)
    );

    let relatedItems: ApiSlotItem[] = [];
    let relatedTitle: string | null = null;
    let forcedAnswer: SlotAnswer | null = null;

    // Default search: loose match over visible items.
    let items = sortByStatusAndDate(
      visibleItems
        .filter((item) => looseTextMatch(`${item.specialist} ${item.section}`, q))
        .filter(
          (item) =>
            item.slotKind === "INVESTIGATION" || item.slotKind === "SPECIALIST_VISIT"
        )
    );

    // Special cases:
    // - CT: show only CT items (radiology), but also show OCT from Ophthalmology clinic as related.
    // - OCT: show only OCT items (do not mix CT radiology).
    // - Ultrasound/Doppler: restrict to UZ/UZV/ultrazv/dopler items to avoid matching all radiology diagnostics.
    if (octIntent) {
      const octItems = sortByStatusAndDate(
        visibleItems
          .filter(isOctItem)
          .filter((item) => looseTextMatch(`${item.specialist} ${item.section}`, q))
      );
      items = octItems;
      forcedAnswer = createCombinedInvestigationAnswer("OCT", octItems);
    } else if (ctIntent) {
      const ctItems = sortByStatusAndDate(
        visibleItems
          .filter(isCtItem)
          .filter((item) => looseTextMatch(`${item.specialist} ${item.section}`, q))
      );
      items = ctItems;
      forcedAnswer = createCombinedInvestigationAnswer("CT", ctItems);

      if (isOnlyCtQuery(q)) {
        relatedItems = sortByStatusAndDate(
          visibleItems.filter((item) => isOctItem(item) && isOphthalmologyClinic(item))
        );
        relatedTitle = relatedItems.length ? "OCT (Klinika za ocne bolesti)" : null;
      }
    } else if (ultrasoundIntent) {
      const uzItems = sortByStatusAndDate(
        visibleItems
          .filter(isUltrasoundItem)
          .filter((item) => looseTextMatch(`${item.specialist} ${item.section}`, q))
      );
      items = uzItems;
      forcedAnswer = createCombinedInvestigationAnswer("UZ / DOPLER", uzItems);
    }

    const refinedItems = applyEndocrinologyVisitFilter(q, items);
    let finalItems = refinedItems;

    if (containsEndocrinologyIntent(q) && !hasInvestigationIntent(q) && !hasSpecificCabinetNumber(q)) {
      const primary = sortEndocrineByAmbulantaNumber(
        visibleItems.filter(isPrimaryEndocrinologyAmbulanta)
      );
      const related = sortByStatusAndDate(
        visibleItems.filter(isRelatedEndocrinologyItem)
      );

      if (primary.length > 0) {
        finalItems = primary;
        relatedItems = related;
        forcedAnswer = createEndocrinologyCombinedAnswer(primary);
      }
    }

    if (
      !forcedAnswer &&
      containsCardiologyIntent(q) &&
      !hasInvestigationIntent(q) &&
      !hasSpecificCabinetNumber(q)
    ) {
      const cardiologyUniverse = sortByStatusAndDate(
        visibleItems
          .filter((item) => looseTextMatch(`${item.specialist} ${item.section}`, q))
          .filter(isCardiologyUniverseItem)
      );
      const primary = sortByStatusAndDate(
        cardiologyUniverse.filter(isPrimaryCardiologyItem)
      );
      const related = sortByStatusAndDate(
        cardiologyUniverse.filter((item) => !isPrimaryCardiologyItem(item))
      );

      if (primary.length > 0) {
        finalItems = primary;
        relatedItems = related;
        forcedAnswer = createCardiologyCombinedAnswer(primary);
      }
    }

    finalItems = finalItems.slice(0, limit);

    return NextResponse.json({
      query: q,
      total: finalItems.length,
      childIntent,
      pediatricFiltered: !childIntent,
      sourcePdfDate: snapshot.sourcePdfDate,
      sourcePdfUrl: snapshot.sourcePdfUrl,
      answer: forcedAnswer ?? buildAnswer(q, finalItems, visibleItems),
      items: finalItems,
      relatedItems,
      relatedTitle
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to load KCCG slots"
      },
      { status: 500 }
    );
  }
}
