// The token radar's model, version radar-6: one snapshot of the protocol universe in, one ranked
// board out. Every figure the model uses comes from the snapshot itself — TVL, 7-day TVL change,
// days since DefiLlama began listing the protocol, the category's own live-token mcap/tvl ratios,
// and the number of chains the protocol secures TVL on. No protocol name is ever special-cased.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and adds
// every other protocol the snapshot carries that the market has not priced at all: a protocol
// with no token, no gecko id and no symbol on record, standing on its own rather than as a
// wrapped, staked or bridged product of a token that trades. A deployment whose token symbol is
// already on record is not on this board: the symbol says the token exists, so the market has
// priced it or will, and ranking it against protocols that have never had a token would mix two
// different questions. Live-token protocols with a market cap are kept apart too: the dashboard
// shows the market's own values for them, never a model's guess, and they never enter the
// ranking. What the board ranks is the universe where a first token could still be launched.
//
//   base       = tvl_usd x BASE_MULTIPLE
//   g          = clamp(change_7d, GROWTH_FLOOR, GROWTH_CAP) per cent
//   growth     = 1 + GROWTH_WEIGHT x tanh(g / GROWTH_SQUASH)      (smoothed momentum)
//   maturity   = MATURITY_FLOOR + min(age, MATURITY_DAYS)/MATURITY_DAYS x MATURITY_RANGE
//   duration   = 1 + DURATION_WEIGHT x (1 - exp(-age / DURATION_LAMBDA))  (no-token duration,
//                 diminishing returns: running a year with no token matters, running a decade
//                 adds little more)
//   category   = 1 + CATEGORY_WEIGHT x log1p(min(catMedian, CAT_CAP)) / log1p(CAT_CAP)
//                where catMedian is the median mcap/tvl ratio of the live-token protocols in
//                this protocol's category (the overall median when the category has too few)
//   chain      = 1 + CHAIN_WEIGHT x log1p(min(chains, CHAIN_MAX)) / log1p(CHAIN_MAX)
//   implied    = max(1, round(base x growth x maturity x duration x category x chain))
//
// Every constant is named below and stated in the dashboard's model panel.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  base_multiple: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  growth_squash: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  duration_weight: number;
  duration_lambda: number;
  category_weight: number;
  category_ratio_cap: number;
  category_min_samples: number;
  chain_weight: number;
  chain_max: number;
  unknown_age_days: number;
}

export const MODEL: ModelConstants = {
  base_multiple: 0.25,
  growth_weight: 0.55,
  growth_floor: -60,
  growth_cap: 120,
  growth_squash: 45,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  duration_weight: 0.35,
  duration_lambda: 400,
  category_weight: 0.6,
  category_ratio_cap: 4,
  category_min_samples: 3,
  chain_weight: 0.3,
  chain_max: 8,
  unknown_age_days: 365,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-6';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** One farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  watchlist: boolean;
  farm_capital_usd: number;
  farm_hold_days: number;
  model: {
    base_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    duration_multiplier: number;
    category_multiplier: number;
    chain_multiplier: number;
    category_median_ratio: number;
    age_days: number | null;
  };
  farm_steps: string[];
  farm_summary: string;
}

/** The dashboard's compact view of one row. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  watchlist: boolean;
  token_status: 'pre-token';
  symbol: string | null;
  farm_capital_usd: number;
  farm_hold_days: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  duration_multiplier: number;
  category_multiplier: number;
  chain_multiplier: number;
  category_median_ratio: number;
  farm_steps: string[];
  farm_summary: string;
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Categories whose protocols are wrapped, staked or bridged products of tokens that already trade. */
const PRODUCT_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Cross Chain Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'Anchor BTC',
  'Decentralized BTC',
  'CEX',
]);

/** A name carrying one of these whole words names a product of a token that trades, not a protocol of its own. */
const PRODUCT_WORD = /\b(wrapped|staked|staking)\b/i;

/** Exchanges whose name at the start of a protocol's name marks a product of that exchange. */
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/**
 * The watchlist's own product test, restated from the snapshot's fields alone: a pre-token
 * protocol is standalone when its category is not a wrapped/staked/bridged product category,
 * its name carries no version marker and no whole word wrapped, staked or staking, and it does
 * not begin with an exchange's name. The board admits protocols at or above the watchlist floor
 * only when they pass: a high-TVL wrapped product records no token, but it is not a token
 * launch to farm. Below the floor the radar stays open — a small bridge with no token is
 * exactly the kind of early row the radar exists to find.
 */
