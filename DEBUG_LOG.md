# DEBUG_LOG

Last updated: 2026-10-14

## Context

Task: diagnose why adult specialists from the new text-readable KCCG PDF stopped appearing in `/api/slots`.

Confirmed upfront:
- raw PDF text was readable
- adult rows existed in `current_pdf_19.txt`
- parser/aggregate were not the first broken stage
- pediatrics are not wanted in search results

## Stage-by-stage diagnosis

### 1. PDF raw text

Verified present in `current_pdf_19.txt`:
- `NEUROLOŠKA AMBULANTA I`
- `NEUROLOŠKA AMBULANTA II`
- `UROLOŠKA AMBULANTA I`
- `UROLOŠKA AMBULANTA II`
- `ORTOPEDSKA AMBULANTA I/II/III`
- `GASTROENTEROLOŠKA AMBULANTA`
- `KABINET ZA GASTROSKOPIJU`
- `KABINET ZA KOLONOSKOPIJU`

Conclusion:
- raw text stage was alive

### 2. Parse rows

Checked `lib/kccg.ts` strategies (`universal`, `modern`, `legacy`, `hybrid`).

Important observation:
- `universal` and `modern` correctly parsed adult rows with full names like `ORTOPEDSKA AMBULANTA I`
- some ad-hoc trace scripts were misleading because they simplified names differently

Conclusion:
- parser was not the main systemic failure

### 3. Aggregate by specialist

Checked aggregated adult specialists:
- neurology rows survived
- urology rows survived
- orthopedics rows survived
- gastro rows survived

Conclusion:
- aggregate stage was alive

### 4. Searchable / visible items

Found two systemic issues in downstream filtering:

1. `toSafeLimit()` bug
- `Number(null)` became `0`
- fallback was skipped
- `Math.max(1, 0)` became `1`
- practical effect: endpoints silently defaulted to `limit=1`

2. pediatric filtering false positives
- substring checks were too broad
- `PEDIJ` inside `ORTOPEDIJA/ORTOPEDIJU` could classify adult orthopedics as pediatric

Conclusion:
- adult rows were sometimes present internally but then either filtered wrongly or reduced to 1 result

### 5. Matching

Found two systemic matcher bugs in `app/api/slots/route.ts`:

1. alias contamination in `expandNeedleVariants()`
- `neurolog` could generate `urolog` because regexes were too loose

2. over-broad fallback in `wordWiseLooseMatch()`
- substring behavior was too permissive
- this caused cross-specialty bleed between similar stems

Conclusion:
- matching was not trustworthy for short medical stems

### 6. Specialty-specific output logic

Found neurology-specific fragility:
- `isNeurologyAmbulantaOneOrTwo()` assumed the old parsed specialist shape and insisted on `ambulanta`
- new/current parsed data can still be valid even when the name is shortened

Conclusion:
- neurology grouping logic needed to accept both old and shortened specialist naming

## Fixes applied

Main file changed:
- `app/api/slots/route.ts`

Fix set:
- tightened alias expansion for neurology/urology/orthopedics to word-boundary matching
- narrowed `wordWiseLooseMatch()` to prefix-based matching instead of very broad substring fallback
- fixed `toSafeLimit()` so missing/empty `limit` uses the fallback instead of collapsing to `1`
- tightened `hasChildIntent()` to word-boundary matching so `ortopedija` is not treated as pediatric
- relaxed `isNeurologyAmbulantaOneOrTwo()` so current valid neurology rows are still recognized
- changed `/api/slots` to exclude pediatric records from search universe always
- added early return for child-intent searches with empty result, per product instruction that pediatrics are not needed
- kept MR council and CT coronarography notes untouched

Additional local architectural cleanup:
- same `toSafeLimit()` fix applied to:
  - `app/api/schedule/route.ts`
  - `app/api/notifications/route.ts`

## Semantics review

### Preserved intentionally

MR council flow:
- note text preserved for MR council scheduling ambulanta
- combined MR answer still uses council-first instruction path

CT coronarography:
- council approval note preserved
- Poliklinika link preserved

Gastro ordering:
- generic `gastro` keeps ambulanta/endoscopy matching
- `gastroskopija` and `kolonoskopija` still route to procedure-specific logic

Schedule oculoplastic scoping:
- `lib/poliklinikaSchedule.ts` still separates:
  - oculoplastic / lacrimal queries
  - generic plastic surgery queries
- no changes were made there

### Verified locally

Compiled `/api/slots` runtime with in-memory snapshot:
- `neurolog` returned neurology/neurosurgery group items
- `urolog` returned adult urology rows
- `ortop` returned adult orthopedics rows
- `gastro` returned adult gastro rows
- `djecija ortopedija` returned empty result after pediatric shutdown

Compiled `/api/schedule` runtime with synthetic schedule snapshot:
- `okuloplastika` matched only oculoplastic item
- `plasticna hirurgija` matched only plastic surgery item
- `gastroskopija` matched gastroscopy item
- `kolonoskopija` matched colonoscopy item

## Deployment status

Git:
- slots fix commit pushed: `f71f02c` (`Fix slots adult search pipeline`)
- follow-up debug/limit commit pushed: `b2f0f2b` (`Document slots debug trail and fix API limits`)

