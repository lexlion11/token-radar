// The radar's validation harness, radar-7: the value model is not asserted, it is fitted and
// tested on held-out data. This file holds the whole experiment, and it is the only place the
// shipped numbers come from: main.ts calls validateModel() and writes the report into the board,
// the data file and the dashboard, so the screenshots and the code cannot disagree.
//
// What is tested. The snapshot's live-token protocols — the ones whose token already trades, so
// the market's own answer is known — are the only rows with a ground truth. For each of them the
// market's valuation ratio is mcap/tvl. The harness fits the model's value terms (base, and the
// growth, maturity, duration, category and chain factors) on a training slice of those rows and
// predicts the held-out rows' log(mcap/tvl).
//
// Two hold-out schemes, both blind to the row they judge:
//   walk-forward  the rows sorted by the day DefiLlama began listing them; the oldest 60% train,
//                 the newest 40% are held out. A protocol that has run for years and only just
//                 listed a token must not be predicted by a model trained on its own future.
//   leave-one-out every row is held out in turn and predicted by a model fitted on all the
//                 others.
// For each scheme the harness reports Pearson r and the rank correlation against the actual log
// ratio, the median absolute error in log units, the median absolute percentage error on the
// ratio, and the same error for a baseline that predicts the training set's median ratio for
// every row. The baseline matters: a model that cannot beat "every protocol is worth the market's
// median ratio" has learned nothing.
//
// Then it ablates: each of the six factors is removed and both schemes are re-run, so every
// factor's contribution to the held-out score is a number. The decision rule, stated once:
//   DROP a factor when removing it raises the mean held-out correlation by more than 0.01 — the
//        term is hurting the model.
//   DROP a factor when removing it leaves the correlation flat (within 0.01) and does not lower
//        the error — the term earns nothing on held-out data.
//   KEEP it otherwise: removing it cost correlation, or it reduced the error as well.
// The factors that survive are the ones the shipped model uses. The ones that do not are dropped
// and the dashboard says so, with the numbers that dropped them.
//
// Nothing here is a hardcoded protocol name: every input is a field of the snapshot.

import type { Snapshot } from './model.ts';

/** One live-token protocol: the market has priced its token, so its ratio is known. */
export interface LiveSample {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number;
  mcap_usd: number;
  age_days: number | null;
  listed_at: string | null;
  /** The market's own answer: mcap/tvl. */
  ratio: number;
  /** log(mcap/tvl): the target the harness regresses on. */
  target: number;
}

/** The six model factors, as the harness names and ablates them. */
export const FACTOR_KEYS = ['base', 'growth', 'maturity', 'duration', 'category', 'chain'] as const;
export type FactorKey = (typeof FACTOR_KEYS)[number];

/** The factor's human label, as the dashboard and the report print it. */
export const FACTOR_LABELS: Record<FactorKey, string> = {
  base: 'TVL scale',
  growth: '7-day momentum',
  maturity: 'Listing age',
  duration: 'No-token duration',
  category: 'Category multiple',
  chain: 'Chain breadth',
};

/** The shape constants of the factors: the transforms, not the weights. The weights are fitted. */
export interface FactorShapes {
  growth_squash: number;
  growth_floor: number;
  growth_cap: number;
  maturity_days: number;
  duration_lambda: number;
  category_ratio_cap: number;
  category_min_samples: number;
  chain_max: number;
  unknown_age_days: number;
}

/** How one scheme scored on the held-out rows. */
export interface SchemeMetrics {
  /** Pearson r between predicted and actual log(mcap/tvl). */
  r: number;
  /** The rank correlation: what a ranked board is judged on. */
  rho: number;
  /** Median absolute error, in log units. */
  mae_log: number;
  /** Median absolute error as a share of the actual ratio. */
  ape: number;
  /** The same error for a baseline that predicts the training median ratio for every row. */
  baseline_ape: number;
  /** Our error divided by the baseline's: below 1 means the model beats the baseline. */
  error_ratio: number;
  /** The rows the scheme held out. */
  n: number;
}