export function isStandalone(p: SnapshotProtocol): boolean {
  if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (PRODUCT_WORD.test(p.name)) return false;
  for (const e of EXCHANGE_PREFIXES) if (p.name.startsWith(e)) return false;
  return true;
}

/** The median of a sorted-ish list of numbers. */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

/**
 * The market's own valuation habit, per category: the median mcap/tvl ratio of the live-token
 * protocols in each category. A pre-token protocol in a category whose tokens trade at a high
 * ratio to TVL gets a lift, because the market has shown it pays that multiple in that category.
 * Categories with fewer than CATEGORY_MIN_SAMPLES live ratios fall back to the overall median,
 * as does a protocol with no category at all.
 */
export function categoryMedians(snapshot: Snapshot): { perCategory: Map<string, number>; overall: number } {
  const byCategory = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    if (!(ratio > 0) || ratio > 50) continue;
    all.push(ratio);
    const key = p.category ?? '';
    const list = byCategory.get(key);
    if (list === undefined) byCategory.set(key, [ratio]);
    else list.push(ratio);
  }
  const overall = median(all);
  const perCategory = new Map<string, number>();
  for (const [key, list] of byCategory) {
    if (list.length >= MODEL.category_min_samples) perCategory.set(key, median(list));
  }
  return { perCategory, overall };
}

/** The six factors and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
  medians: { perCategory: Map<string, number>; overall: number },
): {
  implied: number;
  growthPct: number;
  growthMult: number;
  maturityMult: number;
  durationMult: number;
  catMult: number;
  chainMult: number;
  catMedian: number;
  age: number | null;
} {
  const age = ageDays(asOf, protocol.listed_at);
  const ageForModel = age ?? model.unknown_age_days;
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  // Smoothed momentum: tanh squashes the clamped change so one wild week cannot dominate.
  const growthMult = 1 + model.growth_weight * Math.tanh(growthPct / model.growth_squash);
  const maturityMult =
    model.maturity_floor +
    (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  // No-token duration, first class, with diminishing returns.
  const durationMult = 1 + model.duration_weight * (1 - Math.exp(-Math.max(ageForModel, 0) / model.duration_lambda));
  // Category-relative valuation from the market's own mcap/tvl habit.
  const catMedian = protocol.category === null ? medians.overall : medians.perCategory.get(protocol.category) ?? medians.overall;
  const catScore = Math.log1p(Math.min(Math.max(catMedian, 0), model.category_ratio_cap)) / Math.log1p(model.category_ratio_cap);
  const catMult = 1 + model.category_weight * catScore;
  // Chain breadth: securing TVL on more chains is a deployment-maturity signal.
  const chainCount = Math.min(Math.max(protocol.chains.length, 0), model.chain_max);
  const chainScore = Math.log1p(chainCount) / Math.log1p(model.chain_max);
  const chainMult = 1 + model.chain_weight * chainScore;
  const base = protocol.tvl_usd * model.base_multiple;
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult * durationMult * catMult * chainMult));
  return { implied, growthPct, growthMult, maturityMult, durationMult, catMult, chainMult, catMedian, age };
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const isWatch = new Set(snapshot.watchlist);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every other protocol the snapshot carries that no token has ever been
  // issued for — no market cap, no CoinGecko id, no symbol on record — and that stands on its
  // own rather than as a wrapped, staked or bridged product of a token that trades. Below the
  // watchlist's floor the radar stays open: a small protocol with no token is exactly the kind
  // of early row the radar exists to find.
  for (const p of snapshot.protocols) {
    if (chosen.has(p.slug)) continue;
    if (!isPreToken(p) || p.category === 'CEX' || !isStandalone(p)) continue;
    chosen.set(p.slug, p);
  }

  const medians = categoryMedians(snapshot);
  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, model, medians);
    return { p, ...v };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => {
    const steps = farmSteps(s.p, s.age, snapshot.as_of);
    return {
      rank: i + 1,
      slug: s.p.slug,
      name: s.p.name,
      category: s.p.category,
      chains: s.p.chains,
      tvl_usd: s.p.tvl_usd,
      change_7d: s.p.change_7d,
      mcap_usd: s.p.mcap_usd,
      listed_at: s.p.listed_at,
      gecko_id: s.p.gecko_id,
      symbol: s.p.symbol,
      token_status: 'pre-token',
      age_days: s.age,
      implied_value_usd: s.implied,
      watchlist: isWatch.has(s.p.slug),
      farm_capital_usd: capitalFor(s.p),
      farm_hold_days: holdDaysFor(s.age),
      model: {
        base_multiple: model.base_multiple,
        growth_pct: round4(s.growthPct),
        growth_multiplier: round4(s.growthMult),
        maturity_multiplier: round4(s.maturityMult),
        duration_multiplier: round4(s.durationMult),
        category_multiplier: round4(s.catMult),
        chain_multiplier: round4(s.chainMult),
        category_median_ratio: round4(s.catMedian),
        age_days: s.age,
      },
      farm_steps: steps.map(stepText),
      farm_summary: farmSummary(steps, s.p, s.age),
    };
  });
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Keep the position open and recheck each week.`;
  return s;
}

/**
 * The chain a farmer would actually use: the protocol's own first chain that carries smart
 * contracts. A protocol whose TVL sits on Bitcoin, Ripple or Stellar has no EVM contract to
 * call, so naming those chains in a farm plan would ask for an action the chain cannot do;
 * where the protocol does run on an EVM chain, that one is named. Falls back to the first chain
 * the protocol names when it runs on none of them.
 */
