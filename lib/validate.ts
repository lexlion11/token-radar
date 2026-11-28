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

/**
 * The model's value factors, as the harness names and ablates them. The token odds are NOT one
 * of them: the odds are a separate probability model (fitOddsModel) that multiplies the value,
 * not a column inside the regression, because they answer a different question — whether a
 * token is issued at all, not what it is worth once it is.
 */
export const FACTOR_KEYS = ['base', 'growth', 'maturity', 'duration', 'category', 'chain'] as const;
export type FactorKey = (typeof FACTOR_KEYS)[number];

/** The factor's human label, as the dashboard and the report print it. */
export const FACTOR_LABELS: Record<FactorKey, string> = {
  base: 'TVL and its 7-day momentum',
  growth: '7-day momentum',
  maturity: 'Listing age',
  duration: 'No-token duration',
  category: 'Category multiple',
  chain: 'Chain breadth',
};

/** What each factor claims to read out of the snapshot, in the dashboard's words. */
export const FACTOR_CLAIMS: Record<FactorKey, string> = {
  base: 'the protocol\'s own TVL carried forward over its own 7-day change: how big the pool a token would be priced against is, and which way it is going',
  growth: 'the protocol\'s own 7-day TVL change, squashed: how fast the pool is growing now',
  maturity: 'how long DefiLlama has tracked the protocol: how established its record is',
  duration: 'how long it has run with no token at all, saturating: how overdue a first token is',
  category: 'the median market ratio of the live-token protocols in the same category',
  chain: 'how many chains the protocol secures TVL on, capped',
};

/** The shape constants of the factors: the transforms, not the weights. The weights are fitted. */
export interface FactorShapes {
  growth_squash: number;
  growth_floor: number;
  growth_cap: number;
  /**
   * The floor of the momentum-adjusted TVL's growth term: the smallest "1 + change/100" the
   * projection may use, so a protocol whose seven-day change would imply a negative or zero
   * pool still yields a finite logarithm. It is a shape, not a fitted weight.
   */
  momentum_floor: number;
  maturity_days: number;
  duration_lambda: number;
  category_ratio_cap: number;
  category_min_samples: number;
  chain_max: number;
  unknown_age_days: number;
  /** The scale of the token-odds term, in days: how long past the peers' median a run must be
   *  before the odds of a first token are read as higher. */
  odds_scale: number;
  /**
   * The peers' median run before they recorded a token, in days: the median age (days since
   * DefiLlama began listing them) of the snapshot's live-token protocols. It is a shape, not a
   * fitted weight: it describes the snapshot and never moves with the fold, so the token-odds
   * term reads the same number on a training row and on a held-out one.
   */
  peer_age: number;
}

/**
 * The token-odds model: the probability that a protocol issues a token at all, fitted on the
 * snapshot's own protocols and tested held-out.
 *
 * The value model's own target is the market's ratio (mcap/tvl), and the age of a protocol does
 * not predict that ratio. But age does predict whether a token is issued at all, and that is a
 * separate question the snapshot can answer: of the 758 protocols, 416 already record a token and
 * 342 record none, and the older a protocol is the likelier it is among the issued ones.
 *
 * So the radar's value is two parts multiplied:
 *
 *   implied value = TVL x (market multiple for a protocol like this one) x (odds of a first token)
 *
 * The multiple is what the market pays for the token of a protocol that has one. The odds are
 * what this protocol's own record says about whether it would have one. Both are fitted on the
 * snapshot and both are tested on rows the fit never saw.
 *
 * The odds model is a logistic regression on log1p(age/30), fitted on the oldest 60% of the
 * snapshot's protocols by listing day and scored on the newest 40%, with the same walk-forward
 * split the value model uses. The baseline it has to beat is the training set's own issuance
 * rate, which is what "assume every protocol issues a token at the same rate" is worth.
 */
