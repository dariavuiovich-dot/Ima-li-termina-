const fs = require('fs');
const text = fs.readFileSync('current_pdf_19.txt','utf8');

function parseSlotDate(value) {
  if (!value) return null;
  const m = value.match(/^(\d{2})\.(\d{2})\.(\d{4})\.\s*(\d{2}):(\d{2})$/);
  if (!m) return null;
  const [,dd,mm,yyyy,hh,min] = m;
  const d = new Date(Number(yyyy), Number(mm)-1, Number(dd), Number(hh), Number(min));
  return Number.isNaN(d.getTime()) ? null : d;
}
function makeKey(section,specialist){ return `${section}::${specialist}`; }
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
    .replace(/KLINIÄŒKI CENTAR CRNE GORE/gi, '')
    .replace(/Prvi slobodni termin za zakazivanje od datuma[^\n]*/gi, '')
    .replace(/Prvi slobodni termin/gi, '')
    .replace(/Poslednje dati termin/gi, '')
    .replace(/Datum Ambulanta Doktor[^\n]*/gi, '')
    .replace(/Strana \d+ od \d+/gi, '')
    .replace(/KOD AMBULANTA DOKTOR TERMIN[^\n]*/gi, '')
    .replace(/\bDatum\b/gi, '')
    .replace(/\bAmbulanta\b/gi, '')
    .replace(/\bDoktor\b/gi, '')
    .replace(/\bPrvi\s+slobodni\s+termin\b/gi, '')
    .replace(/\bPoslednje\s+dati\s+termin\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}