const NON_EVM_CHAINS = new Set([
  'Bitcoin', 'Bitcoincash', 'BSV Blockchain', 'Cardano', 'Litecoin', 'Doge', 'Dash', 'Decred',
  'Ripple', 'Stellar', 'Algorand', 'Near', 'Aptos', 'Sui', 'TON', 'Tron', 'Flare', 'Kava',
  'Cronos', 'EOS', 'Zilliqa', 'Filecoin', 'Radix', 'Kaspa', 'Flow', 'Hedera', 'ICP', 'Terra',
  'Terra2', 'Fetch Hub', 'Mina', 'MultiversX', 'Velas', 'Waves', 'Zcash', 'IOTA', 'Neo3',
]);

/** The protocol's first smart-contract chain, or its first chain when it runs on none. */
function chainOf(p: SnapshotProtocol): string {
  if (p.chains.length === 0) return 'its main chain';
  for (const c of p.chains) if (!NON_EVM_CHAINS.has(c)) return c;
  return p.chains[0]!;
}

/** The second chain a protocol names, for the cross-chain activity step, or the first one again. */
function secondChainOf(p: SnapshotProtocol): string {
  if (p.chains.length > 1) {
    for (const c of p.chains) {
      if (c === chainOf(p)) continue;
      if (!NON_EVM_CHAINS.has(c)) return c;
    }
  }
  return chainOf(p);
}

/**
 * A chain's typical gas cost for one farm transaction, in whole dollars: Ethereum mainnet is
 * dear, the rollups and Solana are cheap, everything else sits between. Chain names are the
 * snapshot's own; no protocol is special-cased.
 */
function gasOf(chain: string): number {
  if (chain === 'Ethereum') return 15;
  if (chain === 'Solana' || chain === 'BNB Chain' || chain === 'BSC') return 1;
  const cheap = ['Arbitrum', 'Optimism', 'Base', 'Polygon', 'Mantle', 'Linea', 'Scroll', 'zkSync', 'Avalanche', 'Blast', 'Mode', 'Berachain', 'Hyperliquid'];
  for (const c of cheap) if (chain === c) return 2;
  return 4;
}

/** What the protocol's chains cost a farmer in gas: a non-EVM chain pays no EVM gas at all. */
function gasNote(chain: string): string {
  if (NON_EVM_CHAINS.has(chain)) return 'its own chain fees, usually under a dollar';
  return 'about $' + gasOf(chain) + ' of gas';
}

/** How much capital one farm position needs, from the protocol's own TVL: six tiers, so a
 *  $20B protocol's plan names a different position size than a $2M one's. */
