// Verification of out/board.json against the gate rules and the snapshot.
import { readFileSync } from 'node:fs';

const snap = JSON.parse(readFileSync('/home/lex/.openclaw/workspace/tmp/makefun/token-radar/input-snapshot.json', 'utf8'));
const OUT = process.argv[2] || '/home/lex/.openclaw/workspace/tmp/makefun/token-radar/entry/out';
const board = JSON.parse(readFileSync(OUT + '/board.json', 'utf8'));
const rows = board.rows ?? board;
const problems = [];
const ok = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ' — ' + extra}`);
  if (!cond) problems.push(name);
};

ok('row count 100..4000', rows.length >= 100 && rows.length <= 4000, `got ${rows.length}`);
const protoSlugs = new Set(snap.protocols.map((p) => p.slug));
const seen = new Set();
for (const r of rows) {
  if (!protoSlugs.has(r.slug)) { problems.push(`invented slug ${r.slug}`); }
  if (seen.has(r.slug)) { problems.push(`duplicate slug ${r.slug}`); }
  seen.add(r.slug);
  if (typeof r.name !== 'string' || r.name.length === 0) { problems.push(`${r.slug} bad name`); }
  if (!Number.isSafeInteger(r.rank) || r.rank <= 0) { problems.push(`${r.slug} bad rank ${r.rank}`); }
  if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100e12) { problems.push(`${r.slug} bad implied ${r.implied_value_usd}`); }
  if (!Array.isArray(r.farm_steps) || r.farm_steps.length < 3 || r.farm_steps.length > 12) { problems.push(`${r.slug} farm count ${r.farm_steps?.length}`); }
  for (const s of r.farm_steps ?? []) {
    const t = String(s).trim();
    if (t.length < 20 || t.length > 600) { problems.push(`${r.slug} step len ${t.length}`); break; }
  }
}
ok('all slugs are snapshot protocols, unique, fields valid (see problems list)', problems.length === 0, problems.slice(0, 5).join('; '));
const ranks = rows.map((r) => r.rank).sort((a, b) => a - b);
ok('ranks are exactly 1..N once each', ranks.every((v, i) => v === i + 1), `e.g. ${ranks.slice(0, 5)}`);
let mono = true;
for (let i = 1; i < rows.length; i++) if (rows[i].implied_value_usd > rows[i - 1].implied_value_usd) { mono = false; break; }
ok('implied values non-increasing by rank order', mono);
const wl = new Set(snap.watchlist);
const missing = snap.watchlist.filter((s) => !seen.has(s));
ok(`watchlist fully covered (${snap.watchlist.length})`, missing.length === 0, missing.join(', '));
const early = rows.filter((r) => !wl.has(r.slug)).length;
ok('at least 60 rows outside the watchlist', early >= 60, `got ${early}`);
const same = rows.length >= 2 && rows.every((r) => r.implied_value_usd === rows[0].implied_value_usd);
ok('not all rows share one implied value', !same);
console.log(`\nTop 5: ${rows.slice(0, 5).map((r) => `#${r.rank} ${r.slug} ${r.implied_value_usd}`).join(' | ')}`);
console.log(`Bottom: #${rows[rows.length - 1].rank} ${rows[rows.length - 1].slug} ${rows[rows.length - 1].implied_value_usd}`);
console.log(problems.length === 0 ? '\nALL CHECKS PASS' : `\n${problems.length} PROBLEMS`);
process.exit(problems.length === 0 ? 0 : 1);
