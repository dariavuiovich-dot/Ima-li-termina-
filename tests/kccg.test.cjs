const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { NextRequest } = require('next/server');
const createRuntime = require('./helpers/runtime.cjs');

const fixture = name => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');
const home = fixture('availability-home-2026-10-13.html');
const text = fixture('slots-2026-10-13.txt');
const pdfUrl = 'https://www.kccg.me/wp-content/uploads/2026/10/ilovepdf-merged-6.pdf';
const meta = { reportDate: '13.10.2026', pdfUrl };
function network(homepage = home, pdfText = text) {
  return async url => {
    if (url === 'https://www.kccg.me/') return new Response(homepage);
    if (url === `https://r.jina.ai/${pdfUrl}`) return new Response(pdfText);
    throw new Error(`Unexpected test request: ${url}`);
  };
}

test('discovers renamed merged report and its own date, ignoring unrelated PDFs and dates', async () => {
  const runtime = createRuntime(network('<h6>01.01.2025</h6>' + home));
  const result = await runtime.load('lib/kccg.ts').fetchLatestPdfMeta();
  assert.equal(result.pdfUrl, pdfUrl);
  assert.equal(result.reportDate, '13.10.2026');
});

test('keeps the historical named PDF discovery working', async () => {
  const oldHome = fs.readFileSync(path.join(__dirname, '../kccg_home.html'), 'utf8');
  const runtime = createRuntime(network(oldHome));
  const result = await runtime.load('lib/kccg.ts').fetchLatestPdfMeta();
  assert.match(result.pdfUrl, /prvi-slobodan-termin.*\.pdf$/);
  assert.match(result.reportDate, /^\d{2}\.\d{2}\.\d{4}$/);
});

test('falls back to Markdown homepage when direct KCCG access fails', async () => {
  const runtime = createRuntime(async url => {
    if (url === 'https://www.kccg.me/') throw new Error('upstream unavailable');
    assert.equal(url, 'https://r.jina.ai/http://www.kccg.me/');
    return new Response(`## Prvi slobodni termin za zakazivanje ambulantnih pregleda\n\n###### 13.10.2026\n\n[Preuzmi PDF](${pdfUrl})\n\n## Vijesti\n`);
  });
  const result = await runtime.load('lib/kccg.ts').fetchLatestPdfMeta();
  assert.equal(result.pdfUrl, pdfUrl);
  assert.equal(result.reportDate, meta.reportDate);
});

test('does not invent a current date or select an unrelated document', async () => {
  for (const page of [home.replaceAll('13.10.2026', ''), '<h6>13.10.2026</h6><a href="/unrelated.pdf">PDF</a>']) {
    const runtime = createRuntime(async () => new Response(page));
    await assert.rejects(runtime.load('lib/kccg.ts').fetchLatestPdfMeta(), /No dated availability PDF/);
  }
});

test('parses all current merged-PDF rows, including OCT supplement and adult specialties', async () => {
  const runtime = createRuntime(network());
  const snapshot = await runtime.load('lib/kccg.ts').fetchLatestSnapshot();
  assert.equal(snapshot.recordsCount, 174);
  assert.equal(snapshot.bySpecialist.length, 171);
  const codes = new Set(snapshot.bySpecialist.flatMap(item => item.codes));
  assert.equal(codes.size, 174);
  for (const code of ['210179', '210129', '510466', '510326', '160109', '160119', '140109', '140129', '130109', '130119', '130149', '114039', '113019', '113129']) assert.ok(codes.has(code), code);
  const oct = snapshot.bySpecialist.find(item => item.codes.includes('210179'));
  assert.equal(oct.firstAvailable, '30.10.2026. 18:00');
  assert.equal(snapshot.bySpecialist.find(item => item.codes.includes('510326')).status, 'NO_SLOTS');
  assert.ok(snapshot.bySpecialist.every(item => item.section && item.specialist.length < 140));
});