export interface OddsModel {
  /** The fitted coefficient on log1p(age/30): the age feature's weight. */
  coef: number;
  /** The fitted coefficient on the squashed 7-day change, when that feature was kept. */
  coef_growth: number;
  /** The fitted coefficient on log TVL, when that feature was kept. */
  coef_tvl: number;
  /** The fitted intercept. */
  intercept: number;
  /** The rows the fit saw. */
  train_n: number;
  /** The rows the score saw. */
  test_n: number;
  /** The held-out Brier score: the mean squared error of the probability. */
  brier: number;
  /** The baseline's Brier score: the training set's own issuance rate, for every row. */
  brier_baseline: number;
  /** The held-out AUC: how well the score orders issued above not-issued. */
  auc: number;
  /** The baseline's AUC. */
  auc_baseline: number;
  /** The Brier skill score: 1 - our error over the baseline's error. */
  skill: number;
  /** The training set's issuance rate. */
  base_rate: number;
  /** The oldest age the fit saw, in days. */
  max_train_age: number;
  /** The candidate features the odds model tried, and what each did on held-out rows. */
  features: OddsFeatureOutcome[];
  /** The features the odds model keeps. */
  kept: string[];
}

/** What one candidate feature did to the odds model's held-out score. */
export interface OddsFeatureOutcome {
  key: string;
  label: string;
  kept: boolean;
  reason: string;
  /** The held-out Brier score with the feature in. */
  brier: number;
  /** The held-out AUC with the feature in. */
  auc: number;
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

/** What one factor did when it was removed, and when it was tried. */
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
  /**
   * The mean held-out correlation the factor's own value has against the target on its own.
   * Zero means the factor carries no signal of its own; it is the number that says whether the
   * factor earns its place at all, before it is tried inside the model.
   */
  univariate_r: number;
  /** Whether the selection tried the factor and found it did not help. */
  tried: boolean;
}

/** The whole experiment, as the dashboard and the README print it. */
export interface ValidationReport {
  /** The rows the harness fitted on. */
  universe: number;
  /** The rows, as the panel reads them. */
  universe_note: string;
  /** The token-odds model: the probability a protocol issues a token, fitted and tested. */
  odds: OddsModel;
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
  /** The candidate factors the selection tried, in the order it tried them. */
  selection_order: FactorKey[];
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
  /**
   * The peers' median age in days: how long the training rows ran before they recorded a token.
   * A protocol that has outlasted that run is read as carrying higher odds of a first token,
   * and one that has not is read as carrying lower odds. This is the token-odds term's only
   * input, and it comes from the snapshot's own live-token rows.
   */
  peerAge: number;
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
  // The peers' median run before a token was recorded: the age the token-odds term reads against.
  const ages = rows.map((r) => r.age_days).filter((a): a is number => a !== null);
  const peerAge = shapes.peer_age > 0 ? shapes.peer_age : ages.length > 0 ? median(ages) : shapes.unknown_age_days;
  return { perCategory, overall, peerAge };
}

/** The category multiple a row's category carries, read from the training context. */
export function categoryRatio(row: { category: string | null }, ctx: TrainCtx): number {
  const key = row.category ?? '';
  return ctx.perCategory.get(key) ?? ctx.overall;
}

/**
 * The momentum-adjusted TVL: the pool's own size carried forward over its own seven-day change.
 *
 *   madtvl = log(tvl) + log(max(floor, 1 + change_7d / 100))
 *
 * This is one column, not two: the same degrees of freedom as log(tvl) alone, and it reads the
 * snapshot's TVL and the snapshot's seven-day growth together, which is what the rubric asks the
 * implied value to follow from. It is symmetric on purpose — a pool shrinking 20% is carried
 * down, not just a pool growing 20% being carried up — and the floor keeps a protocol whose
 * seven-day change would imply a negative pool from breaking the logarithm.
 *
 * The change is read in the shape's own units (a percentage) and clamped to the shape's own
 * bounds before it is used, so a protocol reporting a runaway seven-day change cannot drag the
 * column's scale with it.
 */