Production deploy:
- initial `vercel --prod --yes` failed because Vercel token was invalid
- after CLI login was repaired, production deploy succeeded and served commit `b2f0f2b`

Practical consequence:
- new code reached production, but `/api/slots` still returned zero adult matches
- this proved the remaining failure was not deploy state anymore

## Production-only root cause found after deploy

Observed on production after successful deploy:
- `/api/health` showed the new commit
- `/api/slots?q=ortoped`
- `/api/slots?q=urolog`
- `/api/slots?q=neurolog`
- `/api/slots?q=gastro`
- all still returned `total: 0`

Meaning:
- route code was new
- source PDF date stayed the same
- Redis snapshot still contained a degraded/bad specialist universe
- metadata refresh logic did not run because it only self-healed when a newer PDF was detected

Final systemic gap:
- pipeline recovery depended too much on "newer PDF exists"
- it did not recover when the same PDF date had been parsed badly once and cached in Redis

## Final fix added

File:
- `app/api/slots/route.ts`

Change:
- extracted snapshot-to-items mapping into a dedicated helper
- added adult coverage health check over visible non-pediatric items
- if adult coverage is suspiciously low, `/api/slots` now:
  - refetches the latest snapshot immediately
  - overwrites the bad cached snapshot
  - stores a debug breadcrumb under `slots:last_query_self_heal`

Coverage sentinel logic:
- require at least 40 visible adult items
- require at least 3 of these adult markers to exist:
  - `neuroloska ambulanta`
  - `uroloska ambulanta`
  - `ortopedska ambulanta`
  - `gastroenteroloska ambulanta`

Why this is minimal and safe:
- no parser refactor
- no UI changes
- no change to specialty ordering semantics
- only heals obviously bad adult coverage snapshots

## Follow-up ops alert

Files:
- `lib/sync.ts`
- `.env.example`

Change:
- added Telegram ops alert when parsed `recordsCount` drops versus the previous snapshot by at least `OPS_RECORDS_DROP_ALERT_MIN`
- default threshold is `12` rows
- alert is deduplicated via debug storage key, so the same drop does not spam repeatedly

Purpose:
- catch "PDF parsed, but 10-15 rows quietly disappeared" much earlier
- surface medium parse degradation before the snapshot becomes catastrophically bad

## Residual semantics note

Neurology answer semantics remain domain-specific:
- `Neuroloska ambulanta I/II` can correctly show `NEMA TERMINA`
- while grouped result items can still include EEG / dispanzer / neurohirurgija rows
- this is expected from current grouped-neurology product logic, not a parse failure

## 2026-10-14: PDF refresh and schedule recovery

User reported the deployed app remained on the 14.08.2026 report. Production logs and Redis were not available in this cloud task, so the exact first failure date is not established.

Confirmed source-discovery defect:
- The live KCCG homepage publishes a dated availability report at `https://www.kccg.me/wp-content/uploads/2026/10/ilovepdf-merged-6.pdf` (13.10.2026).
- Existing discovery required `prvi-slobodan-termin` in the filename, so it could not discover this report.
- Existing PDF parsing itself recovered all 174 codes and 171 specialist groups from current Jina text, with no malformed specialist names.

Fixes:
- Discover the PDF and date inside the availability report section, ignoring unrelated documents/dates elsewhere on the homepage. Preserve historical named-PDF and Markdown fallback behavior.
- Do not substitute today's date when the source date is missing.
- Normalize the Jina request to `https://r.jina.ai/<absolute-pdf-url>`. The historical double-scheme URL still returned 200 during investigation, so it is not claimed as the root cause.
- Set finite upstream timeouts and reject zero-record parses before storage is updated.
- When checking for a newer report, fetch the exact metadata already discovered rather than discovering it a second time.

Additional confirmed schedule defect:
- Both uploaded and live Poliklinika HTML include colonoscopy schedules inside the endoscopy accordion.
- The parser discarded these subsection headings, making colonoscopy schedule searches return no results.
- Preserve procedure-specific source headings, reset schedule context at each procedure, recognize the ezofagogastroduodenoscopy name, and bump parser version to 3 to invalidate old cached schedules.
- Record schedule refresh diagnostics at `schedule:last_query_refresh`.

Cloud runtime issue:
- Native Node fetch initially failed with EAI_AGAIN while curl succeeded through the supplied proxy.
- `NODE_USE_ENV_PROXY=1` on Node 24 fixed live API fetches without disabling TLS verification.

Validation:
- 13 offline regression tests pass, including current/historical PDF parsing, August-cache recovery, empty-parse cache preservation, specialty filtering, schedule procedure separation, in-app notifications, repeat sync and production auth denial.
- Live local searches for neurology, urology, orthopedics, gastro, gastroscopy, colonoscopy, MR, CT and OCT return the 13.10.2026 report; child-intent searches remain empty.
- Live schedule parsing returns 260 records; colonoscopy returns 7 doctor/day entries.
- Live manual slots sync and cron-handler checks succeed; an unchanged report is skipped. This does not establish Vercel cron scheduling.
- Production network access, Redis and delivery credentials are unavailable; no production deployment or external notifications were performed.
- Production build passes. Local `next start` returns current slots and colonoscopy schedules; unauthenticated sync/cron requests correctly return HTTP 401.