test('still parses the uploaded April report with adult specialists', async () => {
  const april = fs.readFileSync(path.join(__dirname, '../current_pdf_19.txt'), 'utf8');
  const runtime = createRuntime(network(home, april));
  const snapshot = await runtime.load('lib/kccg.ts').fetchSnapshotFromPdfMeta({ reportDate: '30.04.2026', pdfUrl });
  assert.ok(snapshot.recordsCount >= 140);
  for (const name of ['NEUROLOŠKA AMBULANTA I', 'UROLOŠKA AMBULANTA I', 'ORTOPEDSKA AMBULANTA I', 'GASTROENTEROLOŠKA AMBULANTA']) assert.ok(snapshot.bySpecialist.some(item => item.specialist === name), name);
});

test('empty parsing fails sync and preserves the last good stored snapshot', async () => {
  const runtime = createRuntime(network(home, 'Upstream returned no report text'));
  const storage = runtime.load('lib/storage.ts');
  const previous = { generatedAt: '2026-08-14', sourcePdfDate: '14.08.2026', sourcePdfUrl: '/old.pdf', recordsCount: 174, bySpecialist: [] };
  await storage.saveSnapshot(previous);
  const result = await runtime.load('lib/sync.ts').runDailySync('test');
  assert.equal(result.ok, false);
  assert.match(result.reason, /no slot records/);
  assert.equal((await storage.getLatestSnapshot()).sourcePdfDate, '14.08.2026');
  assert.match((await storage.getDebugValue('sync:last_error')).reason, /no slot records/);
});

test('search repairs a healthy August cache and keeps specialty semantics', async () => {
  const runtime = createRuntime(network());
  const fresh = await runtime.load('lib/kccg.ts').fetchLatestSnapshot();
  const storage = runtime.load('lib/storage.ts');
  await storage.saveSnapshot({ ...fresh, sourcePdfDate: '14.08.2026', sourcePdfUrl: 'https://www.kccg.me/wp-content/uploads/2026/08/old.pdf' });
  const route = runtime.load('app/api/slots/route.ts');
  for (const query of ['neurolog', 'urolog', 'ortoped', 'gastro', 'gastroskopija', 'kolonoskopija', 'MR', 'CT koronografije', 'OCT']) {
    const response = await route.GET(new NextRequest(`http://localhost/api/slots?q=${encodeURIComponent(query)}`));
    assert.equal(response.status, 200, query);
    const result = await response.json();
    assert.equal(result.sourcePdfDate, meta.reportDate, query);
    assert.ok(result.items.length > 0, query);
    assert.ok(result.items.every(item => !/DJEČ|PEDIJAT|INSTITUT ZA BOLESTI DJECE/i.test(item.specialist + item.section)), query);
    if (query === 'urolog') assert.ok(result.items.every(item => !/NEUROLO/i.test(item.specialist)));
    if (query === 'neurolog') assert.ok(result.items.every(item => !/^UROLO/i.test(item.specialist)));
  }
  const child = await (await route.GET(new NextRequest('http://localhost/api/slots?q=djecija%20ortopedija'))).json();
  assert.equal(child.total, 0);
  assert.equal((await storage.getLatestSnapshot()).sourcePdfDate, meta.reportDate);
  assert.equal((await storage.getDebugValue('slots:last_meta_check')).status, 'ok');
});

test('daily sync persists current data and skips an unchanged repeat', async () => {
  const runtime = createRuntime(network());
  const sync = runtime.load('lib/sync.ts');
  const first = await sync.runDailySync('test');
  assert.equal(first.ok, true);
  assert.equal(first.skipped, false);
  assert.equal(first.recordsCount, 174);
  const second = await sync.runDailySync('test');
  assert.equal(second.ok, true);
  assert.equal(second.skipped, true);
  assert.equal(second.notificationsCount, 0);
});

