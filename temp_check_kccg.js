const fs = require('fs');

function cleanName(value) {
  return value
    .replace(/\b([123])1{4,}(?=\s+Ljekar specijalista u amb\.?)/gi, '$1')
    .replace(/\s*\d*\s*Ljekar specijalista u amb\.?.*$/i, '')
    .replace(/\b([123])1{4,}\b/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function sanitizeRowNoise(value) {
  return value
    .replace(/#\s*Klini\S*\s+centar\s+Crne\s+Gore.*?(?=#|$)/gi, ' ')
    .replace(/Klini\S*\s+centar\s+Crne\s+Gore.*?(?=#|$)/gi, ' ')
    .replace(/Strana\s+\d+\s+od\s+\d+/gi, ' ')
    .replace(/\bPrvi slobodni termin\b/gi, ' ')
    .replace(/\bDatum Ambulanta Doktor Poslednje dati termin\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseRowsUniversal(markdown) {
  const lines = markdown.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  const rows = [];
  let currentSection = '';
  let current = null;

  const flushCurrent = () => {
    if (!current) return;
    const block = sanitizeRowNoise(current.lines.join(' '));
    if (!block) { current = null; return; }
    const markerMatch = block.match(/\b111111\d*\s+Ljekar specijalista u amb\.?/i);
    const markerIndex = markerMatch?.index ?? -1;
    let specialistSource = current.rawStartName;
    if (markerIndex >= 0) {
      const specialistMatch = block.match(new RegExp(`^${current.code}(?:\\.\\s*\\d+)?\\s*([\\s\\S]*?)\\s+111111\\d*\\s+Ljekar specijalista u amb\\.?`, 'i'));
      specialistSource = specialistMatch?.[1] ?? specialistSource;
    } else {
      const withoutCode = block.replace(new RegExp(`^${current.code}(?:\\.\\s*\\d+)?\\s*`), '');
      const fallbackSplit = withoutCode.split(/\b(?:Nema slobodnih termina|\d{2}\.\d{2}\.\d{4}\.\s*\d{2}:\d{2})\b/i)[0];
      specialistSource = fallbackSplit || specialistSource;
    }
    const specialist = cleanName(sanitizeRowNoise(specialistSource));
    const afterMarker = markerIndex >= 0 ? block.slice(markerIndex + markerMatch[0].length).trim() : block;
    const hasNoSlots = /Nema slobodnih termina/i.test(afterMarker);
    const dateMatches = [...afterMarker.matchAll(/\d{2}\.\d{2}\.\d{4}\.\s*\d{2}:\d{2}/g)].map(m => m[0].replace(/\s+/g, ' '));
    rows.push({section: currentSection, code: current.code, specialist, status: hasNoSlots ? 'NO_SLOTS' : 'HAS_SLOTS', firstAvailable: hasNoSlots ? null : (dateMatches[0] ?? null), afterMarker, block});
    current = null;
  };

  for (const line of lines) {
    if (/^#\s*Klini/i.test(line) || /^Strana\s+\d+\s+od\s+\d+/i.test(line) || /^Prvi slobodni termin$/i.test(line) || /^Datum Ambulanta Doktor Poslednje dati termin$/i.test(line)) continue;
    const sectionMatch = line.match(/^#\s*(\d+)\s*-\s*(.+)$/);
    if (sectionMatch) { flushCurrent(); currentSection = sanitizeRowNoise(sectionMatch[2]); continue; }
    const rowStart = line.match(/^(\d{6})(?:\.\s*\d+)?\s*(.*)$/);
    if (rowStart && rowStart[1] !== '111111') {
      flushCurrent();
      current = {code: rowStart[1], rawStartName: rowStart[2] ?? '', lines: [line]};
      continue;
    }
    if (current) current.lines.push(line);
  }
  flushCurrent();
  return rows;
}

const raw = fs.readFileSync('pdf_extracted.txt', 'utf8');
const rows = parseRowsUniversal(raw);
console.log('rows', rows.length);
for (const row of rows.filter(r => /gastro|kolono/i.test(r.specialist)).slice(0, 20)) {
  console.log(JSON.stringify({ code: row.code, specialist: row.specialist, status: row.status, firstAvailable: row.firstAvailable, section: row.section }, null, 2));
}