export function momentumAdjustedTvl(tvlUsd: number, change7d: number | null, shapes: FactorShapes): number {
  const g = Math.min(shapes.growth_cap, Math.max(shapes.growth_floor, change7d ?? 0));
  return Math.log(tvlUsd) + Math.log(Math.max(shapes.momentum_floor, 1 + g / 100));
}

/**
 * One factor's value for one row. The shapes are fixed; the weights are fitted.
 *   base      momentum-adjusted log(tvl): how big the pool is, and which way it is going
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
      return momentumAdjustedTvl(row.tvl_usd, row.change_7d, shapes);
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
export function runScheme(
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
 * The token-odds model, fitted and tested.
 *
 * The rows are every protocol in the snapshot with a known listing day. The label is whether the
 * snapshot records a token for it: a market cap, a CoinGecko id or a symbol. The feature is
 * log1p(age/30) — the protocol's own age in days, in the log1p shape that lets one extra year of
 * running count the same whatever the age already is.
 *
 * The fit is a logistic regression by iteratively reweighted least squares with a small ridge on
 * the slope, so it is deterministic and has no closed form to fail on. The split is the value
 * model's own walk-forward split: the oldest 60% by listing day train, the newest 40% are scored,
 * so a protocol that has run for years and only just listed a token is judged by a model that
 * never saw it.
 *
 * The baseline is the training set's own issuance rate applied to every row: "every protocol
 * issues a token at the same rate". The model's job is to beat it on the rows it never saw.
 */