test('sync creates and stores in-app notifications without external delivery', async () => {
  const runtime = createRuntime(network());
  const storage = runtime.load('lib/storage.ts');
  await storage.upsertSubscription({ id: 'test-sub', userId: 'test-user', query: 'urolog', channel: 'in_app', active: true, createdAt: '2026-10-14', updatedAt: '2026-10-14' });
  const result = await runtime.load('lib/sync.ts').runDailySync('test');
  assert.equal(result.ok, true);
  assert.ok(result.notificationsCount >= 2);
  const notifications = await storage.getNotifications('test-user');
  assert.equal(notifications.length, result.notificationsCount);
  assert.ok(notifications.every(item => item.channel === 'in_app' && item.payload.reason === 'NEW_SPECIALIST_WITH_SLOTS'));
});

test('notification changes distinguish opened slots from earlier appointments', async () => {
  const runtime = createRuntime(network());
  const snapshot = await runtime.load('lib/kccg.ts').fetchLatestSnapshot();
  const before = { ...snapshot, bySpecialist: snapshot.bySpecialist.map(item => ({ ...item })) };
  before.bySpecialist.find(item => item.codes.includes('140109')).status = 'NO_SLOTS';
  before.bySpecialist.find(item => item.codes.includes('130109')).firstAvailable = '30.11.2026. 10:00';
  const changes = runtime.load('lib/notify.ts').computeChanges(before, snapshot);
  assert.equal(changes.length, 2);
  assert.ok(changes.some(item => item.specialist === 'UROLOŠKA AMBULANTA I' && item.reason === 'OPENED_SLOTS'));
  assert.ok(changes.some(item => item.specialist === 'ORTOPEDSKA AMBULANTA I' && item.reason === 'EARLIER_SLOT'));
});

test('uploaded schedule HTML parses and separates oculoplastic and plastic searches', async () => {
  const html = fs.readFileSync(path.join(__dirname, '../tmp_kccg_poliklinika.html'), 'utf8');
  const runtime = createRuntime(async () => new Response(html));
  const schedule = runtime.load('lib/poliklinikaSchedule.ts');
  const snapshot = await schedule.fetchDoctorScheduleSnapshot();
  assert.ok(snapshot.recordsCount > 100);
  for (const query of ['neurolog', 'ortoped', 'gastroskopija', 'kolonoskopija']) assert.ok(schedule.filterDoctorSchedule(snapshot.items, query).length > 0, query);
  const oculo = schedule.filterDoctorSchedule(snapshot.items, 'okuloplastika');
  const plastic = schedule.filterDoctorSchedule(snapshot.items, 'plasticna hirurgija');
  assert.ok(oculo.length > 0);
  assert.ok(plastic.length > 0);
  assert.ok(oculo.every(item => /okulo|lakrim/i.test(item.ambulanta)));
  assert.ok(plastic.every(item => !/okulo|lakrim/i.test(item.ambulanta)));
  const storage = runtime.load('lib/storage.ts');
  await storage.saveScheduleSnapshot({ ...snapshot, parserVersion: 2, items: [] });
  const response = await runtime.load('app/api/schedule/route.ts').GET(new NextRequest('http://localhost/api/schedule?q=kolonoskopija'));
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.ok(result.total > 0);
  assert.equal((await storage.getLatestScheduleSnapshot()).parserVersion, 3);
  assert.equal((await storage.getDebugValue('schedule:last_query_refresh')).reason, 'parser_version_changed');
});

test('production admin and cron routes deny unauthenticated access', async () => {
  const runtime = createRuntime(() => { throw new Error('unauthorized request must not fetch upstream'); });
  runtime.context.process.env.NODE_ENV = 'production';
  const request = new NextRequest('http://localhost/api/sync');
  assert.equal((await runtime.load('app/api/sync/route.ts').POST(request)).status, 401);
  assert.equal((await runtime.load('app/api/cron/daily-sync/route.ts').GET(request)).status, 401);
});
