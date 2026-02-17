import { SlotRecord, SpecialistSlot, SlotsSnapshot } from "@/lib/types";
import { makeKey, parseSlotDate } from "@/lib/utils";

const KCCG_HOME_URL = "https://www.kccg.me/";

interface KccgPdfMeta {
  reportDate: string;
  pdfUrl: string;
}

function cleanName(value: string): string {
  return value
    // OCR can glue doctor marker to ambulanta ordinal:
    // "AMBULANTA 2111111 Ljekar specijalista u amb." -> "AMBULANTA 2".
    .replace(/\b([123])1{4,}(?=\s+Ljekar specijalista u amb\.?)/gi, "$1")
    // Drop trailing doctor marker regardless of dot/spacing variants.
    .replace(/\s*\d*\s*Ljekar specijalista u amb\.?.*$/i, "")
    // Normalize leftover glued digits (e.g. "2 111111" or "2111111").
    .replace(/\b([123])1{4,}\b/g, "$1")
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

function parseRowsLegacy(markdown: string, meta: KccgPdfMeta): SlotRecord[] {
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

function parseRowsModern(markdown: string, meta: KccgPdfMeta): SlotRecord[] {
  const out: SlotRecord[] = [];
  const sectionRegex =
    /(?:^|\n)#\s*(\d+\s*-\s*[^\n]+?)\s*\n([\s\S]*?)(?=(?:\n#\s*\d+\s*-\s*[^\n]+)|$)/g;

  for (const match of markdown.matchAll(sectionRegex)) {
    const heading = match[1]?.replace(/\s+/g, " ").trim() ?? "";
    const sectionBody = match[2] ?? "";
    if (!heading) continue;

    const section = heading.replace(/^\d+\s*-\s*/i, "").trim();
    const compactBody = sectionBody.replace(/\s+/g, " ").trim();
    if (!compactBody) continue;

    const rowStartRegex = /\b(?!111111\b)(\d{6})\s+(?!Ljekar\b)/g;
    const starts = [...compactBody.matchAll(rowStartRegex)];
    if (!starts.length) continue;

    for (let i = 0; i < starts.length; i++) {
      const start = starts[i].index ?? 0;
      const end =
        i + 1 < starts.length
          ? starts[i + 1].index ?? compactBody.length
          : compactBody.length;
      const block = compactBody.slice(start, end).replace(/\s+/g, " ").trim();
      if (!block) continue;

      const codeMatch = block.match(/^(\d{6})\b/);
      const code = codeMatch?.[1];
      if (!code) continue;

      const specialistMatch =
        block.match(/^\d{6}\s+(.+?)\s+111111\d*\s+Ljekar specijalista u amb\.?/i) ??
        block.match(/^\d{6}\s+(.+?)\s+\d{2}\.\d{2}\.\d{4}\.\s*\d{2}:\d{2}/);

      const specialist = cleanName((specialistMatch?.[1] ?? "").trim());
      if (!specialist) continue;

      const hasNoSlots = /Nema slobodnih termina/i.test(block);
      const dateMatches = [...block.matchAll(/\d{2}\.\d{2}\.\d{4}\.\s*\d{2}:\d{2}/g)]
        .map((m) => m[0].replace(/\s+/g, " "))
        .filter(Boolean);

      const firstAvailable = hasNoSlots
        ? null
        : dateMatches
            .map((value) => ({
              value,
              ts: parseSlotDate(value)?.getTime() ?? Number.MAX_SAFE_INTEGER
            }))
            .sort((a, b) => a.ts - b.ts)[0]?.value ?? null;

      const lastBooked =
        dateMatches
          .map((value) => ({
            value,
            ts: parseSlotDate(value)?.getTime() ?? Number.MIN_SAFE_INTEGER
          }))
          .sort((a, b) => b.ts - a.ts)[0]?.value ?? null;

      out.push({
        section,
        code,
        specialist,
        status: hasNoSlots ? "NO_SLOTS" : "HAS_SLOTS",
        firstAvailable,
        lastBooked,
        sourcePdfDate: meta.reportDate,
        sourcePdfUrl: meta.pdfUrl
      });
    }
  }

  return dedupeRecords(out);
}

function scoreRows(rows: SlotRecord[]): number {
  if (!rows.length) return 0;
  const sectionCount = new Set(rows.map((x) => x.section)).size;
  const hasSlotsCount = rows.filter((x) => x.status === "HAS_SLOTS").length;
  const longNamePenalty = rows.filter((x) => x.specialist.length > 140).length * 5;
  const looksBrokenPenalty = rows.filter((x) =>
    /(prvi slobodni termin|datum ambulanta doktor|strana \d+ od \d+)/i.test(
      x.specialist
    )
  ).length * 10;

  return (
    rows.length * 10 +
    sectionCount * 5 +
    hasSlotsCount * 2 -
    longNamePenalty -
    looksBrokenPenalty
  );
}

function parseRows(markdown: string, meta: KccgPdfMeta): SlotRecord[] {
  const legacy = parseRowsLegacy(markdown, meta);
  const modern = parseRowsModern(markdown, meta);
  const hybrid = dedupeRecords([...modern, ...legacy]);

  const candidates = [
    { name: "legacy", rows: legacy, score: scoreRows(legacy) },
    { name: "modern", rows: modern, score: scoreRows(modern) },
    { name: "hybrid", rows: hybrid, score: scoreRows(hybrid) }
  ].sort((a, b) => b.score - a.score);

  // Auto-select the best known strategy for current PDF shape.
  return candidates[0].rows;
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