function capitalFor(p: SnapshotProtocol): number {
  const t = p.tvl_usd;
  if (t >= 20_000_000_000) return 500;
  if (t >= 5_000_000_000) return 250;
  if (t >= 1_000_000_000) return 150;
  if (t >= 250_000_000) return 100;
  if (t >= 50_000_000) return 75;
  if (t >= 10_000_000) return 50;
  return 25;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 90) return 75;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's one action, in the words a farmer can follow, with capital, chain and gas named. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string, gas: number): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  const borrow = Math.round(capital * 0.2);
  const fee = gasNote(chain);
  if (c.includes('yield') || c.includes('index'))
    return `Deposit $${capital} of USDC into a ${name} vault or index position on ${chain} and hold the receipt through the whole window (${fee}); if the vault takes a deposit token rather than USDC, swap into it first on the same chain.`;
  if (c.includes('aggregator'))
    return `Deposit $${capital} of USDC into a ${name} vault on ${chain} and hold the vault shares without withdrawing (${fee}).`;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral') || c.includes('uncollateralized'))
    return `Supply $${capital} of USDC to ${name} on ${chain} and borrow $${borrow} of it back against the position (keep the loan under 25% of supply so a 30% drawdown cannot liquidate it), so the wallet shows both supply and borrow activity in the same week (${fee}).`;
  if (c.includes('dex') || c.includes('leveraged farm') || c.includes('farm') || c.includes('liquidity'))
    return `Provide $${capital} of liquidity to ${name}'s deepest trading pool on ${chain} and leave the LP tokens held, unstaked, in the wallet (${fee}); if the pool is concentrated, place the range around the current price with 20% headroom each side.`;
  if (c.includes('bridge') || c.includes('cross chain'))
    return `Bridge $${capital} of USDC to ${chain} through ${name} and leave the bridged funds in its app for the hold period (${fee} each way).`;
  if (c.includes('staking') || c.includes('restak'))
    return `Stake $${capital} of the chain's staking asset through ${name} on ${chain} and hold the receipt token without unstaking (${fee}).`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('basis') || c.includes('options') || c.includes('interest rate'))
    return `Deposit $${capital} of USDC as margin on ${name} on ${chain} and open one small hedged position worth $${Math.round(capital * 0.5)} notional, then keep the margin parked (${fee}).`;
  if (c.includes('prediction'))
    return `Fund $${capital} of USDC on ${name} on ${chain} and place one position a week at minimum size, letting each settle onchain (${fee} a week).`;
  if (c.includes('curator') || c.includes('allocator'))
    return `Deposit $${capital} into a ${name} vault on ${chain} and hold the vault shares without withdrawing (${fee}).`;
  if (c.includes('stable'))
    return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold it in the protocol's own contract (${fee}).`;
  if (c.includes('rwa') || c.includes('reserve'))
    return `Mint $${capital} of the protocol's tokenized asset on ${name} on ${chain} and hold the token for the whole period (${fee}).`;
  if (c.includes('insurance'))
    return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active until it expires (${fee}).`;
  if (c.includes('launchpad') || c.includes('governance'))
    return `Lock $${capital} in ${name}'s participation contract on ${chain} and keep it locked, voting on every proposal that opens (${fee}).`;
  if (c.includes('payments') || c.includes('card'))
    return `Spend or route $${capital} of stablecoin through ${name} on ${chain} across four or five sessions of $${Math.round(capital / 5)} each, so the wallet reads as a real user (${fee}).`;
  if (c.includes('otc') || c.includes('exchange') || c.includes('marketplace'))
    return `Fill $${capital} of volume on ${name} on ${chain} across six small orders of about $${Math.round(capital / 6)} each rather than one (${fee}).`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open without withdrawing (${fee}).`;
}

/** A protocol's farm plan: eight or nine steps, each an action with a cost and a time. The plan
 * is derived from the protocol's own record (category, chains, TVL, age), never from a
 * hand-written list of names: the same generator writes every protocol's plan. The TVL tier sets
 * the position size, the age sets the hold, the category sets the action, and protocols securing
 * TVL on three or more chains carry an extra cross-chain activity step.
 * Unpriced deployments — a token symbol already on record — get a step noting that the token may
 * already circulate, so the plan is honest about what is being farmed. */
export function farmSteps(p: SnapshotProtocol, age: number | null, asOf?: string): FarmStep[] {
  const chain = chainOf(p);
  const second = secondChainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = gasOf(chain);
  const action = actionFor(p, capital, chain, gas);
  const young = age !== null && age < 180;
  const weeks = Math.max(2, Math.round(hold / 7));
  const weeklyGas = Math.max(1, Math.round(gas / 4));
  const steps = [
    {
      text: `Open a fresh wallet that holds only the funds for this farm and keep its seed phrase offline, never in a browser extension or a cloud note.`,
      cost: '$0',
      time: '5 minutes',
    },
    {
      text: NON_EVM_CHAINS.has(chain)
        ? `Fund the wallet with $${capital} of USDC and move it to ${chain} in one transfer, since ${chain} has no EVM gas to budget for.`
        : `Fund the wallet with $${capital} of USDC plus about $${gas * 2} for gas on ${chain}, moving the capital in one transaction to keep fees down.`,
      cost: NON_EVM_CHAINS.has(chain) ? `$${capital} of capital, its own chain fees` : `$${capital} of capital, about $${gas * 2} of gas`,
      time: '10 minutes',
    },
    {
      text: action,
      cost: `part of the $${capital}, ${gasNote(chain)}`,
      time: '15 to 20 minutes',
    },
    {
      text: `Make one qualifying action every week — a deposit, a borrow, a swap or a vote — so the protocol counts wallet activity across more than one weekly snapshot; over a ${hold}-day hold that is about ${weeks} actions.`,
      cost: `about $${weeklyGas} of gas a week, $${weeklyGas * weeks} in all`,
      time: `10 minutes a week, ${weeks} weeks`,
    },
  ];
  if (p.chains.length >= 3 && second !== chain) {
    steps.push({
      text: `Repeat the main deposit on ${second} through ${p.name}: the protocol secures TVL on ${p.chains.length} chains, and activity on a second one reads as a cross-chain user rather than a single-chain farmer.`,
      cost: `${gasNote(second)} on ${second}`,
      time: '15 minutes',
    });
  }
  steps.push(
    {
      text: `Hold the position for at least ${hold} days without withdrawing${young ? ` — the protocol is only ${age} days old, so early activity is the likeliest to count` : ', spanning more than one month of the protocol\'s own tracking'}, and keep every position open until the hold window closes.`,
      cost: `the $${capital} stays deployed`,
      time: `${hold} days`,
    },
    {
      text: `Check the protocol's own points or rewards page weekly and claim only through the link it publishes; never sign a claim from a chat, a search result or an unsolicited DM.`,
      cost: 'no fee to check, never pay to claim',
      time: '5 minutes a week',
    },
    {
      text: `Write the wallet address, the open date, the amounts and every transaction hash in a farm log so the position can be audited, repeated or unwound.`,
      cost: '$0',
      time: '5 minutes',
    },
  );
  return steps;
}

/** One line that sums a plan: the capital it needs, the gas it costs, the days it spans, and how many steps it is. */
function farmSummary(steps: FarmStep[], p: SnapshotProtocol, age: number | null): string {
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = gasOf(chainOf(p));
  const weeks = Math.max(2, Math.round(hold / 7));
  const totalGas = gas * 2 + gas + Math.max(1, Math.round(gas / 4)) * weeks + (p.chains.length >= 3 ? gasOf(secondChainOf(p)) : 0);
  return `$${capital} of capital · ~$${totalGas} of gas · ${steps.length} steps · ${hold}-day hold`;
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    watchlist: row.watchlist,
    token_status: row.token_status,
    symbol: row.symbol,
    farm_capital_usd: row.farm_capital_usd,
    farm_hold_days: row.farm_hold_days,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    duration_multiplier: row.model.duration_multiplier,
    category_multiplier: row.model.category_multiplier,
    chain_multiplier: row.model.chain_multiplier,
    category_median_ratio: row.model.category_median_ratio,
    farm_steps: row.farm_steps,
    farm_summary: row.farm_summary,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !r.watchlist).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
    if (r.implied_value_usd > 100_000_000_000_000) return `${r.slug} has implied value over $100T`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
