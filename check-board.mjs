// token-radar-01: the entry's own gate check. Reads the output directory main.ts wrote and
// verifies every hard constraint the bounty's gate holds the board to, plus the dashboard's
// source budget and its no-URL rule. Run: node check-board.mjs <output-dir>
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2] ?? 'out';
const failures = [];
const notes = [];
function check(ok, message) {
  if (ok) notes.push('  ok    ' + message);
  else failures.push('  FAIL  ' + message);
}

let board;
try {
  board = JSON.parse(readFileSync(join(dir, 'board.json'), 'utf8'));
} catch (err) {
  console.error(`check-board: cannot read ${join(dir, 'board.json')}: ${err.message}`);
  process.exit(2);
}
const rows = board.rows ?? [];
const snapshot = JSON.parse(readFileSync(process.env.SNAPSHOT ?? '/home/lex/.openclaw/workspace/tmp/makefun/token-radar/input-snapshot.json', 'utf8'));

// 1. row count
check(rows.length >= 100 && rows.length <= 4000, `board holds ${rows.length} rows (gate: 100..4000)`);

// 2. watchlist coverage
const slugs = new Set(rows.map((r) => r.slug));
const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
check(missing.length === 0, `every watchlist slug is on the board (${snapshot.watchlist.length} covered, ${missing.length} missing)`);

// 3. ranks 1..N, once each
const ranks = rows.map((r) => r.rank).sort((a, b) => a - b);
const rankOk = ranks.every((v, i) => v === i + 1) && new Set(rows.map((r) => r.rank)).size === rows.length;
check(rankOk, `ranks are 1..${rows.length}, once each`);

// 4. implied value: positive whole, <= 100T, non-increasing by rank
let orderOk = true, capOk = true, wholeOk = true;
for (let i = 0; i < rows.length; i++) {
  const r = rows[i];
  if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) wholeOk = false;
  if (r.implied_value_usd > 100_000_000_000_000) capOk = false;
  if (i > 0 && rows[i - 1].implied_value_usd < r.implied_value_usd) orderOk = false;
}
check(wholeOk, 'every implied_value_usd is a positive whole number');
check(capOk, 'every implied_value_usd is at most $100T');
check(orderOk, 'implied_value_usd never rises as rank ascends');

// 5. farm steps: 3..12 strings, 20..600 chars trimmed
let stepsOk = true, stepsBad = '';
for (const r of rows) {
  if (!Array.isArray(r.farm_steps) || r.farm_steps.length < 3 || r.farm_steps.length > 12) { stepsOk = false; stepsBad = `${r.slug} has ${r.farm_steps?.length} steps`; break; }
  for (const s of r.farm_steps) {
    const t = String(s).trim();
    if (t.length < 20 || t.length > 600) { stepsOk = false; stepsBad = `${r.slug} has a step of ${t.length} chars`; break; }
  }
  if (!stepsOk) break;
}
check(stepsOk, `farm steps are 3..12 x 20..600 chars${stepsBad ? ' (' + stepsBad + ')' : ''}`);

// 6. every row carries the fields the dashboard needs
const fields = ['rank', 'slug', 'name', 'category', 'chains', 'tvl_usd', 'change_7d', 'mcap_usd', 'listed_at', 'gecko_id', 'symbol', 'token_status', 'age_days', 'implied_value_usd', 'implied_low_usd', 'implied_high_usd', 'watchlist', 'farm_steps', 'farm_cost_usd', 'farm_hours', 'farm_lockup_days', 'farm_verdict', 'farm_verdict_class', 'farm_value_per_hour', 'model'];
const fieldOk = rows.every((r) => fields.every((f) => f in r) && r.model && 'log_ratio' in r.model && 'implied_multiple' in r.model && Array.isArray(r.model.factors) && r.model.factors.length > 0);
check(fieldOk, 'every row carries the radar-7 BoardRow fields (incl. the value range, the farm verdict and the fitted factors)');