function dedupeRecords(rows) {
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const key = `${row.code}|${row.section}|${row.specialist}|${row.status}|${row.firstAvailable ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}
function parseRowsUniversal(markdown) {
  const lines = markdown.split(/\r?\n/);
  const rows = [];
  let currentSection = null;
  let current = null;
  const flush = () => {
    if (!current || !currentSection) return;
    const block = sanitizeRowNoise(current.lines.join(' '));
    if (!block) { current = null; return; }
    const specialistMatch = block.match(/^(.*?)(?=\s+111111\s+Ljekar specijalista u amb\.?)/i);
    const specialistSource = specialistMatch?.[1] ?? block;
    const specialist = cleanName(sanitizeRowNoise(specialistSource));
    if (!specialist) { current = null; return; }
    const status = /Nema slobodnih termina/i.test(block) ? 'NO_SLOTS' : 'HAS_SLOTS';
    let firstAvailable = null;
    if (status === 'HAS_SLOTS') {
      const dm = block.match(/(\d{2}\.\d{2}\.\d{4}\.)\s*(\d{2}:\d{2})/);
      if (dm) firstAvailable = `${dm[1]} ${dm[2]}`;
    }
    rows.push({ code: current.code, section: currentSection, specialist, status, firstAvailable });
    current = null;
  };
  for (let raw of lines) {
    const line = raw.replace(/\s+/g,' ').trim();
    if (!line) continue;
    const sectionMatch = line.match(/^#\s*(\d+)\s*-\s*(.+)$/i);
    if (sectionMatch) { flush(); currentSection = sanitizeRowNoise(sectionMatch[2]); continue; }
    const rowStart = line.match(/^(\d{6})\s+(.*)$/);
    if (rowStart) { flush(); current = { code: rowStart[1], lines: [rowStart[2]] }; continue; }
    if (current) current.lines.push(line);
  }
  flush();
  return dedupeRecords(rows);
}
function parseRowsLegacy(markdown) {
  const rows = [];
  let currentSection = null;
  const lines = markdown.split(/\r?\n/).map((line) => line.trim());
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line) { i += 1; continue; }
    const sectionMatch = line.match(/^#\s*(\d+)\s*-\s*(.+)$/);
    if (sectionMatch) { currentSection = sanitizeRowNoise(sectionMatch[2]); i += 1; continue; }
    const start = line.match(/^(\d{6})\s+(.*)$/);
    if (!start || !currentSection) { i += 1; continue; }
    let block = `${start[1]} ${start[2]}`;
    let j = i + 1;
    while (j < lines.length && !lines[j].match(/^#\s*\d+\s*-/) && !lines[j].match(/^\d{6}\s+/)) {
      if (lines[j]) block += ` ${lines[j]}`;
      j += 1;
    }
    const specialistMatch = block.match(/^\d{6}\s+(.*?)(?=\s+111111\s+Ljekar specijalista u amb\.?)/i);
    if (specialistMatch) {
      const specialist = cleanName(sanitizeRowNoise(specialistMatch[1]));
      const status = /Nema slobodnih termina/i.test(block) ? 'NO_SLOTS' : 'HAS_SLOTS';
      let firstAvailable = null;
      if (status === 'HAS_SLOTS') {
        const dm = block.match(/(\d{2}\.\d{2}\.\d{4}\.)\s*(\d{2}:\d{2})/);
        if (dm) firstAvailable = `${dm[1]} ${dm[2]}`;
      }
      rows.push({ code: start[1], section: currentSection, specialist, status, firstAvailable });
    }
    i = j;
  }
  return dedupeRecords(rows);
}
function parseRowsModern(markdown) {
  const rows = [];
  let currentSection = null;
  let pendingStatus = null;
  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const sectionMatch = line.match(/^#\s*(\d+)\s*-\s*(.+)$/);
    if (sectionMatch) { currentSection = sanitizeRowNoise(sectionMatch[2]); pendingStatus = null; continue; }
    if (/^Nema slobodnih termina$/i.test(line)) { pendingStatus = 'NO_SLOTS'; continue; }
    const m = line.match(/^(\d{6})\s+(.*?)\s+111111\s+Ljekar specijalista u amb\.?\s*(.*)$/i);
    if (!m || !currentSection) continue;
    const [,code,specialistRaw,rest] = m;
    const specialist = cleanName(sanitizeRowNoise(specialistRaw));
    let status = pendingStatus ?? null;
    let firstAvailable = null;
    const dm = rest.match(/(\d{2}\.\d{2}\.\d{4}\.)\s*(\d{2}:\d{2})/);
    if (dm) {
      status = 'HAS_SLOTS';
      firstAvailable = `${dm[1]} ${dm[2]}`;
    } else if (status !== 'NO_SLOTS') {
      status = /Nema slobodnih termina/i.test(rest) ? 'NO_SLOTS' : 'NO_SLOTS';
    }
    rows.push({ code, section: currentSection, specialist, status, firstAvailable });
    pendingStatus = null;
  }
  return dedupeRecords(rows);
}
function scoreRows(rows) {
  let score = 0;
  for (const row of rows) {
    if (row.status === 'HAS_SLOTS' && row.firstAvailable) score += 12;
    if (row.status === 'NO_SLOTS') score += 8;
    if (row.section) score += 2;
    if (row.specialist && row.specialist.length >= 6) score += 2;
  }
  return score;
}
function parseRows(markdown) {
  const universal = parseRowsUniversal(markdown);
  const legacy = parseRowsLegacy(markdown);
  const modern = parseRowsModern(markdown);
  const hybrid = dedupeRecords([...legacy, ...modern]);
  const candidates = [
    {name:'universal', rows: universal, score: scoreRows(universal)+25},
    {name:'legacy', rows: legacy, score: scoreRows(legacy)},
    {name:'modern', rows: modern, score: scoreRows(modern)},
    {name:'hybrid', rows: hybrid, score: scoreRows(hybrid)}
  ].sort((a,b)=>b.score-a.score);
  return candidates[0].rows;
}
function aggregateBySpecialist(rows) {
  const grouped = new Map();
  for (const row of rows) {
    const key = makeKey(row.section, row.specialist);
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, {key, section: row.section, specialist: row.specialist, status: row.status, firstAvailable: row.firstAvailable, codes:[row.code]});
      continue;
    }
    existing.codes.push(row.code);
    const rowDate = parseSlotDate(row.firstAvailable)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const exDate = parseSlotDate(existing.firstAvailable)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    if (row.status === 'HAS_SLOTS' && (existing.status !== 'HAS_SLOTS' || rowDate < exDate)) {
      existing.status = 'HAS_SLOTS';
      existing.firstAvailable = row.firstAvailable;
    }
  }
  return [...grouped.values()];
}
function normalizeForSearch(input) {
  return input
    .toLowerCase()
    .replace(/Ä‘/g, 'dj')
    .replace(/Å¡/g, 's')
    .replace(/[ÄÄ‡]/g, 'c')
    .replace(/Å¾/g, 'z')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
const CYR_TO_LAT_MAP = { '':'dj','¼':'j','š':'lj','œ':'nj','Ÿ':'dz','ž':'c','c':'c','c':'c','s':'s','z':'z','d':'dj','C':'c','C':'c','S':'s','Z':'z','D':'dj' };
function transliterateCyrillicToLatin(input){ let out=''; for(const ch of input.toLowerCase()) out += CYR_TO_LAT_MAP[ch] ?? ch; return out; }
function normalizeQueryLatin(query){ return normalizeForSearch(transliterateCyrillicToLatin(query)); }
function expandNeedleVariants(rawQuery) {
  const out = new Set();
  const add = (v)=>{ const n = normalizeForSearch(v); if(n) out.add(n); };
  add(rawQuery); add(transliterateCyrillicToLatin(rawQuery));
  const latin = normalizeForSearch(transliterateCyrillicToLatin(rawQuery));
  if (/(nevrolog|neurolog|nevro|neuro)/.test(latin)) { add('neurolog'); add('neuroloska ambulanta'); }
  if (/(urolog)/.test(latin)) { add('urolog'); add('uroloska ambulanta'); }
  if (/(ortoped)/.test(latin)) { add('ortoped'); add('ortopedska ambulanta'); }
  if (/(gastroenterolog|gastroenterohepatolog|geh|gastrolog)/.test(latin)) { add('gastroenterohepatolog'); add('gastroenterohepatoloska'); add('gastroenteroloska'); add('gastro'); add('geh'); }
  return [...out];
}
function wordWiseLooseMatch(haystack, needle) {
  if (!needle) return false;
  const hWords = haystack.split(' ').filter(Boolean);
  const nWords = needle.split(' ').filter(Boolean);
  if (!nWords.length) return false;
  return nWords.every((n)=>hWords.some((h)=>{
    if ((n==='1'&&h==='i')||(n==='2'&&h==='ii')) return true;
    if ((n==='i'&&h==='1')||(n==='ii'&&h==='2')) return true;
    if (n.length <= 2) return h === n || h.startsWith(n);
    if (h.includes(n)) return true;
    if (h.length >=3 && n.length >=3 && n.includes(h)) return true;
    if (h.length >=5 && n.length >=5) return h.slice(0,5) === n.slice(0,5);
    return false;
  }));
}
function looseTextMatch(haystackRaw, needleRaw) {
  if (!needleRaw.trim()) return true;
  const haystack = normalizeForSearch(haystackRaw);
  const candidates = expandNeedleVariants(needleRaw);
  if (!candidates.length) return false;
  return candidates.some((candidate)=>wordWiseLooseMatch(haystack, candidate));
}
function cleanSpecialistName(value) {
  return value
    .replace(/\b([123])1{4,}(?=\s+Ljekar specijalista u amb\.?)/gi, '$1')
    .replace(/\s*\d*\s*Ljekar specijalista u amb\.?.*$/i, '')
    .replace(/\b([123])1{4,}\b/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}
function isPediatricItem(item) {
  const sectionNorm = normalizeForSearch(item.section);
  const specialistNorm = normalizeForSearch(item.specialist);
  const raw = `${item.section} ${item.specialist}`.toUpperCase();
  if (sectionNorm.includes('institut za bolesti djece')) return true;
  if (raw.includes('IBD') || raw.includes('DJE') || raw.includes('PEDIJ')) return true;
  return /(djec|deca|djeca|pedij|pediat|neonat|ibd)/.test(specialistNorm);
}
function isExcludedAdministrativeItem(item) {
  const combinedNorm = normalizeForSearch(`${item.specialist} ${item.section}`);
  if (combinedNorm.includes('zakazivanje') && /konzilij|konsilij|konsilium|consilium/.test(combinedNorm) && (/\bmr\b/.test(combinedNorm) || combinedNorm.includes('magnet'))) return false;
  if (/(konzilij|konsilij|consilium|konsilium)/.test(combinedNorm)) return true;
  if (combinedNorm.includes('upucivanje pacijenata u inostranstvo')) return true;
  return false;
}
function isNeurologyAmbulantaOneOrTwo(item) {
  const sp = normalizeForSearch(item.specialist);
  const sec = normalizeForSearch(item.section);
  return sec.includes('klinika za neurologiju') && /neuroloska ambulanta (i|ii|1|2)\b/.test(sp);
}

const rows = parseRows(text);
const bySpecialist = aggregateBySpecialist(rows);
const allItems = bySpecialist.map((item)=>({ ...item, specialist: cleanSpecialistName(item.specialist) }));
const searchableItems = allItems.filter((item)=>!isPediatricItem(item));
const visibleItems = searchableItems.filter((item)=>!isExcludedAdministrativeItem(item));
const queries = ['neurolog','urolog','ortop','gastro'];
console.log(JSON.stringify({ counts:{ rows:rows.length, bySpecialist:bySpecialist.length, allItems:allItems.length, searchableItems:searchableItems.length, visibleItems:visibleItems.length, neurologyAmbIii:visibleItems.filter(isNeurologyAmbulantaOneOrTwo).length } }, null, 2));
for (const q of queries) {
  const matched = visibleItems.filter((item)=>looseTextMatch(`${item.specialist} ${item.section}`, q));
  console.log(`\n=== ${q} ===`);
  console.log('candidates', expandNeedleVariants(q));
  console.log('matched', matched.length);
  console.log(matched.slice(0,8).map((x)=>({section:x.section,specialist:x.specialist,status:x.status,firstAvailable:x.firstAvailable, norm: normalizeForSearch(`${x.specialist} ${x.section}`)})));
}
console.log('\n=== neurology visible raw ===');
console.log(visibleItems.filter((x)=>/NEURO|UROLO|ORTOP|GASTRO/i.test(`${x.specialist} ${x.section}`)).slice(0,30).map((x)=>({section:x.section,specialist:x.specialist,status:x.status,firstAvailable:x.firstAvailable,normSp:normalizeForSearch(x.specialist),normSec:normalizeForSearch(x.section),isPed:isPediatricItem(x)})));