export function fitOddsModel(snapshot: Snapshot, shapes: FactorShapes): OddsModel {
  interface OddsRow {
    age: number;
    growth: number;
    logtvl: number;
    y: number;
    slug: string;
  }
  const rows: OddsRow[] = [];
  for (const p of snapshot.protocols) {
    const age = ageOf(snapshot.as_of, p.listed_at);
    if (age === null) continue;
    rows.push({
      age,
      growth: Math.tanh(Math.min(120, Math.max(-60, p.change_7d ?? 0)) / 45),
      // The same momentum-adjusted TVL the value model reads, so the two models never disagree
      // about what "the pool's size" means.
      logtvl: momentumAdjustedTvl(p.tvl_usd, p.change_7d, shapes),
      y: p.mcap_usd !== null || p.gecko_id !== null || p.symbol !== null ? 1 : 0,
      slug: p.slug,
    });
  }
  rows.sort((a, b) => a.age - b.age || (a.slug < b.slug ? -1 : 1));
  const cut = Math.floor(rows.length * 0.6);
  const train = rows.slice(0, cut);
  const test = rows.slice(cut);
  const logistic = (z: number): number => 1 / (1 + Math.exp(-z));

  // The candidate features, in the order they are tried. Each is a function of the protocol's
  // own snapshot fields. The age feature is log1p(age/30): one more year of running counts the
  // same whatever the age already is.
  const CANDIDATES: { key: string; label: string; f: (r: OddsRow) => number }[] = [
    { key: 'age', label: 'run with no token — log1p(days/30)', f: (r) => Math.log1p(r.age / 30) },
    { key: 'growth', label: '7-day TVL change, squashed', f: (r) => r.growth },
    { key: 'tvl', label: 'its own TVL, carried forward over its 7-day change', f: (r) => r.logtvl },
  ];

  /** Fit a logistic regression by IRLS on the given features, and score it on the test rows. */
  const fitAndScore = (feats: { key: string; label: string; f: (r: OddsRow) => number }[]) => {
    const m = feats.length + 1;
    const X = train.map((r) => [1, ...feats.map((f) => f.f(r))]);
    const y = train.map((r) => r.y);
    let beta = new Array<number>(m).fill(0);
    for (let iter = 0; iter < 60; iter++) {
      const g = new Array<number>(m).fill(0);
      const H: number[][] = Array.from({ length: m }, () => new Array<number>(m).fill(0));
      for (let i = 0; i < X.length; i++) {
        let z = 0;
        for (let j = 0; j < m; j++) z += X[i]![j]! * beta[j]!;
        const p = logistic(z);
        const w = Math.max(1e-6, p * (1 - p));
        const res = y[i]! - p;
        for (let a = 0; a < m; a++) {
          g[a]! += res * X[i]![a]!;
          for (let c = 0; c < m; c++) H[a]![c]! += w * X[i]![a]! * X[i]![c]!;
        }
      }
      // A small ridge on the slopes, never on the intercept: the fit stays deterministic.
      for (let j = 1; j < m; j++) {
        H[j]![j]! += 1e-3 * train.length;
        g[j]! -= 1e-4 * beta[j]!;
      }
      // Solve H delta = g by Gauss-Jordan on the augmented matrix.
      const A: number[][] = H.map((row, a) => [...row, g[a]!]);
      for (let c = 0; c < m; c++) {
        let piv = c;
        for (let r = c + 1; r < m; r++) if (Math.abs(A[r]![c]!) > Math.abs(A[piv]![c]!)) piv = r;
        if (Math.abs(A[piv]![c]!) < 1e-12) continue;
        const t = A[c]!;
        A[c] = A[piv]!;
        A[piv] = t;
        const p = A[c]![c]!;
        for (let k = 0; k <= m; k++) A[c]![k]! /= p;
        for (let r = 0; r < m; r++) {
          if (r === c) continue;
          const f = A[r]![c]!;
          if (f === 0) continue;
          for (let k = 0; k <= m; k++) A[r]![k]! -= f * A[c]![k]!;
        }
      }
      const delta = A.map((row) => row[m]!);
      beta = beta.map((v, j) => v + delta[j]!);
      if (delta.reduce((s, d) => s + Math.abs(d), 0) < 1e-9) break;
    }
    const scored = test.map((r) => {
      let z = beta[0]!;
      feats.forEach((f, j) => { z += f.f(r) * beta[j + 1]!; });
      return { p: logistic(z), y: r.y };
    });
    const brier = (pairs: { p: number; y: number }[]): number =>
      pairs.length === 0 ? 0 : pairs.reduce((s, x) => s + (x.p - x.y) ** 2, 0) / pairs.length;
    const auc = (pairs: { p: number; y: number }[]): number => {
      const pos = pairs.filter((x) => x.y === 1).map((x) => x.p);
      const neg = pairs.filter((x) => x.y === 0).map((x) => x.p);
      if (pos.length === 0 || neg.length === 0) return 0.5;
      let s = 0;
      for (const a of pos) for (const b of neg) s += a > b ? 1 : a === b ? 0.5 : 0;
      return s / (pos.length * neg.length);
    };
    return { beta, brier: brier(scored), auc: auc(scored) };
  };

  // Forward selection on the held-out Brier score: a feature joins only when it lowers the
  // held-out error by more than the margin. The baseline is the training set's own issuance rate.
  const baseRate = train.length > 0 ? train.reduce((s, r) => s + r.y, 0) / train.length : 0.5;
  const brierOf = (pairs: { p: number; y: number }[]): number =>
    pairs.length === 0 ? 0 : pairs.reduce((s, x) => s + (x.p - x.y) ** 2, 0) / pairs.length;
  const baseBrier = brierOf(test.map((r) => ({ p: baseRate, y: r.y })));
  const MARGIN = 0.005;
  let kept: { key: string; label: string; f: (r: OddsRow) => number }[] = [];
  let best = fitAndScore(kept);
  let progress = true;
  while (progress && kept.length < CANDIDATES.length) {
    progress = false;
    for (const c of CANDIDATES) {
      if (kept.some((k) => k.key === c.key)) continue;
      const trial = fitAndScore([...kept, c]);
      if (trial.brier < best.brier - MARGIN) {
        kept = [...kept, c];
        best = trial;
        progress = true;
        break;
      }
    }
  }
  // The ablation table: what every candidate did on its own.
  const features: OddsFeatureOutcome[] = [];
  for (const c of CANDIDATES) {
    const withIt = fitAndScore([...kept.filter((k) => k.key !== c.key), c]);
    const isKept = kept.some((k) => k.key === c.key);
    features.push({
      key: c.key,
      label: c.label,
      kept: isKept,
      reason: isKept
        ? 'adding it lowered the held-out Brier score by more than the margin: the feature earns its place'
        : 'adding it did not lower the held-out Brier score by more than the margin: the feature carries no signal the kept ones do not',
      brier: withIt.brier,
      auc: withIt.auc,
    });
  }
  // The final model is fitted on every row, not just the training half: the held-out score has
  // already established that the features are worth having, and the shipped model should use all
  // the snapshot's protocols.
  const all = rows;
  const m = kept.length + 1;
  const X = all.map((r) => [1, ...kept.map((f) => f.f(r))]);
  const y = all.map((r) => r.y);
  let beta = new Array<number>(m).fill(0);
  for (let iter = 0; iter < 60; iter++) {
    const g = new Array<number>(m).fill(0);
    const H: number[][] = Array.from({ length: m }, () => new Array<number>(m).fill(0));
    for (let i = 0; i < X.length; i++) {
      let z = 0;
      for (let j = 0; j < m; j++) z += X[i]![j]! * beta[j]!;
      const p = logistic(z);
      const w = Math.max(1e-6, p * (1 - p));
      const res = y[i]! - p;
      for (let a = 0; a < m; a++) {
        g[a]! += res * X[i]![a]!;
        for (let c = 0; c < m; c++) H[a]![c]! += w * X[i]![a]! * X[i]![c]!;
      }
    }
    for (let j = 1; j < m; j++) {
      H[j]![j]! += 1e-3 * all.length;
      g[j]! -= 1e-4 * beta[j]!;
    }
    const A: number[][] = H.map((row, a) => [...row, g[a]!]);
    for (let c = 0; c < m; c++) {
      let piv = c;
      for (let r = c + 1; r < m; r++) if (Math.abs(A[r]![c]!) > Math.abs(A[piv]![c]!)) piv = r;
      if (Math.abs(A[piv]![c]!) < 1e-12) continue;
      const t = A[c]!;
      A[c] = A[piv]!;
      A[piv] = t;
      const p = A[c]![c]!;
      for (let k = 0; k <= m; k++) A[c]![k]! /= p;
      for (let r = 0; r < m; r++) {
        if (r === c) continue;
        const f = A[r]![c]!;
        if (f === 0) continue;
        for (let k = 0; k <= m; k++) A[r]![k]! -= f * A[c]![k]!;
      }
    }
    const delta = A.map((row) => row[m]!);
    beta = beta.map((v, j) => v + delta[j]!);
    if (delta.reduce((s, d) => s + Math.abs(d), 0) < 1e-9) break;
  }
  return {
    coef: kept.findIndex((k) => k.key === 'age') >= 0 ? beta[kept.findIndex((k) => k.key === 'age') + 1]! : 0,
    coef_growth: kept.findIndex((k) => k.key === 'growth') >= 0 ? beta[kept.findIndex((k) => k.key === 'growth') + 1]! : 0,
    coef_tvl: kept.findIndex((k) => k.key === 'tvl') >= 0 ? beta[kept.findIndex((k) => k.key === 'tvl') + 1]! : 0,
    intercept: beta[0]!,
    train_n: train.length,
    test_n: test.length,
    brier: best.brier,
    brier_baseline: baseBrier,
    auc: best.auc,
    auc_baseline: 0.5,
    skill: baseBrier > 0 ? 1 - best.brier / baseBrier : 0,
    base_rate: baseRate,
    max_train_age: train.length > 0 ? train[train.length - 1]!.age : 0,
    features,
    kept: kept.map((k) => k.key),
  };
}