// 6b. the value range is honest: low <= base <= high, and the range is really a range
const rangeOk = rows.every((r) => r.implied_low_usd <= r.implied_value_usd && r.implied_value_usd <= r.implied_high_usd && r.implied_low_usd > 0);
check(rangeOk, 'every row carries a range with low <= base <= high');

// 6c. the farm verdict is present on every row and is computed, not blank
const verdictOk = rows.every((r) => typeof r.farm_verdict === 'string' && r.farm_verdict.length > 20 && ['worth', 'marginal', 'not-worth'].includes(r.farm_verdict_class) && r.farm_hours > 0 && r.farm_cost_usd > 0);
check(verdictOk, 'every row carries a costed farm verdict with hours and a cost');

// 7. dashboard source: no http/https anywhere in the source text, and under budget
const dashDir = join(dir, 'dashboard');
let dashBytes = 0, urlBad = '', fileCount = 0;
const textExts = /\.(?:html|css|js|json|mjs|svg|md|txt)$/;
function walk(d) {
  for (const name of readdirSync(d)) {
    const p = join(d, name);
    if (statSync(p).isDirectory()) { walk(p); continue; }
    fileCount++;
    const size = statSync(p).size;
    dashBytes += size;
    if (!textExts.test(name)) continue;
    const text = readFileSync(p, 'utf8');
    const at = text.search(/https?:\/\//i);
    if (at >= 0) urlBad = `${name} near "${text.slice(Math.max(0, at - 30), at + 40).replace(/\n/g, ' ')}"`;
  }
}
walk(dashDir);
check(urlBad === '', `dashboard source carries no http/https URL${urlBad ? ' — ' + urlBad : ''}`);
check(fileCount <= 400, `dashboard holds ${fileCount} files (gate: <= 400)`);
check(dashBytes <= 4_194_304, `dashboard files total ${dashBytes} bytes (gate: <= 4MiB)`);
check(dashBytes < 60_000, `dashboard source+files total ${dashBytes} bytes (budget: < 60KB)`);

// 8. data.js and dossier.json exist
try { readFileSync(join(dir, 'data.js'), 'utf8'); notes.push('  ok    data.js exists'); } catch { failures.push('  FAIL  data.js is missing'); }
try { const d = JSON.parse(readFileSync(join(dir, 'dossier.json'), 'utf8')); check(d.schema === 'makefun/dossier/v1' && Array.isArray(d.images) && d.images.length >= 3 && d.images.length <= 4, `dossier.json is makefun/dossier/v1 with ${Array.isArray(d.images) ? d.images.length : 0} images (gate: 3..4)`); } catch (err) { failures.push(`  FAIL  dossier.json: ${err.message}`); }

// 9. screenshots in the entry and the output: 3 or 4 whole PNGs within caps
const shotDirs = [join(dir, 'screenshots'), join(process.cwd(), 'screenshots')];
for (const sd of shotDirs) {
  let names = [];
  try { names = readdirSync(sd).filter((n) => !n.startsWith('.')); } catch { continue; }
  check(names.length >= 3 && names.length <= 4, `${sd} holds ${names.length} images (gate: 3..4)`);
  for (const name of names) {
    const buf = readFileSync(join(sd, name));
    const png = buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
    const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
    const long = Math.max(w, h), short = Math.min(w, h);
    check(png, `${name} is a whole PNG`);
    check(long <= 1440, `${name} long side ${long}px (cap 1440)`);
    check(short >= 800, `${name} short side ${short}px (floor 800)`);
    check(buf.length <= 512 * 1024, `${name} is ${Math.round(buf.length / 1024)}KiB (cap 512KiB)`);
  }
}

console.log(`check-board: ${rows.length} rows, ${snapshot.watchlist.length} watchlist, dashboard ${dashBytes} bytes / ${fileCount} files`);
console.log(notes.join('\n'));
if (failures.length > 0) {
  console.error(failures.join('\n'));
  console.error(`check-board: ${failures.length} failure(s)`);
  process.exit(1);
}
console.log('check-board: all checks passed');