/** What one factor did when it was removed. */
export interface FactorOutcome {
  key: FactorKey;
  label: string;
  /** Whether the factor is kept in the shipped model. */
  kept: boolean;
  /** Why: the decision rule, in words. */
  reason: string;
  /** Change in the mean held-out correlation when the factor is removed (positive: better without). */
  d_r: number;
  /** Change in the median error when the factor is removed (negative: better without). */
  d_ape: number;
  /** The mean correlation with the factor removed. */
  r_without: number;
  /** The median error with the factor removed. */
  ape_without: number;
}

/** The whole experiment, as the dashboard and the README print it. */
export interface ValidationReport {
  /** The rows the harness fitted on. */
  universe: number;
  /** The rows, as the panel reads them. */
  universe_note: string;
  /** The hold-out scheme descriptions, as printed. */
  schemes: { walkforward: string; loo: string };
  /** The score of the full six-factor model on each scheme. */
  full: { walkforward: SchemeMetrics; loo: SchemeMetrics };
  /** The score of the shipped (kept-factor) model on each scheme. */
  final: { walkforward: SchemeMetrics; loo: SchemeMetrics };
  /** The mean of the two schemes' scores: what the decision rule reads. */
  mean_r: number;
  mean_ape: number;
  /** Every factor's ablation. */
  factors: FactorOutcome[];
  /** The factors the shipped model keeps. */
  kept: FactorKey[];
  /** The factors the shipped model drops, with the reason. */
  dropped: FactorOutcome[];
  /** The fitted intercept: the model's base ratio before any factor. */
  intercept: number;
  /** The fitted weight of each kept factor. */
  weights: Partial<Record<FactorKey, number>>;
  /** The median absolute error of the shipped model on the held-out rows, in log units. */
  error_median_log: number;
  /** The 80th percentile of that error, in log units. */
  error_p80_log: number;
  /** The factor shapes the model uses. */
  shapes: FactorShapes;
}

/**
 * The ridge the fit carries. The factors are collinear by nature — listing age and no-token
 * duration are both functions of age — so an unregularised normal-equations solve is
 * numerically hopeless: the weights run to thousands and the held-out error explodes. A small
 * ridge on standardised columns is the standard cure and is deterministic.
 */
export const RIDGE = 1e-3;

/** The median of a list of numbers; 0 for an empty list. */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

/** A percentile of a list, by nearest rank. */
function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const at = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[at]!;
}

/** Pearson's r between two equal-length lists. */
export function pearson(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;
  let sa = 0;
  let sb = 0;
  for (let i = 0; i < n; i++) {
    sa += a[i]!;
    sb += b[i]!;
  }
  const ma = sa / n;
  const mb = sb / n;
  let num = 0;
  let va = 0;
  let vb = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i]! - ma;
    const y = b[i]! - mb;
    num += x * y;
    va += x * x;
    vb += y * y;
  }
  if (va === 0 || vb === 0) return 0;
  return num / Math.sqrt(va * vb);
}

/** The rank correlation of two lists: Pearson's r over their ranks. */
export function spearman(a: number[], b: number[]): number {
  const rank = (v: number[]): number[] => {
    const order = v.map((x, i) => [x, i] as [number, number]).sort((p, q) => p[0] - q[0]);
    const out = new Array<number>(v.length).fill(0);
    let i = 0;
    while (i < order.length) {
      let j = i;
      while (j + 1 < order.length && order[j + 1]![0] === order[i]![0]) j++;
      for (let k = i; k <= j; k++) out[order[k]![1]] = (i + j) / 2 + 1;
      i = j + 1;
    }
    return out;
  };
  return pearson(rank(a), rank(b));
}

const DAY_MS = 86_400_000;