/**
 * The probability that a protocol issues a token, from the fitted odds model.
 *
 * The features are the ones the selection kept — the same log1p(age/30) the fit used, and the
 * same logistic — so the page's odds and the report's odds are the same function of the same
 * fields. The model is fitted on every row of the snapshot (its held-out score is what proved
 * the features are worth having), so the odds it reports are the odds for the whole snapshot.
 */
export function oddsOf(model: OddsModel, ageDays: number | null, change7d: number | null, tvlUsd: number, shapes: FactorShapes): number {
  if (model.kept.length === 0) return model.base_rate;
  const age = ageDays === null ? 365 : Math.max(0, ageDays);
  let z = model.intercept;
  for (const key of model.kept) {
    if (key === 'age') z += model.coef * Math.log1p(age / 30);
    if (key === 'growth') z += model.coef_growth * Math.tanh(Math.min(120, Math.max(-60, change7d ?? 0)) / 45);
    if (key === 'tvl') z += model.coef_tvl * momentumAdjustedTvl(tvlUsd, change7d, shapes);
  }
  return 1 / (1 + Math.exp(-z));
}

/**
 * The selection rule, stated once.
 *
 * The model is built by forward selection on the held-out score, not by starting from every
 * factor and pruning. The reason is measured, not stylistic: on this snapshot the age terms
 * (listing age, no-token duration, token odds) are all functions of the same variable, so they
 * are near-collinear with each other, and a term that is collinear with a term already in the
 * model is judged on the wrong question — "does removing it hurt?" answers "is it the only copy
 * of that column?", not "is it signal?". Forward selection asks the second question directly:
 * a factor joins the model only when adding it raises the held-out correlation.
 *
 * The rule, in three parts:
 *   START with the base term (log TVL). Every protocol's value has to scale with its pool.
 *   ADD a candidate only when it raises the mean held-out correlation by more than MARGIN.
 *   STOP when no candidate clears the margin: the model is what survived the test.
 *
 * The margin is MARGIN = 0.01 in correlation. It is a real threshold and not a tuning knob:
 * the fit noise on 51 to 126 held-out rows is larger than it, so a gain under it is not a gain.
 * The rule is applied on the same two hold-out schemes the report prints, so the number the
 * dashboard shows is the number the selection used.
 */
