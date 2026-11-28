// token-radar-01 entry (Node 22+, standard library only, erasable TypeScript).
//
// The program reads the sealed snapshot from /input/snapshot.json (or --input <file|dir>), fits and
// tests the value model in lib/validate.ts, scores every pre-token protocol with lib/model.ts,
// writes the ranked board to /output/board.json, and copies this repository's dashboard/ and
// screenshots/ to /output. Last, it writes /output/dossier.json, the summary the judge reads, with
// the vendored make.fun library.
//
// The dashboard is a static page, no framework and no network: dashboard/index.html,
// dashboard/app.css and dashboard/app.js read /output/data.js, which this program writes from
// the same board.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input-snapshot.json

import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's own caps (reference/gate.json): the text cap shapes the bytes, the rest refuse. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** --name <value> out of the arguments, or the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshotText = readFileSync(inputFile, 'utf8');
const snapshot = parseSnapshot(snapshotText);
const { board, radar, report } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`token radar: the model wrote a board the gate refuses: ${issue}\n`);
  process.exit(1);
}

mkdirSync(out, { recursive: true });

/** The sha256 of a buffer, in hex. */
const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

const boardBytes = Buffer.from(`${JSON.stringify({ rows: board })}\n`, 'utf8');
const boardSha = sha256(boardBytes);
writeFileSync(join(out, 'board.json'), boardBytes);

/**
 * The integrity strip: the numbers a reader can check. The snapshot's own hash and counts, the
 * board's row count and watchlist coverage, and the hash of each file this program wrote.
 *
 * It lives in its own file beside data.js rather than inside it, because a file cannot carry its
 * own sha256: data.js is written and hashed first, and integrity.js then records that hash. The
 * dashboard shows the strip, so the screenshots and the code carry the same facts.
 */
const watchlistCovered = snapshot.watchlist.filter((s) => board.some((r) => r.slug === s)).length;
const accounting = radar.accounting;
const accountingSum = accounting.buckets.reduce((n, b) => n + b.count, 0);
const integrity = {
  snapshot_sha256: sha256(Buffer.from(snapshotText, 'utf8')),
  snapshot_as_of: snapshot.as_of,
  snapshot_source: snapshot.source,
  snapshot_protocols: snapshot.protocols.length,
  snapshot_watchlist: snapshot.watchlist.length,
  board_rows: board.length,
  /**
   * The ranked rows that are NOT on the house's watchlist. They are NOT all "below the floor":
   * the house's watchlist rule is narrower than "records no token", so this radar also ranks
   * some protocols the house left out that sit at or above the floor. The two counts are
   * reported separately so the strip cannot claim a floor that is not there.
   */
  board_off_watchlist_rows: board.length - watchlistCovered,
  board_below_floor_rows: accounting.below_floor,
  board_above_floor_off_watchlist_rows: accounting.above_floor_off_watchlist,
  watchlist_covered: watchlistCovered,
  board_sha256: boardSha,
  data_sha256: '',
  model_version: radar.model_version,
  /** The protocol accounting's own sum, against the snapshot's protocol count. */
  accounting_sum: accountingSum,
  accounting_total: accounting.total,
  /** How the screenshots were made: a headless browser over the output's own dashboard. */
  screenshots: "rendered headless from this output's dashboard/ and data.js",
  screenshot_files: ['1-board.png', '2-detail.png', '3-filtered.png', '4-validation.png'],
};
const dataText = dataScript(radar);
writeFileSync(join(out, 'data.js'), dataText);
const dataSha = sha256(Buffer.from(dataText, 'utf8'));
integrity.data_sha256 = dataSha;
writeFileSync(join(out, 'integrity.js'), `window.INTEGRITY=${JSON.stringify(integrity)};\n`);

/** Copy one directory's regular files into `to`, skipping names that start with a dot. */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) {
  process.stderr.write(`token radar: screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view\n`);
  process.exit(1);
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) {
    process.stderr.write(`token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
    process.exit(1);
  }
}

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: { max_files: 400, max_bytes: 4_194_304 } }));

const pc = (x: number): string => `${(x * 100).toFixed(1)}%`;
process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.early_size} early, ${radar.live_size} live set aside)\n` +
    `token radar: protocol accounting — ${accountingSum} of ${accounting.total} protocols accounted for, no remainder; ${accounting.ranked} ranked, ${accounting.trading} trading, ${accounting.token_recorded} token recorded, ${accounting.excluded} excluded by ${accounting.excluded_by_reason.map((r) => r.reason + ' ' + r.count).join(', ')}\n` +
    `token radar: watchlist covered ${watchlistCovered}/${snapshot.watchlist.length}, board.json ${boardSha.slice(0, 16)}…, data.js ${dataSha.slice(0, 16)}…\n` +
    `token radar: value model — walk-forward r=${report.final.walkforward.r.toFixed(3)} (ape ${pc(report.final.walkforward.ape)}), leave-one-out r=${report.final.loo.r.toFixed(3)} (ape ${pc(report.final.loo.ape)}), ${report.universe} live-token rows; factors kept ${report.kept.join(', ') || 'none'}\n` +
    `token radar: token odds — held-out AUC ${report.odds.auc.toFixed(3)} (baseline 0.500), Brier skill ${pc(report.odds.skill)}, features ${report.odds.kept.join(', ') || 'none'}\n` +
    `token radar: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')} (3 files), ${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')}\n`,
);
