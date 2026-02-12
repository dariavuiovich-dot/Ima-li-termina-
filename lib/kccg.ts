import { SlotRecord, SpecialistSlot, SlotsSnapshot } from "@/lib/types";
import { makeKey, parseSlotDate } from "@/lib/utils";

const KCCG_HOME_URL = "https://www.kccg.me/";

interface KccgPdfMeta {
  reportDate: string;
  pdfUrl: string;
}

function cleanName(value: string): string {
  return value
    .replace(/\s+111111\s+Ljekar specijalista u amb\..*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractMarkdown(raw: string): string {
  const marker = "Markdown Content:";
  const idx = raw.indexOf(marker);
  return idx >= 0 ? raw.slice(idx + marker.length) : raw;
}

function dedupeRecords(rows: SlotRecord[]): SlotRecord[] {
  const seen = new Set<string>();
  const out: SlotRecord[] = [];

  for (const row of rows) {
    const key = [
      row.section,
      row.code,
      row.specialist,
      row.status,
      row.firstAvailable ?? "",
      row.lastBooked ?? ""
    ].join("|");

    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }

  return out;
}

function parseRows(markdown: string, meta: KccgPdfMeta): SlotRecord[] {
  const lines = markdown
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  let currentSection = "";
  let current:
    | {
        code: string;
        name: string;
        lines: string[];
      }
    | null = null;

  const rows: SlotRecord[] = [];

  const flushCurrent = () => {
    if (!current) return;

    const block = current.lines.join(" ").replace(/\s+/g, " ");
    const hasNoSlots = /Nema slobodnih termina/i.test(block);

    const dateMatches = [...block.matchAll(/\d{2}\.\d{2}\.\d{4}\.\s*\d{2}:\d{2}/g)]
      .map((m) => m[0].replace(/\s+/g, " "))
      .filter(Boolean);

    let firstAvailable: string | null = null;
    if (!hasNoSlots) {
      firstAvailable = dateMatches[1] ?? dateMatches[0] ?? null;
    }

    const specialist = cleanName(current.name);
    if (specialist) {
      rows.push({
        section: currentSection,
        code: current.code,
        specialist,
        status: hasNoSlots ? "NO_SLOTS" : "HAS_SLOTS",
        firstAvailable,
        lastBooked: dateMatches[0] ?? null,
        sourcePdfDate: meta.reportDate,
        sourcePdfUrl: meta.pdfUrl
      });
    }

    current = null;
  };

  for (const line of lines) {
    const sectionMatch = line.match(/^#\s*\d+\s*-\s*(.+)$/);
    if (sectionMatch) {
      flushCurrent();
      currentSection = sectionMatch[1].replace(/\s+/g, " ").trim();
      continue;
    }

    if (
      /^Strana\s+\d+\s+od\s+\d+/i.test(line) ||
      /^#\s*Klini/i.test(line) ||
      /^Prvi slobodni termin$/i.test(line) ||
      /^Datum Ambulanta/i.test(line)
    ) {
      continue;
    }

    const rowStart = line.match(/^(\d{6})\s+(.+)$/);
    if (rowStart) {
      const [, code, name] = rowStart;
      if (code === "111111" && current) {
        current.lines.push(line);
        continue;
      }

      flushCurrent();
      current = { code, name, lines: [line] };
      continue;
    }

    if (current) {
      current.lines.push(line);
    }
  }

  flushCurrent();
  return dedupeRecords(rows);
}

function aggregateBySpecialist(rows: SlotRecord[]): SpecialistSlot[] {
  const map = new Map<string, SlotRecord[]>();

  for (const row of rows) {
    const key = makeKey(row.section, row.specialist);
    const list = map.get(key) ?? [];
    list.push(row);
    map.set(key, list);
  }

  const aggregated: SpecialistSlot[] = [];

  for (const [key, list] of map.entries()) {
    const withSlots = list.filter((x) => x.status === "HAS_SLOTS");
    const status = withSlots.length > 0 ? "HAS_SLOTS" : "NO_SLOTS";
    const firstAvailable =
      status === "HAS_SLOTS"
        ? withSlots
            .map((x) => x.firstAvailable)
            .filter((v): v is string => Boolean(v))
            .sort((a, b) => {
              const da = parseSlotDate(a)?.getTime() ?? Number.MAX_SAFE_INTEGER;
              const db = parseSlotDate(b)?.getTime() ?? Number.MAX_SAFE_INTEGER;
              return da - db;
            })[0] ?? null
        : null;

    aggregated.push({
      key,
      section: list[0].section,
      specialist: list[0].specialist,
      status,
      firstAvailable,
      codes: [...new Set(list.map((x) => x.code))].sort(),
      variants: list.length
    });
  }

  return aggregated.sort((a, b) => {
    if (a.status !== b.status) return a.status === "HAS_SLOTS" ? -1 : 1;
    const da = parseSlotDate(a.firstAvailable)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const db = parseSlotDate(b.firstAvailable)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    if (da !== db) return da - db;
    if (a.section !== b.section) return a.section.localeCompare(b.section);
    return a.specialist.localeCompare(b.specialist);
  });
}

export async function fetchLatestPdfMeta(): Promise<KccgPdfMeta> {
  const res = await fetch(KCCG_HOME_URL, {
    method: "GET",
    headers: {
      "user-agent": "kccg-slots-app/1.0"
    },
    next: { revalidate: 0 }
  });

  if (!res.ok) {
    throw new Error(`KCCG home fetch failed: ${res.status}`);
  }

  const html = await res.text();

  const pdfMatch = html.match(
    /href="(https:\/\/www\.kccg\.me\/wp-content\/uploads\/[^"]*prvi-slobodan-termin[^"]*\.pdf)"/i
  );

  if (!pdfMatch) {
    throw new Error("Unable to locate KCCG daily PDF URL on homepage");
  }

  const dateMatch = html.match(/<h6[^>]*>(\d{2}\.\d{2}\.\d{4})<\/h6>/i);
  const reportDate = dateMatch?.[1] ?? new Date().toISOString().slice(0, 10);

  return {
    reportDate,
    pdfUrl: pdfMatch[1]
  };
}

export async function fetchSnapshotFromPdfMeta(meta: KccgPdfMeta): Promise<SlotsSnapshot> {
  const proxyUrl = `https://r.jina.ai/http://${meta.pdfUrl}`;
  const res = await fetch(proxyUrl, {
    method: "GET",
    headers: {
      "user-agent": "kccg-slots-app/1.0"
    },
    next: { revalidate: 0 }
  });

  if (!res.ok) {
    throw new Error(`Parsed PDF fetch failed: ${res.status}`);
  }

  const raw = await res.text();
  const markdown = extractMarkdown(raw);
  const records = parseRows(markdown, meta);

  return {
    generatedAt: new Date().toISOString(),
    sourcePdfDate: meta.reportDate,
    sourcePdfUrl: meta.pdfUrl,
    recordsCount: records.length,
    bySpecialist: aggregateBySpecialist(records)
  };
}

export async function fetchLatestSnapshot(): Promise<SlotsSnapshot> {
  const meta = await fetchLatestPdfMeta();
  return fetchSnapshotFromPdfMeta(meta);
}