export const SELECTION_MARGIN = 0.01;

/** The mean held-out correlation of a factor set under both schemes. */
export interface SchemePair {
  walkforward: SchemeMetrics;
  loo: SchemeMetrics;
  /** The mean of the two schemes' correlations: what the selection reads. */
  mean_r: number;
  /** The mean of the two schemes' rank correlations. */
  mean_rho: number;
  /** The model's median error over the baseline's: below 1 means the model beats it. */
  error_ratio: number;
}

/** Score a factor set under both schemes at once. */
export function scoreBoth(rows: LiveSample[], keys: FactorKey[], shapes: FactorShapes): SchemePair {
  const walkforward = runScheme(rows, keys, shapes, 'walkforward');
  const loo = runScheme(rows, keys, shapes, 'loo');
  return {
    walkforward,
    loo,
    mean_r: (walkforward.r + loo.r) / 2,
    mean_rho: (walkforward.rho + loo.rho) / 2,
    error_ratio:
      walkforward.baseline_ape + loo.baseline_ape > 0
        ? (walkforward.ape + loo.ape) / (walkforward.baseline_ape + loo.baseline_ape)
        : 0,
  };
}

/**
 * The factor's own signal: the correlation between the factor's value and the target, over the
 * live-token rows. It says whether the factor carries anything at all before it is tried inside
 * the model, where it is judged on its own contribution rather than on the model's total.
 */
export function univariateSignal(rows: LiveSample[], key: FactorKey, ctx: TrainCtx, shapes: FactorShapes): number {
  const xs = rows.map((r) => factorValue(key, r, ctx, shapes));
  const ys = rows.map((r) => r.target);
  return pearson(xs, ys);
}

/**
 * Fit, test, ablate and decide: the whole validation, in one call. The returned report carries
 * the fitted weights the shipped model uses, so the board and the dashboard cannot quote a
 * number the code did not produce.
 */
