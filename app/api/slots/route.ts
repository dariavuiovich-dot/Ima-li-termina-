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
  note?: string;
  noteUrl?: string;
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

type ResultGroup = {
  title: string;
  items: ApiSlotItem[];
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

  if (/(emng|emg|eng|iglic|iglice|iglicama)/.test(latin)) {
    add("emng");
    add("emng ambulanta");
    add("emng pregled");
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
  return tokens.includes("CT") || tokens.includes("MSCT");
}

function isCtKolonoskopijeItem(item: ApiSlotItem): boolean {
  const sp = normalizeForSearch(item.specialist);
  return sp.includes("ct kolonoskop");
}

function isOctItem(item: ApiSlotItem): boolean {
  const tokens = upperTokens(`${item.specialist} ${item.section}`);
  return tokens.includes("OCT");
}

function isMrItem(item: ApiSlotItem): boolean {
  const tokens = upperTokens(`${item.specialist} ${item.section}`);
  return tokens.includes("MR") || tokens.includes("MRI") || tokens.includes("MRT");
}

function isOphthalmologyClinic(item: ApiSlotItem): boolean {
  const sec = normalizeForSearch(item.section);
  return sec.includes("klinika za ocne bolesti");
}

function containsCtQuery(query: string): boolean {
  const q = normalizeQueryLatin(query);
  const tokens = q.split(/\s+/).filter(Boolean);
  return tokens.includes("ct") || tokens.includes("msct");
}

function containsCtAngioIntent(query: string): boolean {
  const q = normalizeQueryLatin(query);
  if (!(q.includes("ct") || q.includes("msct"))) return false;
  return /(angio|angiograf)/.test(q);
}

function containsOctQuery(query: string): boolean {
  const q = normalizeQueryLatin(query);
  const tokens = q.split(/\s+/).filter(Boolean);
  return tokens.includes("oct");
}

function containsMrQuery(query: string): boolean {
  const q = normalizeQueryLatin(query);
  const tokens = q.split(/\s+/).filter(Boolean);
  return tokens.includes("mr") || tokens.includes("mri") || tokens.includes("mrt");
}

function isOnlyCtQuery(query: string): boolean {
  const q = normalizeQueryLatin(query);
  const tokens = q.split(/\s+/).filter(Boolean);
  return tokens.length === 1 && tokens[0] === "ct";
}

function isGenericCtQuery(query: string): boolean {
  const q = normalizeQueryLatin(query);
  const tokens = q.split(/\s+/).filter(Boolean);
  if (!tokens.length) return false;

  const hasCt = tokens.includes("ct") || tokens.includes("msct");
  if (!hasCt) return false;

  const genericWords = new Set([
    "pregled",
    "snimanje",
    "snimak",
    "dijagnostika",
    "diagnostika",
    "radiologija",
    "radioloska",
    "centar",
    "kccg",
    "za",
    "u",
    "na",
    "i"
  ]);

  const nonCtTokens = tokens.filter((t) => t !== "ct" && t !== "msct");
  if (!nonCtTokens.length) return true;
  return nonCtTokens.every((t) => genericWords.has(t));
}

function containsCtNeuroIntent(query: string): boolean {
  const q = normalizeQueryLatin(query);
  if (!(q.includes("ct") || q.includes("msct"))) return false;

  // Do not treat CT angio/body/etc as "CT neuro" just because it contains "glave".
  if (/(angio|body|koronograf|kolonoskop|kolono|msk)/.test(q)) return false;

  // Common ways users describe "CT neuro" (head/brain/skull/spine).
  return (
    /(mozg|mozga|glav|endokran|endokranij|endocran|encephal|cerebr|pns|sinus|paranaz|supljin)/.test(q) ||
    /(kicm|kicme|kicma|cervikal|cervik|vratn|torakal|lumbosakral|lumbal|ls\b|th\b|\bc\b|krst|krsta)/.test(
      q
    )
  );
}

function containsCtBodyIntent(query: string): boolean {
  const q = normalizeQueryLatin(query);
  if (!(q.includes("ct") || q.includes("msct"))) return false;

  // Exclude other CT subtypes.
  if (/(angio|neuro|koronograf|kolonoskop|kolono|msk)/.test(q)) return false;

  // Abdomen / pelvis / chest / adrenal / urography keywords.
  return (
    /\bbody\b/.test(q) ||
    /(abdom|abdomena|karlic|male karlic|pelv)/.test(q) ||
    /(nadbubrez|adrenal)/.test(q) ||
    /(thorax|thorak|toraks|toraksa|toraxa|grud|pluc)/.test(q) ||
    /(urograf|urografija|urotrakt|urotrakta|uro)/.test(q)
  );
}

function containsMrBreastIntent(query: string): boolean {
  const q = normalizeQueryLatin(query);
  if (!containsMrQuery(q)) return false;
  return /(dojk|dojke|dojki|dojka|mamma|mamm)/.test(q);
}

function containsMrMskIntent(query: string): boolean {
  const q = normalizeQueryLatin(query);
  if (!containsMrQuery(q)) return false;
  if (containsMrBreastIntent(q)) return false;

  // Musculoskeletal MR.
  if (/(msk|ramen|rame|koljen|koleno|koljena|lakat|lakta|si zglob|sakroili|sakroilij|zglobov|zglobova|kostiju|kosti)/.test(q)) {
    return true;
  }

  // "kukova i karlice" belongs to MSK (bone structures).
  if (/(kukov|kukova|kukovi)/.test(q) && /karlic/.test(q)) return true;
  return false;
}

function containsMrBodyIntent(query: string): boolean {
  const q = normalizeQueryLatin(query);
  if (!containsMrQuery(q)) return false;
  if (containsMrBreastIntent(q) || containsMrMskIntent(q)) return false;

  // "abdomena i karlice" belongs to BODY (organs).
  if (/abdom/.test(q) && /karlic/.test(q)) return true;

  return (
    /(body|abdom|abdomena|male karlic|mala karlic|pelv|toraks|toraksa|toraxa|thorax|thoraxa|grudnog kos|grudni kos|gornjeg abdomena|gornji abdomen|prostat|prostata|nadbubreg|adrenal)/.test(
      q
    )
  );
}

function containsMrNeuroIntent(query: string): boolean {
  const q = normalizeQueryLatin(query);
  if (!containsMrQuery(q)) return false;
  if (containsMrBreastIntent(q) || containsMrMskIntent(q) || containsMrBodyIntent(q)) return false;

  return (
    /(neuro|endokran|endokranij|endocran|glav|mozga|pns|sinus|temporaln|temporalne kosti|kicm|c kicm|ls kicm|th kicm|vratn|cervikal|lumbosakral|krst)/.test(
      q
    )
  );
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

function containsEmngIntent(query: string): boolean {
  const q = normalizeQueryLatin(query);
  return /(emng|emg|eng|iglic|iglice|iglicama)/.test(q);
}

function isEmngItem(item: ApiSlotItem): boolean {
  const text = normalizeForSearch(`${item.specialist} ${item.section}`);
  return /\bemng\b/.test(text) || text.includes("elektromioneuro");
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

function isCtNeuroItem(item: ApiSlotItem): boolean {
  const sp = normalizeForSearch(item.specialist);
  return sp.includes("ct neuro") || sp.includes("ct pns") || sp.includes("paranaz") || sp.includes("sinus");
}

function isCtBodyItem(item: ApiSlotItem): boolean {
  const sp = normalizeForSearch(item.specialist);
  return sp.includes("ct body") || sp.includes("urograf") || sp.includes("urotrakt") || sp.includes("ct uro");
}

function isCtAngioItem(item: ApiSlotItem): boolean {
  const sp = normalizeForSearch(item.specialist);
  return sp.includes("ct angio") || sp.includes("angiograf");
}

function isMrSchedulingAmbulanta(item: ApiSlotItem): boolean {
  const combined = normalizeForSearch(`${item.specialist} ${item.section}`);
  return (
    combined.includes("zakazivanje") &&
    /konzilij|konsilij|konsilium|consilium/.test(combined) &&
    (/\bmr\b/.test(combined) || combined.includes("magnet"))
  );
}

function isMrNeuroItem(item: ApiSlotItem): boolean {
  return normalizeForSearch(item.specialist).includes("mr neuro");
}

function isMrBodyItem(item: ApiSlotItem): boolean {
  const sp = normalizeForSearch(item.specialist);
  return (
    sp.includes("mr body") ||
    sp.includes("prostat") ||
    sp.includes("nadbubreg") ||
    sp.includes("adrenal")
  );
}

function isMrMskItem(item: ApiSlotItem): boolean {
  return normalizeForSearch(item.specialist).includes("mr msk");
}

function isMrBreastItem(item: ApiSlotItem): boolean {
  const sp = normalizeForSearch(item.specialist);
  return sp.includes("mr doj") || sp.includes("dojk");
}

function getItemNote(item: Pick<ApiSlotItem, "specialist" | "section">): { note: string; noteUrl?: string } | null {
  const sp = normalizeForSearch(item.specialist);
  // MRI requires cardiology? no, requires MR council approval and scheduling via dedicated ambulanta.
  if (
    sp.includes("zakazivanje") &&
    /konzilij|konsilij|konsilium|consilium/.test(sp) &&
    (/\bmr\b/.test(sp) || sp.includes("magnet"))
  ) {
    return {
      note: "MR pregled ne moze direktno da zakaze izabrani doktor. Potrebno je odobrenje Konzilijuma i termin u ovoj ambulanti."
    };
  }
  // MSCT/CT coronarography needs cardiology council approval.
  if (sp.includes("koronograf") || sp.includes("koronarograf")) {
    return {
      note: [
        "Potrebno odobrenje Konzilijuma kardiologa.",
        "Lokacija: Poliklinika KCCG - Kardioloska ambulanta (prizemlje).",
        "Konzilijum: svake srijede u 12h. Dokumentacija: 8-9h.",
        "Prisustvo pacijenta je obavezno."
      ].join(" "),
      noteUrl: "https://www.kccg.me/poliklinika/poliklinika-kccg/"
    };
  }
  return null;
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

function createSimpleAvailabilityAnswer(label: string, items: ApiSlotItem[]): SlotAnswer {
  if (!items.length) {
    return {
      kind: "none",
      text: `Nema zapisa za "${label}".`,
      bannerTone: "info"
    };
  }

  const hasSlots = items.some((x) => x.status === "HAS_SLOTS");
  if (!hasSlots) {
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
    text: "IMA TERMINA",
    specialist: label,
    section: "",
    status: "HAS_SLOTS",
    firstAvailable: null,
    bannerTone: "success"
  };
}

function sortCtItems(items: ApiSlotItem[]): ApiSlotItem[] {
  return [...items].sort((a, b) => {
    const ra = isCtKolonoskopijeItem(a) ? 900 : 100;
    const rb = isCtKolonoskopijeItem(b) ? 900 : 100;
    if (ra !== rb) return ra - rb;
    if (a.status !== b.status) return a.status === "HAS_SLOTS" ? -1 : 1;
    const da = parseSlotDate(a.firstAvailable)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const db = parseSlotDate(b.firstAvailable)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    if (da !== db) return da - db;
    return a.specialist.localeCompare(b.specialist);
  });
}

function formatKonzilijumFirstAvailable(value: string | null): string {
  if (!value) return "nepoznat";
  const m = value.match(/(\d{2}\.\d{2}\.\d{4})\.?\s+(\d{2}):(\d{2})/);
  if (!m) return value;
  return `${m[1]} u ${m[2]}.${m[3]}`;
}

function createMrSchedulingAnswer(scheduleItem: ApiSlotItem | null): SlotAnswer {
  const prefix = "Da biste mogli zakazati trazeni pregled potrebno je odobrenje Konzilijuma za MR.";
  if (!scheduleItem || scheduleItem.status !== "HAS_SLOTS") {
    return {
      kind: "single",
      text: `${prefix} Trenutno nema slobodnih termina za Konzilijum.`,
      specialist: "AMBULANTA ZA ZAKAZIVANJE KONZILIJUMA ZA MR",
      section: scheduleItem?.section ?? "",
      status: "NO_SLOTS",
      firstAvailable: null,
      bannerTone: "danger"
    };
  }

  const when = formatKonzilijumFirstAvailable(scheduleItem.firstAvailable);
  return {
    kind: "single",
    text: `${prefix} Prvi slobodni termin za Konzilijum je ${when}.`,
    specialist: "AMBULANTA ZA ZAKAZIVANJE KONZILIJUMA ZA MR",
    section: scheduleItem.section,
    status: "HAS_SLOTS",
    firstAvailable: scheduleItem.firstAvailable,
    bannerTone: "info"
  };
}

function createMrGroupSummaryRow(label: string, candidates: ApiSlotItem[]): ApiSlotItem | null {
  if (!candidates.length) return null;
  const sorted = sortByStatusAndDate(candidates);
  const bestAvailable = sorted.find((x) => x.status === "HAS_SLOTS");
  const base = bestAvailable ?? sorted[0];
  return {
    key: `MR_SUMMARY::${label}`,
    specialist: label,
    section: base.section,
    status: bestAvailable ? "HAS_SLOTS" : "NO_SLOTS",
    firstAvailable: bestAvailable?.firstAvailable ?? null,
    codes: [],
    slotKind: "INVESTIGATION"
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
  return /(nevrolog|neurolog|nevrolo|neurolo|\bneuro\b|\bnevro\b)/.test(latin);
}

function hasSpecificCabinetNumber(query: string): boolean {
  const q = normalizeQueryLatin(query);
  return /\b(i|ii|iii|1|2|3)\b/.test(q);
}

function isShortNeuroQuery(query: string): boolean {
  const q = normalizeQueryLatin(query);
  const tokens = q.split(/\s+/).filter(Boolean);
  return tokens.length === 1 && (tokens[0] === "neuro" || tokens[0] === "nevro");
}

function isFullNeurologQuery(query: string): boolean {
  const q = normalizeQueryLatin(query);
  return /\b(neurolog|nevrolog|neurologija|nevrologija)\b/.test(q);
}

function containsEndocrinologyIntent(query: string): boolean {
  const q = normalizeQueryLatin(query);
  return /(endokri|endocri|endokrinolog|endokrinologija|endokrinol)/.test(q);
}

function containsCardiologyIntent(query: string): boolean {
  const q = normalizeQueryLatin(query);
  return /(kardiolog|cardiolog|kardiolo|cardiolo|kardiologija|kardio)/.test(q);
}

function containsOrlIntent(query: string): boolean {
  const q = normalizeQueryLatin(query);
  return /(orl|lor|otorino|otolaring|uho grlo nos|uha grla nosa)/.test(q);
}

function containsOncologyIntent(query: string): boolean {
  const q = normalizeQueryLatin(query);
  return /(onko|onkolog|onkolo|hemoterap|radioterap|brahi|brahio|brachy|citostat|citostatik)/.test(
    q
  );
}

function cleanSpecialistName(value: string): string {
  return value
    .replace(/\b([123])1{4,}(?=\s+Ljekar specijalista u amb\.?)/gi, "$1")
    .replace(/\s*\d*\s*Ljekar specijalista u amb\.?.*$/i, "")
    .replace(/\b([123])1{4,}\b/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function extractEndocrineAmbulantaNumber(value: string): number | null {
  const normalized = normalizeForSearch(value);
  const upper = value.toUpperCase();

  const fused = normalized.match(/ambulanta\s*([123])1{3,}\b/);
  if (fused) return Number(fused[1]);

  const arabic = normalized.match(/\bambulanta\s*([123])\b/);
  if (arabic) return Number(arabic[1]);

  if (/\bAMBULANTA\s*III\b/.test(upper)) return 3;
  if (/\bAMBULANTA\s*II\b/.test(upper)) return 2;
  if (/\bAMBULANTA\s*I\b/.test(upper)) return 1;

  // Some reports have "ENDOKRINOLOSKA AMBULANTA" (without ordinal),
  // which corresponds to endocrinology ambulanta stream in Interna klinika.
  if (normalized.includes("endokrinol") && normalized.includes("ambulanta")) return 1;

  return null;
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
  if (isRelatedEndocrinologyItem(item)) return false;
  return true;
}

function isRelatedEndocrinologyItem(item: ApiSlotItem): boolean {
  return isEndocrineSurgeryItem(item) || isGyneEndocrinologyItem(item);
}

function isEndocrineSurgeryItem(item: ApiSlotItem): boolean {
  const section = normalizeForSearch(item.section);
  const specialist = normalizeForSearch(item.specialist);
  return (
    specialist.includes("endokrin") &&
    (specialist.includes("hirurg") || section.includes("hirurska klinika"))
  );
}

function isGyneEndocrinologyItem(item: ApiSlotItem): boolean {
  const section = normalizeForSearch(item.section);
  const specialist = normalizeForSearch(item.specialist);
  return (
    specialist.includes("endokrin") &&
    (specialist.includes("ginekol") ||
      section.includes("ginekologiju i akuserstvo"))
  );
}

function sortEndocrineRelated(items: ApiSlotItem[]): ApiSlotItem[] {
  return [...items].sort((a, b) => {
    const ra = isGyneEndocrinologyItem(a) ? 200 : 100;
    const rb = isGyneEndocrinologyItem(b) ? 200 : 100;
    if (ra !== rb) return ra - rb;
    if (a.status !== b.status) return a.status === "HAS_SLOTS" ? -1 : 1;
    const da = parseSlotDate(a.firstAvailable)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const db = parseSlotDate(b.firstAvailable)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    if (da !== db) return da - db;
    return a.specialist.localeCompare(b.specialist);
  });
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

function isOrlUniverseItem(item: ApiSlotItem): boolean {
  const combined = normalizeForSearch(`${item.specialist} ${item.section}`);
  return /(orl|lor|otorino|otolaring|uha grla nosa|uho grlo nos|foniatrij|subplastic|sub plastic)/.test(
    combined
  );
}

function isPrimaryOrlItem(item: ApiSlotItem): boolean {
  const sp = normalizeForSearch(item.specialist);
  const section = normalizeForSearch(item.section);
  const inOrlUniverse = isOrlUniverseItem(item);
  if (!inOrlUniverse) return false;

  const isOrlSpecialisticka =
    (sp.includes("orl") || sp.includes("otorino") || section.includes("uha grla nosa") || section.includes("uho grlo nos")) &&
    sp.includes("specijal");
  const numbered12 = /\b(1|2|i|ii)\b/i.test(item.specialist);
  const interventional =
    sp.includes("intervent") &&
    (sp.includes("orl") || sp.includes("otorino") || section.includes("uha grla nosa") || section.includes("uho grlo nos"));

  return (isOrlSpecialisticka && numbered12) || interventional;
}

function isSecondaryOrlItem(item: ApiSlotItem): boolean {
  const sp = normalizeForSearch(item.specialist);
  return sp.includes("foniat") || sp.includes("fonijat") || sp.includes("plastic");
}

function rankOrlPrimary(item: ApiSlotItem): number {
  const sp = normalizeForSearch(item.specialist);
  const upper = item.specialist.toUpperCase();

  if (sp.includes("specijal") && (/\b1\b|\bI\b/.test(upper) || /\bAMBULANTA I\b/.test(upper))) return 110;
  if (sp.includes("specijal") && (/\b2\b|\bII\b/.test(upper) || /\b ORL 2\b/.test(upper))) return 120;
  if (sp.includes("intervent")) return 130;
  return 199;
}

function sortOrlPrimary(items: ApiSlotItem[]): ApiSlotItem[] {
  return [...items].sort((a, b) => {
    const ra = rankOrlPrimary(a);
    const rb = rankOrlPrimary(b);
    if (ra !== rb) return ra - rb;
    if (a.status !== b.status) return a.status === "HAS_SLOTS" ? -1 : 1;
    const da = parseSlotDate(a.firstAvailable)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const db = parseSlotDate(b.firstAvailable)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    if (da !== db) return da - db;
    return a.specialist.localeCompare(b.specialist);
  });
}

function rankOrlSecondary(item: ApiSlotItem): number {
  const sp = normalizeForSearch(item.specialist);
  if (sp.includes("foniat") || sp.includes("fonijat")) return 210;
  if (sp.includes("plastic")) return 220;
  return 299;
}

function sortOrlSecondary(items: ApiSlotItem[]): ApiSlotItem[] {
  return [...items].sort((a, b) => {
    const ra = rankOrlSecondary(a);
    const rb = rankOrlSecondary(b);
    if (ra !== rb) return ra - rb;
    if (a.status !== b.status) return a.status === "HAS_SLOTS" ? -1 : 1;
    const da = parseSlotDate(a.firstAvailable)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const db = parseSlotDate(b.firstAvailable)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    if (da !== db) return da - db;
    return a.specialist.localeCompare(b.specialist);
  });
}

function isOncologyUniverseItem(item: ApiSlotItem): boolean {
  const combined = normalizeForSearch(`${item.specialist} ${item.section}`);
  if (/(onko|onkolog|onkolo)/.test(combined)) return true;
  if (/(hemoterap|radioterap|brahi|brahio|brachy|citostat)/.test(combined)) return true;
  // Catch CT/MR "onkološki" naming.
  if ((combined.includes("ct") || combined.includes("mr")) && /onkol/.test(combined)) return true;
  return false;
}

function rankOncologyPrimary(item: ApiSlotItem): number {
  const sp = normalizeForSearch(item.specialist);

  // 1) ambulanta za hemoterapiju 1-5 + interventna
  if (sp.includes("ambulanta") && sp.includes("hemoterap")) {
    const upper = item.specialist.toUpperCase();
    if (upper.includes("INTERVENT")) return 160;
    if (/\b1\b|\bI\b/.test(upper)) return 110;
    if (/\b2\b|\bII\b/.test(upper)) return 120;
    if (/\b3\b|\bIII\b/.test(upper)) return 130;
    if (/\b4\b|\bIV\b/.test(upper)) return 140;
    if (/\b5\b|\bV\b/.test(upper)) return 150;
    return 155;
  }

  // 2) ambulanta za radioterapiju 1-2
  if (sp.includes("ambulanta") && sp.includes("radioterap")) {
    const upper = item.specialist.toUpperCase();
    if (/\b1\b|\bI\b/.test(upper)) return 210;
    if (/\b2\b|\bII\b/.test(upper)) return 220;
    return 230;
  }

  // 3) brahio, CT onko, MR onko 1/2
  if (/(brahi|brahio|brachy)/.test(sp)) return 310;
  if (sp.includes("ct") && /onkol/.test(sp)) return 320;
  if (sp.includes("mr") && /onkol/.test(sp)) {
    const upper = item.specialist.toUpperCase();
    if (/\b1\b|\bI\b/.test(upper)) return 330;
    if (/\b2\b|\bII\b/.test(upper)) return 340;
    return 345;
  }

  return 999;
}

function isOncologyPrimaryItem(item: ApiSlotItem): boolean {
  return rankOncologyPrimary(item) < 999;
}

function sortOncologyOrdered(items: ApiSlotItem[]): ApiSlotItem[] {
  return [...items].sort((a, b) => {
    const ra = rankOncologyPrimary(a);
    const rb = rankOncologyPrimary(b);
    if (ra !== rb) return ra - rb;
    if (a.status !== b.status) return a.status === "HAS_SLOTS" ? -1 : 1;
    const da = parseSlotDate(a.firstAvailable)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const db = parseSlotDate(b.firstAvailable)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    if (da !== db) return da - db;
    return a.specialist.localeCompare(b.specialist);
  });
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
  return [...items].sort((a, b) => {
    const ra = extractEndocrineAmbulantaNumber(a.specialist) ?? 99;
    const rb = extractEndocrineAmbulantaNumber(b.specialist) ?? 99;
    if (ra !== rb) return ra - rb;
    if (a.status !== b.status) return a.status === "HAS_SLOTS" ? -1 : 1;
    const da = parseSlotDate(a.firstAvailable)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const db = parseSlotDate(b.firstAvailable)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    if (da !== db) return da - db;
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

function isUrologyItem(item: ApiSlotItem): boolean {
  const specialist = normalizeForSearch(item.specialist);
  const section = normalizeForSearch(item.section);

  // Guard against OCR/encoding splits like "ne urol..." inside "neurol..."
  // so neurology rows are never treated as urology.
  if (
    /(neurol|nevrol)/.test(specialist) ||
    /(neurolog|nevrolog)/.test(section)
  ) {
    return false;
  }

  if (/(urolog)/.test(section)) return true;
  return /\burol/.test(specialist);
}

function isNeurologyUniverseItem(item: ApiSlotItem): boolean {
  const combined = normalizeForSearch(`${item.specialist} ${item.section}`);
  if (isUrologyItem(item)) return false;
  if (/(neurol|nevrol|neuro|klinika za neurologiju)/.test(combined)) return true;
  if (
    /(emng|eeg|evociran|evocirane potencijale|evocirani potencijali|dispanser za epi|epi dispanser|epilep)/.test(
      combined
    )
  ) {
    return true;
  }
  return false;
}

function isNeurologySecondaryItem(item: ApiSlotItem): boolean {
  const combined = normalizeForSearch(`${item.specialist} ${item.section}`);
  return /(emng|eeg|evociran|evocirane potencijale|evocirani potencijali|dispanser.*epi|epi.*dispanser|epilep)/.test(
    combined
  );
}

function isNeurologyInterventionalItem(item: ApiSlotItem): boolean {
  const combined = normalizeForSearch(`${item.specialist} ${item.section}`);
  return combined.includes("intervent") && /(neuro|neurol|nevrol)/.test(combined);
}

function isNeurologyElectrophysiologyItem(item: ApiSlotItem): boolean {
  const combined = normalizeForSearch(`${item.specialist} ${item.section}`);
  return /\bemng\b/.test(combined) || /(^|\s)eeg($|\s)/.test(combined);
}

function isNeurosurgeryItem(item: ApiSlotItem): boolean {
  const section = normalizeForSearch(item.section);
  return section.includes("klinika za neurohirurgiju");
}

function isExcludedNeurologyUiItem(item: ApiSlotItem): boolean {
  const combined = normalizeForSearch(`${item.specialist} ${item.section}`);
  return /(logoped|defektolog|psiholosk|psiholoski|psiho).*(kabinet|ambulant)|neurolosko psiholoski/.test(
    combined
  );
}

function isNeurologyCtOrMrItem(item: ApiSlotItem): boolean {
  if (!(isCtItem(item) || isMrItem(item))) return false;
  const combined = normalizeForSearch(`${item.specialist} ${item.section}`);
  return /(neuro|pns|sinus|endokran|glav|mozg|kicm)/.test(combined);
}

function rankNeurologyPrimary(item: ApiSlotItem): number {
  const upper = item.specialist.toUpperCase();
  if (/\b1\b|\bI\b/.test(upper)) return 110;
  if (/\b2\b|\bII\b/.test(upper)) return 120;
  return 199;
}

function sortNeurologyPrimary(items: ApiSlotItem[]): ApiSlotItem[] {
  return [...items].sort((a, b) => {
    const ra = rankNeurologyPrimary(a);
    const rb = rankNeurologyPrimary(b);
    if (ra !== rb) return ra - rb;
    if (a.status !== b.status) return a.status === "HAS_SLOTS" ? -1 : 1;
    const da = parseSlotDate(a.firstAvailable)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const db = parseSlotDate(b.firstAvailable)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    if (da !== db) return da - db;
    return a.specialist.localeCompare(b.specialist);
  });
}

function rankNeurologySecondary(item: ApiSlotItem): number {
  const combined = normalizeForSearch(`${item.specialist} ${item.section}`);
  if (combined.includes("emng")) return 210;
  if (/(^|\\s)eeg($|\\s)/.test(combined)) return 220;
  if (/dispanser.*epi|epi.*dispanser|epilep/.test(combined)) return 230;
  if (combined.includes("evociran")) return 240;
  return 299;
}

function sortNeurologySecondary(items: ApiSlotItem[]): ApiSlotItem[] {
  return [...items].sort((a, b) => {
    const ra = rankNeurologySecondary(a);
    const rb = rankNeurologySecondary(b);
    if (ra !== rb) return ra - rb;
    if (a.status !== b.status) return a.status === "HAS_SLOTS" ? -1 : 1;
    const da = parseSlotDate(a.firstAvailable)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const db = parseSlotDate(b.firstAvailable)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    if (da !== db) return da - db;
    return a.specialist.localeCompare(b.specialist);
  });
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
  // Exception: keep MR council scheduling ambulanta visible for users.
  if (
    combinedNorm.includes("zakazivanje") &&
    /konzilij|konsilij|konsilium|consilium/.test(combinedNorm) &&
    (/\bmr\b/.test(combinedNorm) || combinedNorm.includes("magnet"))
  ) {
    return false;
  }
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

  const primary = visitAmbulanta.filter(isPrimaryEndocrinologyAmbulanta);
  if (primary.length) return sortEndocrineByAmbulantaNumber(primary);

  return visitAmbulanta.filter((item) => !isRelatedEndocrinologyItem(item));
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
      text: "Nema zapisa za Neuroloska ambulanta I/II u aktuelnom izvjestaju.",
      bannerTone: "info"
    };
  }

  const withSlots = relevant.filter((x) => x.status === "HAS_SLOTS");
  if (!withSlots.length) {
    return {
      kind: "single",
      text: "NEMA TERMINA",
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
    text: `IMA TERMINA\nPrvi dostupni termin: ${best.firstAvailable ?? "nepoznato"} (${best.specialist})`,
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

function createOrlCombinedAnswer(primary: ApiSlotItem[]): SlotAnswer {
  const hasSlots = primary.some((item) => item.status === "HAS_SLOTS");
  if (!hasSlots) {
    return {
      kind: "single",
      text: "NEMA TERMINA",
      specialist: "ORL specijalisticka ambulanta 1/2 + interventna",
      section: "KLINIKA ZA BOLESTI UHA, GRLA I NOSA",
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
    text: `IMA TERMINA\nPrvi dostupni termin: ${best.firstAvailable ?? "nepoznato"} (${best.specialist})`,
    specialist: "ORL specijalisticka ambulanta 1/2 + interventna",
    section: best.section,
    status: "HAS_SLOTS",
    firstAvailable: best.firstAvailable,
    bannerTone: "success"
  };
}

function createOncologyCombinedAnswer(primary: ApiSlotItem[]): SlotAnswer {
  const hasSlots = primary.some((item) => item.status === "HAS_SLOTS");
  if (!hasSlots) {
    return {
      kind: "single",
      text: "NEMA TERMINA",
      specialist: "ONKOLOGIJA",
      section: "",
      status: "NO_SLOTS",
      firstAvailable: null,
      bannerTone: "danger"
    };
  }

  // Keep "order intent" first, but the earliest available is still what matters for the banner.
  const best = sortByStatusAndDate(primary.filter((x) => x.status === "HAS_SLOTS"))[0];
  return {
    kind: "single",
    text: `IMA TERMINA\nPrvi dostupni termin: ${best.firstAvailable ?? "nepoznato"} (${best.specialist})`,
    specialist: "ONKOLOGIJA",
    section: best.section,
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
    const mrIntent = containsMrQuery(q) && !ctIntent && !containsOctQuery(q);
    const octIntent = containsOctQuery(q);
    const ultrasoundIntent = containsUltrasoundQuery(q) && !ctIntent && !octIntent && !mrIntent;
    const emngIntent = containsEmngIntent(q);
    const oncologyIntent = containsOncologyIntent(q);

    let snapshot = await getLatestSnapshot();
    if (!snapshot) {
      snapshot = await fetchLatestSnapshot();
      await saveSnapshot(snapshot);
    }

    const allItems: ApiSlotItem[] = snapshot.bySpecialist.map((item) => {
      const specialist = cleanSpecialistName(item.specialist);
      return {
        key: item.key,
        section: item.section,
        specialist,
        status: item.status,
        firstAvailable: item.firstAvailable,
        codes: Array.isArray(item.codes) ? item.codes : [],
        slotKind: detectSlotKind({
          section: item.section,
          specialist
        }),
        ...(getItemNote({ specialist, section: item.section }) ?? {})
      };
    });

    const searchableItems = childIntent
      ? allItems
      : allItems.filter((item) => !isPediatricItem(item));

    const visibleItems = searchableItems.filter(
      (item) => !isExcludedAdministrativeItem(item)
    );

    let relatedItems: ApiSlotItem[] = [];
    let relatedTitle: string | null = null;
    let resultGroups: ResultGroup[] = [];
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
    // - MR: first show council scheduling ambulanta + MR subgroup by intent (NEURO/BODY/MSK/DOJKI).
    // - OCT: show only OCT items (do not mix CT radiology).
    // - Ultrasound/Doppler: restrict to UZ/UZV/ultrazv/dopler items to avoid matching all radiology diagnostics.
    // - Oncology: show chemo->radio->(brahio/CT onko/MR onko) order.
    if (oncologyIntent) {
      const universe = sortByStatusAndDate(visibleItems.filter(isOncologyUniverseItem));
      const primary = sortOncologyOrdered(universe.filter(isOncologyPrimaryItem));
      const related = sortByStatusAndDate(universe.filter((x) => !isOncologyPrimaryItem(x)));

      items = primary;
      forcedAnswer = createOncologyCombinedAnswer(primary);
      relatedItems = related;
      relatedTitle = related.length ? "Ostalo (onkologija)" : null;
    } else if (octIntent) {
      const octItems = sortByStatusAndDate(
        visibleItems
          .filter(isOctItem)
          .filter((item) => looseTextMatch(`${item.specialist} ${item.section}`, q))
      );
      items = octItems;
      forcedAnswer = createCombinedInvestigationAnswer("OCT", octItems);
    } else if (ctIntent) {
      const ctAngioIntent = containsCtAngioIntent(q);
      const ctNeuroIntent = containsCtNeuroIntent(q);
      const ctBodyIntent = !ctAngioIntent && !ctNeuroIntent && containsCtBodyIntent(q);

      if (ctAngioIntent || ctNeuroIntent || ctBodyIntent) {
        // For CT subtype intents, ignore extra words (mozga/abdomena/toraksa/etc) and show the matching CT subgroup.
        const ctUniverse = sortCtItems(visibleItems.filter(isCtItem));

        const primary = ctAngioIntent
          ? ctUniverse.filter(isCtAngioItem)
          : ctNeuroIntent
            ? ctUniverse.filter(isCtNeuroItem)
            : ctUniverse.filter(isCtBodyItem);

        const label = ctAngioIntent ? "CT ANGIOGRAFIJA" : ctNeuroIntent ? "CT NEURO" : "CT BODY";

        items = primary;
        forcedAnswer = createCombinedInvestigationAnswer(label, primary);

        relatedItems = sortCtItems(ctUniverse.filter((x) => !primary.includes(x)));
        relatedTitle = relatedItems.length ? "Ostali CT" : null;
      } else {
        const ctItems = sortCtItems(
          visibleItems
            .filter(isCtItem)
            .filter((item) => looseTextMatch(`${item.specialist} ${item.section}`, q))
        );

        items = ctItems;
        forcedAnswer = isGenericCtQuery(q)
          ? createSimpleAvailabilityAnswer("CT", ctItems)
          : createCombinedInvestigationAnswer("CT", ctItems);

        if (isOnlyCtQuery(q)) {
          relatedItems = sortByStatusAndDate(
            visibleItems.filter((item) => isOctItem(item) && isOphthalmologyClinic(item))
          );
          relatedTitle = relatedItems.length ? "OCT (Klinika za ocne bolesti)" : null;
        }
      }
    } else if (mrIntent) {
      const mrNeuroIntent = containsMrNeuroIntent(q);
      const mrBodyIntent = !mrNeuroIntent && containsMrBodyIntent(q);
      const mrMskIntent = !mrNeuroIntent && !mrBodyIntent && containsMrMskIntent(q);
      const mrBreastIntent = !mrNeuroIntent && !mrBodyIntent && !mrMskIntent && containsMrBreastIntent(q);

      const mrUniverse = sortByStatusAndDate(visibleItems.filter(isMrItem));
      const scheduleItems = sortByStatusAndDate(mrUniverse.filter(isMrSchedulingAmbulanta));
      const mrClinicalUniverse = sortByStatusAndDate(
        mrUniverse.filter((item) => !isMrSchedulingAmbulanta(item))
      );
      const scheduleItem = scheduleItems[0] ?? null;

      const mrNeuroAll = mrClinicalUniverse.filter(isMrNeuroItem);
      const mrBodyAll = mrClinicalUniverse.filter(isMrBodyItem);
      const mrMskAll = mrClinicalUniverse.filter(isMrMskItem);
      const mrBreastAll = mrClinicalUniverse.filter(isMrBreastItem);

      const mrNeuroSummary = createMrGroupSummaryRow("MR NEURO", mrNeuroAll);
      const mrBodySummary = createMrGroupSummaryRow("MR BODY", mrBodyAll);
      const mrMskSummary = createMrGroupSummaryRow("MR MSK", mrMskAll);
      const mrBreastSummary = createMrGroupSummaryRow("MR DOJKI", mrBreastAll);

      if (mrNeuroIntent || mrBodyIntent || mrMskIntent || mrBreastIntent) {
        const primary = mrNeuroIntent
          ? mrNeuroSummary
          : mrBodyIntent
            ? mrBodySummary
            : mrMskIntent
              ? mrMskSummary
              : mrBreastSummary;
        const others = [
          mrNeuroIntent ? null : mrNeuroSummary,
          mrBodyIntent ? null : mrBodySummary,
          mrMskIntent ? null : mrMskSummary,
          mrBreastIntent ? null : mrBreastSummary
        ].filter((x): x is ApiSlotItem => Boolean(x));

        items = [scheduleItem, primary].filter((x): x is ApiSlotItem => Boolean(x));
        forcedAnswer = createMrSchedulingAnswer(scheduleItem);

        relatedItems = others;
        relatedTitle = relatedItems.length ? "Ostali MR" : null;
      } else {
        items = [scheduleItem, mrNeuroSummary, mrBodySummary, mrMskSummary, mrBreastSummary].filter(
          (x): x is ApiSlotItem => Boolean(x)
        );
        forcedAnswer = createMrSchedulingAnswer(scheduleItem);
      }
    } else if (emngIntent) {
      const emngItems = sortByStatusAndDate(
        visibleItems
          .filter(isEmngItem)
          .filter((item) => looseTextMatch(`${item.specialist} ${item.section}`, q))
      );
      items = emngItems;
      forcedAnswer = createCombinedInvestigationAnswer("EMNG", emngItems);
    } else if (ultrasoundIntent) {
      const uzItems = sortByStatusAndDate(
        visibleItems
          .filter(isUltrasoundItem)
          .filter((item) => looseTextMatch(`${item.specialist} ${item.section}`, q))
      );
      items = uzItems;
      forcedAnswer = createCombinedInvestigationAnswer("UZ / DOPLER", uzItems);
    }

    if (!forcedAnswer && containsNeurologyIntent(q)) {
      const neurologyUniverse = sortByStatusAndDate(
        visibleItems
          .filter(isNeurologyUniverseItem)
          .filter((item) => !isUrologyItem(item))
          .filter((item) => !isExcludedNeurologyUiItem(item))
      );

      const primary = sortNeurologyPrimary(
        neurologyUniverse.filter(isNeurologyAmbulantaOneOrTwo)
      );
      const secondary = sortNeurologySecondary(
        neurologyUniverse.filter(
          (item) =>
            !isNeurologyAmbulantaOneOrTwo(item) &&
            isNeurologySecondaryItem(item)
        )
      );
      const interventional = sortByStatusAndDate(
        neurologyUniverse.filter(
          (item) =>
            !isNeurologyAmbulantaOneOrTwo(item) &&
            !isNeurologySecondaryItem(item) &&
            isNeurologyInterventionalItem(item)
        )
      );
      const ctmr = sortByStatusAndDate(
        neurologyUniverse.filter(
          (item) =>
            !isNeurologyAmbulantaOneOrTwo(item) &&
            !isNeurologySecondaryItem(item) &&
            !isNeurologyInterventionalItem(item) &&
            isNeurologyCtOrMrItem(item)
        )
      );
      const rest = sortByStatusAndDate(
        neurologyUniverse.filter(
          (item) =>
            !isNeurologyAmbulantaOneOrTwo(item) &&
            !isNeurologySecondaryItem(item) &&
            !isNeurologyInterventionalItem(item) &&
            !isNeurologyCtOrMrItem(item)
        )
      );

      const neurosurgery = sortByStatusAndDate(
        neurologyUniverse.filter(
          (item) =>
            isNeurosurgeryItem(item) && !isNeurologyCtOrMrItem(item)
        )
      );
      const electro = sortByStatusAndDate(
        neurologyUniverse.filter(
          (item) =>
            !isNeurosurgeryItem(item) && isNeurologyElectrophysiologyItem(item)
        )
      );
      const neurologyMain = sortByStatusAndDate([
        ...primary,
        ...secondary.filter((item) => !isNeurologyElectrophysiologyItem(item)),
        ...interventional.filter((item) => !isNeurosurgeryItem(item)),
        ...rest.filter(
          (item) =>
            !isNeurosurgeryItem(item) &&
            !isNeurologyElectrophysiologyItem(item)
        )
      ]);

      const includeCtMrTail = isShortNeuroQuery(q) && !isFullNeurologQuery(q);
      resultGroups = [
        { title: "Neurologija", items: neurologyMain },
        { title: "Elektrofizioloska ispitivanja", items: electro },
        { title: "Neurohirurgija", items: neurosurgery },
        ...(includeCtMrTail
          ? [{ title: "Radioloska snimanja", items: ctmr }]
          : [])
      ].filter((group) => group.items.length > 0);

      items = resultGroups.flatMap((group) => group.items);

      forcedAnswer = createNeurologyCombinedAnswer(neurologyUniverse);
    }

    const refinedItems = applyEndocrinologyVisitFilter(q, items);
    let finalItems = refinedItems;

    if (containsEndocrinologyIntent(q) && !hasInvestigationIntent(q) && !hasSpecificCabinetNumber(q)) {
      const primary = sortEndocrineByAmbulantaNumber(
        visibleItems.filter(isPrimaryEndocrinologyAmbulanta)
      );
      const related = sortEndocrineRelated(
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

    if (
      !forcedAnswer &&
      containsOrlIntent(q) &&
      !hasInvestigationIntent(q) &&
      !hasSpecificCabinetNumber(q)
    ) {
      const orlUniverse = sortByStatusAndDate(
        visibleItems
          .filter((item) => looseTextMatch(`${item.specialist} ${item.section}`, q))
          .filter(isOrlUniverseItem)
      );
      const primary = sortOrlPrimary(orlUniverse.filter(isPrimaryOrlItem));
      const secondary = sortOrlSecondary(
        orlUniverse.filter((item) => !isPrimaryOrlItem(item) && isSecondaryOrlItem(item))
      );
      const rest = sortByStatusAndDate(
        orlUniverse.filter((item) => !isPrimaryOrlItem(item) && !isSecondaryOrlItem(item))
      );

      if (primary.length > 0) {
        finalItems = [...primary, ...secondary];
        relatedItems = rest;
        relatedTitle = relatedItems.length ? "Ostalo (ORL)" : null;
        forcedAnswer = createOrlCombinedAnswer(primary);
      } else if (secondary.length > 0 || rest.length > 0) {
        finalItems = [...secondary, ...rest];
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
      resultGroups,
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