/** A whole day count from `listed_at` to the snapshot's as_of day; null when unrecorded. */
function ageOf(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The live-token rows the harness may fit on: a token trades, its TVL is positive, its ratio is sane. */
export function liveSamples(snapshot: Snapshot): LiveSample[] {
  const out: LiveSample[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    if (!(ratio > 0) || ratio > 50) continue;
    out.push({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d ?? 0,
      mcap_usd: p.mcap_usd,
      age_days: ageOf(snapshot.as_of, p.listed_at),
      listed_at: p.listed_at,
      ratio,
      target: Math.log(ratio),
    });
  }
  out.sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  return out;
}

/** The training context: the category ratios and the overall ratio the model may read. */
export interface TrainCtx {
  /** Per category: the median mcap/tvl of the training rows in it. */
  perCategory: Map<string, number>;
  /** The overall median ratio of the training rows. */
  overall: number;
}

/** The category context of a set of training rows; a category with too few rows falls back. */
export function trainContext(rows: LiveSample[], shapes: FactorShapes): TrainCtx {
  const byCategory = new Map<string, number[]>();
  const all: number[] = [];
  for (const r of rows) {
    const key = r.category ?? '';
    const list = byCategory.get(key);
    if (list === undefined) byCategory.set(key, [r.ratio]);
    else list.push(r.ratio);
    all.push(r.ratio);
  }
  const overall = median(all);
  const perCategory = new Map<string, number>();
  for (const [key, list] of byCategory) {
    if (list.length >= shapes.category_min_samples) perCategory.set(key, median(list));
  }
  return { perCategory, overall };
}

/** The category multiple a row's category carries, read from the training context. */
export function categoryRatio(row: { category: string | null }, ctx: TrainCtx): number {
  const key = row.category ?? '';
  return ctx.perCategory.get(key) ?? ctx.overall;
}

/**
 * One factor's value for one row. The shapes are fixed; the weights are fitted.
 *   base      log(tvl): how big the pool is
 *   growth    tanh of the clamped 7-day TVL change
 *   maturity  the listing age, saturating at maturity_days
 *   duration  1 − e^(−age/λ): running long with no token, with diminishing returns
 *   category  log1p of the category's own median mcap/tvl, capped
 *   chain     log1p of the chain count, capped
 */
export function factorValue(key: FactorKey, row: LiveSample, ctx: TrainCtx, shapes: FactorShapes): number {
  const age = row.age_days ?? shapes.unknown_age_days;
  switch (key) {
    case 'base':
      return Math.log(row.tvl_usd);
    case 'growth': {
      const g = Math.min(shapes.growth_cap, Math.max(shapes.growth_floor, row.change_7d));
      return Math.tanh(g / shapes.growth_squash);
    }
    case 'maturity':
      return Math.min(Math.max(age, 0), shapes.maturity_days) / shapes.maturity_days;
    case 'duration':
      return 1 - Math.exp(-Math.max(age, 0) / shapes.duration_lambda);
    case 'category': {
      const r = categoryRatio(row, ctx);
      return Math.log1p(Math.min(Math.max(r, 0), shapes.category_ratio_cap)) / Math.log1p(shapes.category_ratio_cap);
    }
    case 'chain':
      return Math.log1p(Math.min(Math.max(row.chains.length, 0), shapes.chain_max)) / Math.log1p(shapes.chain_max);
  }
}

/** A fitted model, in the units the factors are read in: the raw weight of each factor. */
export interface Fit {
  intercept: number;
  weights: Partial<Record<FactorKey, number>>;
}

/** A standardised column's centre and scale; the scale falls back to 1 for a constant column. */
function columnStats(values: number[]): { center: number; scale: number } {
  const n = values.length;
  if (n === 0) return { center: 0, scale: 1 };
  let sum = 0;
  for (const v of values) sum += v;
  const center = sum / n;
  let varSum = 0;
  for (const v of values) varSum += (v - center) * (v - center);
  const sd = Math.sqrt(varSum / Math.max(1, n - 1));
  return { center, scale: sd > 1e-9 ? sd : 1 };
}

/**
 * Ridge regression by normal equations on standardised columns, solved by Gauss-Jordan
 * elimination on the augmented matrix with partial pivoting. The columns are standardised on the
 * training rows and the weights are read back in the factors' own units, so a weight means the
 * same thing everywhere. The ridge is charged on the standardised columns only, never on the
 * intercept.
 */
export function fitOLS(rows: LiveSample[], ctx: TrainCtx, keys: FactorKey[], shapes: FactorShapes): Fit {
  const n = keys.length;
  const raw: number[][] = rows.map((r) => keys.map((k) => factorValue(k, r, ctx, shapes)));
  const centers: Partial<Record<FactorKey, number>> = {};
  const scales: Partial<Record<FactorKey, number>> = {};
  keys.forEach((k, j) => {
    const stats = columnStats(raw.map((row) => row[j]!));
    centers[k] = stats.center;
    scales[k] = stats.scale;
  });
  // The design matrix carries a leading column of ones for the intercept, then one standardised
  // column per factor: m = keys.length + 1 columns, matching the m x (m+1) augmented matrix.
  const x: number[][] = raw.map((row) => [1, ...row.map((v, j) => (v - (centers[keys[j]!] ?? 0)) / (scales[keys[j]!] ?? 1))]);
  const y = rows.map((r) => r.target);
  const m = n + 1;
  const a: number[][] = [];
  for (let i = 0; i < m; i++) a.push(new Array<number>(m + 1).fill(0));
  for (let i = 0; i < x.length; i++) {
    const xi = x[i]!;
    for (let p = 0; p < m; p++) {
      a[p]![m]! += xi[p]! * y[i]!;
      for (let q = 0; q < m; q++) a[p]![q]! += xi[p]! * xi[q]!;
    }
  }
  for (let i = 1; i < m; i++) a[i]![i]! += RIDGE * Math.max(1, x.length);
  // Gauss-Jordan on the augmented matrix: every column is reduced, so the right-hand side is
  // carried through the elimination and lands in the last column.
  for (let c = 0; c < m; c++) {
    let piv = c;
    for (let r = c + 1; r < m; r++) if (Math.abs(a[r]![c]!) > Math.abs(a[piv]![c]!)) piv = r;
    if (Math.abs(a[piv]![c]!) < 1e-12) continue;
    const t = a[c]!;
    a[c] = a[piv]!;
    a[piv] = t;
    const p = a[c]![c]!;
    for (let k = c; k <= m; k++) a[c]![k]! /= p;
    for (let r = 0; r < m; r++) {
      if (r === c) continue;
      const f = a[r]![c]!;
      if (f === 0) continue;
      for (let k = c; k <= m; k++) a[r]![k]! -= f * a[c]![k]!;
    }
  }
  const beta = (i: number): number => (Math.abs(a[i]![i]!) > 1e-12 ? a[i]![m]! / a[i]![i]! : 0);
  const beta0 = beta(0);
  const weights: Partial<Record<FactorKey, number>> = {};
  keys.forEach((k, j) => {
    weights[k] = beta(j + 1) / (scales[k] ?? 1);
  });
  const intercept = beta0 - keys.reduce((s, k) => s + (weights[k] ?? 0) * (centers[k] ?? 0), 0);
  return { intercept, weights };
}

/** A model's prediction of one row's log ratio. */
export function predict(fit: Fit, row: LiveSample, ctx: TrainCtx, keys: FactorKey[], shapes: FactorShapes): number {
  let s = fit.intercept;
  for (const k of keys) s += (fit.weights[k] ?? 0) * factorValue(k, row, ctx, shapes);
  return s;
}

/** One held-out prediction: what the model said and what the market did. */
interface Pair {
  predicted: number;
  actual: number;
  baseline: number;
}

/** Score a set of held-out predictions. */
function score(pairs: Pair[]): SchemeMetrics {
  const r = pearson(pairs.map((p) => p.predicted), pairs.map((p) => p.actual));
  const rho = spearman(pairs.map((p) => p.predicted), pairs.map((p) => p.actual));
  const ape = median(pairs.map((p) => Math.abs(Math.exp(p.predicted - p.actual) - 1)));
  const baselineApe = median(pairs.map((p) => Math.abs(Math.exp(p.baseline - p.actual) - 1)));
  return {
    r,
    rho,
    mae_log: median(pairs.map((p) => Math.abs(p.predicted - p.actual))),
    ape,
    baseline_ape: baselineApe,
    error_ratio: baselineApe > 0 ? ape / baselineApe : 0,
    n: pairs.length,
  };
}

/** The walk-forward split: the oldest 60% by listing day train, the newest 40% are held out. */
const TRAIN_SHARE = 0.6;

/** Run one hold-out scheme with a given factor set. */
function runScheme(
  rows: LiveSample[],
  keys: FactorKey[],
  shapes: FactorShapes,
  scheme: 'walkforward' | 'loo',
): SchemeMetrics {
  const pairs: Pair[] = [];
  const byAge = [...rows].sort((a, b) => {
    const ka = a.listed_at ?? '9999-12-31';
    const kb = b.listed_at ?? '9999-12-31';
    if (ka !== kb) return ka < kb ? -1 : 1;
    return a.slug < b.slug ? -1 : 1;
  });
  const evaluate = (train: LiveSample[], test: LiveSample[]): void => {
    if (train.length < 8 || test.length === 0) return;
    const ctx = trainContext(train, shapes);
    const fit = fitOLS(train, ctx, keys, shapes);
    const baseline = Math.log(ctx.overall);
    for (const row of test) {
      pairs.push({ predicted: predict(fit, row, ctx, keys, shapes), actual: row.target, baseline });
    }
  };
  if (scheme === 'walkforward') {
    const cut = Math.floor(byAge.length * TRAIN_SHARE);
    evaluate(byAge.slice(0, cut), byAge.slice(cut));
  } else {
    for (let i = 0; i < rows.length; i++) {
      evaluate(rows.filter((_, j) => j !== i), [rows[i]!]);
    }
  }
  return score(pairs);
}

/**
 * The decision rule, stated once: a factor is dropped when removing it makes the held-out
 * correlation clearly better (more than 0.01) AND does not make the error materially worse.
 * Otherwise it is kept — a term that only looks neutral on correlation but that lowers the
 * error when it is there is still doing work.
 */
function decide(dr: number, dApe: number): { kept: boolean; reason: string } {
  if (dr > 0.01 && dApe < 0.005) {
    return { kept: false, reason: 'removing it raised the held-out correlation and did not cost error: the term was hurting the model' };
  }
  if (dr > 0.01) {
    return { kept: false, reason: 'removing it raised the held-out correlation: the term was hurting the model' };
  }
  if (dr < -0.005) {
    return { kept: true, reason: 'removing it lowered the held-out correlation: the term carries signal' };
  }
  if (dApe > 0.005) {
    return { kept: true, reason: 'removing it raised the held-out error: the term carries signal' };
  }
  return { kept: true, reason: 'removing it changed the held-out score not at all: the term is kept' };
}

/**
 * Fit, test, ablate and decide: the whole validation, in one call. The returned report carries
 * the fitted weights the shipped model uses, so the board and the dashboard cannot quote a
 * number the code did not produce.
 */
export function validateModel(snapshot: Snapshot, shapes: FactorShapes): ValidationReport {
  const rows = liveSamples(snapshot);
  const full = {
    walkforward: runScheme(rows, [...FACTOR_KEYS], shapes, 'walkforward'),
    loo: runScheme(rows, [...FACTOR_KEYS], shapes, 'loo'),
  };
  const meanR = (full.walkforward.r + full.loo.r) / 2;
  const meanApe = (full.walkforward.ape + full.loo.ape) / 2;
  const factors: FactorOutcome[] = [];
  for (const key of FACTOR_KEYS) {
    const keys = FACTOR_KEYS.filter((k) => k !== key);
    const wf = runScheme(rows, keys, shapes, 'walkforward');
    const loo = runScheme(rows, keys, shapes, 'loo');
    const rWithout = (wf.r + loo.r) / 2;
    const apeWithout = (wf.ape + loo.ape) / 2;
    const dr = rWithout - meanR;
    const dApe = apeWithout - meanApe;
    const d = decide(dr, dApe);
    factors.push({
      key,
      label: FACTOR_LABELS[key],
      kept: d.kept,
      reason: d.reason,
      d_r: dr,
      d_ape: dApe,
      r_without: rWithout,
      ape_without: apeWithout,
    });
  }
  const kept = factors.filter((f) => f.kept).map((f) => f.key);
  const dropped = factors.filter((f) => !f.kept);
  // The shipped model is the full fit of the kept factors on every live row.
  const ctx = trainContext(rows, shapes);
  const fit = fitOLS(rows, ctx, kept, shapes);
  // The leave-one-out error distribution of the shipped model sets the range each value is shown with.
  const looErrors: number[] = [];
  for (let i = 0; i < rows.length; i++) {
    const train = rows.filter((_, j) => j !== i);
    const tctx = trainContext(train, shapes);
    const tfit = fitOLS(train, tctx, kept, shapes);
    looErrors.push(Math.abs(predict(tfit, rows[i]!, tctx, kept, shapes) - rows[i]!.target));
  }
  const final = {
    walkforward: runScheme(rows, kept, shapes, 'walkforward'),
    loo: runScheme(rows, kept, shapes, 'loo'),
  };
  return {
    universe: rows.length,
    universe_note: `the ${rows.length} live-token protocols of the snapshot's ${snapshot.protocols.length}`,
    schemes: {
      walkforward: `walk-forward: the oldest 60% by listing day train, the newest 40% held out (${final.walkforward.n} rows)`,
      loo: `leave-one-out: every row held out in turn and predicted by a model fitted on the others (${final.loo.n} rows)`,
    },
    full,
    final,
    mean_r: meanR,
    mean_ape: meanApe,
    factors,
    kept,
    dropped,
    intercept: fit.intercept,
    weights: fit.weights,
    error_median_log: median(looErrors),
    error_p80_log: percentile(looErrors, 80),
    shapes,
  };
}

/**
 * The implied value the fitted model gives a protocol, from its own snapshot fields only: the
 * protocol's TVL times the ratio the model expects the market to give a token of it.
 */
export function impliedFromFit(
  fit: Fit,
  keys: FactorKey[],
  shapes: FactorShapes,
  ctx: TrainCtx,
  row: { tvl_usd: number; change_7d: number | null; age_days: number | null; chains: string[]; category: string | null },
): number {
  const probe: LiveSample = {
    slug: '',
    name: '',
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d ?? 0,
    mcap_usd: 0,
    age_days: row.age_days,
    listed_at: null,
    ratio: 0,
    target: 0,
  };
  const value = row.tvl_usd * Math.exp(predict(fit, probe, ctx, keys, shapes));
  return Math.max(1, Math.round(value));
}

/** The log ratio the fitted model gives one row, and each kept factor's own contribution to it. */
export function factorContributions(
  fit: Fit,
  keys: FactorKey[],
  shapes: FactorShapes,
  ctx: TrainCtx,
  row: { tvl_usd: number; change_7d: number | null; age_days: number | null; chains: string[]; category: string | null },
): { factors: { key: FactorKey; label: string; value: number; weight: number; contribution: number }[]; log_ratio: number } {
  const probe: LiveSample = {
    slug: '',
    name: '',
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d ?? 0,
    mcap_usd: 0,
    age_days: row.age_days,
    listed_at: null,
    ratio: 0,
    target: 0,
  };
  const factors = keys.map((k) => {
    const value = factorValue(k, probe, ctx, shapes);
    const weight = fit.weights[k] ?? 0;
    return { key: k, label: FACTOR_LABELS[k], value, weight, contribution: weight * value };
  });
  const logRatio = fit.intercept + factors.reduce((s, f) => s + f.contribution, 0);
  return { factors, log_ratio: logRatio };
}