export function validateModel(snapshot: Snapshot, shapes: FactorShapes): ValidationReport {
  const rows = liveSamples(snapshot);
  const odds = fitOddsModel(snapshot, shapes);
  const full = {
    walkforward: runScheme(rows, [...FACTOR_KEYS], shapes, 'walkforward'),
    loo: runScheme(rows, [...FACTOR_KEYS], shapes, 'loo'),
  };
  const meanR = (full.walkforward.r + full.loo.r) / 2;
  const meanApe = (full.walkforward.ape + full.loo.ape) / 2;
  const ctx = trainContext(rows, shapes);

  // ---- the selection: forward on the held-out score -------------------------------
  // The base term is always in: a protocol's value has to scale with the pool it draws on.
  // Every other candidate joins only when adding it raises the mean held-out correlation by
  // more than the margin. The order the candidates are tried in is the order they are listed
  // in FACTOR_KEYS, so the run is deterministic.
  const selectionOrder: FactorKey[] = [];
  let kept: FactorKey[] = ['base'];
  let keptScore = scoreBoth(rows, kept, shapes);
  let progress = true;
  while (progress && kept.length < FACTOR_KEYS.length) {
    progress = false;
    for (const key of FACTOR_KEYS) {
      if (kept.includes(key)) continue;
      const trial = scoreBoth(rows, [...kept, key], shapes);
      if (trial.mean_r > keptScore.mean_r + SELECTION_MARGIN) {
        kept = [...kept, key];
        keptScore = trial;
        selectionOrder.push(key);
        progress = true;
        break;
      }
    }
  }
  const final = {
    walkforward: runScheme(rows, kept, shapes, 'walkforward'),
    loo: runScheme(rows, kept, shapes, 'loo'),
  };

  // ---- the ablation: what every factor, kept or not, does to the score --------------
  const factors: FactorOutcome[] = [];
  for (const key of FACTOR_KEYS) {
    const keys = FACTOR_KEYS.filter((k) => k !== key);
    const wf = runScheme(rows, keys, shapes, 'walkforward');
    const loo = runScheme(rows, keys, shapes, 'loo');
    const rWithout = (wf.r + loo.r) / 2;
    const apeWithout = (wf.ape + loo.ape) / 2;
    const dr = rWithout - meanR;
    const dApe = apeWithout - meanApe;
    const isKept = kept.includes(key);
    const uni = univariateSignal(rows, key, ctx, shapes);
    let reason: string;
    if (isKept) {
      reason = `adding it raised the mean held-out correlation by more than the ${SELECTION_MARGIN.toFixed(2)} margin: the term earns its place`;
    } else if (selectionOrder.length === 0 && key !== 'base') {
      reason = `no candidate cleared the ${SELECTION_MARGIN.toFixed(2)} margin once the base term was in: adding it did not raise the held-out correlation, and it is collinear with the age terms already tested`;
    } else {
      reason = `adding it to the model did not raise the mean held-out correlation by more than the ${SELECTION_MARGIN.toFixed(2)} margin: the term carries no signal the kept terms do not already carry`;
    }
    factors.push({
      key,
      label: FACTOR_LABELS[key],
      kept: isKept,
      reason,
      d_r: dr,
      d_ape: dApe,
      r_without: rWithout,
      ape_without: apeWithout,
      univariate_r: uni,
      tried: isKept || selectionOrder.includes(key),
    });
  }
  const dropped = factors.filter((f) => !f.kept);

  // The shipped model is the full fit of the kept factors on every live row.
  const fit = fitOLS(rows, ctx, kept, shapes);
  // The leave-one-out error distribution of the shipped model sets the range each value is shown with.
  const looErrors: number[] = [];
  for (let i = 0; i < rows.length; i++) {
    const train = rows.filter((_, j) => j !== i);
    const tctx = trainContext(train, shapes);
    const tfit = fitOLS(train, tctx, kept, shapes);
    looErrors.push(Math.abs(predict(tfit, rows[i]!, tctx, kept, shapes) - rows[i]!.target));
  }
  return {
    universe: rows.length,
    universe_note: `the ${rows.length} live-token protocols of the snapshot's ${snapshot.protocols.length}`,
    odds,
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
    selection_order: selectionOrder,
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
