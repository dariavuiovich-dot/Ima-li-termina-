# DEBUG_LOG

Last updated: 2026-04-30

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

Production deploy:
- attempted `vercel --prod --yes`
- failed because Vercel token is invalid
- error returned by CLI:
  - `The specified token is not valid. Use vercel login to generate a new token.`

Practical consequence:
- GitHub has the pushed slots fix commit
- production site can still show the old behavior until a valid Vercel deploy happens

## Open / residual items

1. The pushed commit currently contains the slots-route fixes only.
- later local cleanups for `schedule`/`notifications` limit handling were not yet deployed

2. If production still shows old behavior, first suspect deployment state before re-diagnosing parser logic.

3. Neurology answer semantics remain domain-specific:
- `Neuroloska ambulanta I/II` can correctly show `NEMA TERMINA`
- while grouped result items can still include EEG / dispanzer / neurohirurgija rows
- this is expected from current grouped-neurology product logic, not a parse failure
