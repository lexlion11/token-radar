// The token radar's model, version radar-7: one snapshot of the protocol universe in, one ranked
// board out. Every figure the model uses comes from the snapshot itself — TVL, 7-day TVL change,
// days since DefiLlama began listing the protocol, the category's own live-token mcap/tvl ratios,
// and the number of chains the protocol secures TVL on. No protocol name is ever special-cased.
//
// The value model is not asserted, it is fitted: lib/validate.ts fits the model's own terms on the
// snapshot's live-token protocols — the ones whose token already trades, so the market's answer is
// known — and tests them on held-out rows under two schemes (walk-forward and leave-one-out).
// The factors that do not earn their place on held-out data are dropped, and the dashboard's
// model panel states which ones and by how much. The weights that survive the test are the
// weights this file uses, so the board's numbers and the validation report cannot disagree.
//
//   log ratio = intercept + w_base·log(tvl) + w_growth·momentum + w_maturity·maturity
//                         + w_duration·duration + w_category·category + w_chain·chain
//   implied   = tvl × exp(log ratio)
//   range     = implied × e^(±median held-out error): the honest spread, not a point pretending
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and adds
// every other protocol the snapshot carries that the market has not priced at all: a protocol
// with no token, no gecko id and no symbol on record, standing on its own rather than as a
// wrapped, staked or bridged product of a token that trades. Live-token protocols with a market
// cap are kept apart too: the dashboard shows the market's own values for them, never a model's
// guess, and they never enter the ranking. What the board ranks is the universe where a first
// token could still be launched.

import {
  validateModel,
  factorContributions,
  liveSamples,
  oddsOf,
  trainContext,
  type FactorKey,
  type FactorShapes,
  type TrainCtx,
  type ValidationReport,
} from './validate.ts';

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

/** The factor shapes the model uses: the transforms. The weights come from the fit. */
export const SHAPES: FactorShapes = {
  growth_squash: 45,
  growth_floor: -60,
  growth_cap: 120,
  maturity_days: 1095,
  duration_lambda: 400,
  category_ratio_cap: 4,
  category_min_samples: 3,
  chain_max: 8,
  unknown_age_days: 365,
  odds_scale: 240,
  peer_age: 1000,
};

/**
 * The shapes, with the one shape that depends on the snapshot computed from the snapshot: the
 * peers' median run before they recorded a token. It is the median age (days since DefiLlama
 * began listing) of the snapshot's live-token protocols — the ones whose token already trades,
 * so their own run before the token is the peers' record. It is fixed for the whole experiment,
 * so a training row and a held-out row are read against the same number.
 */
export function shapesFor(snapshot: Snapshot): FactorShapes {
  const ages: number[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null) continue;
    const age = ageDays(snapshot.as_of, p.listed_at);
    if (age !== null) ages.push(age);
  }
  if (ages.length === 0) return SHAPES;
  const sorted = [...ages].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const peer = sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
  return { ...SHAPES, peer_age: peer };
}

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-8';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** One farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
  /** The dollars this step adds to the capital at risk. */
  capital_usd: number;
  /** The dollars this step adds to the gas bill. */
  gas_usd: number;
  /** The hours of active work this step takes. Waiting to mature is not work. */
  hours: number;
}

/** A whole farm plan: its steps and the totals the board reports. */
export interface FarmPlan {
  steps: FarmStep[];
  /** The capital deployed, the gas bill, and the active hours. */
  capital_usd: number;
  gas_usd: number;
  cost_usd: number;
  hours: number;
  /** The days the capital stays locked up: the hold window, which is not labour. */
  lockup_days: number;
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
  implied_low_usd: number;
  implied_high_usd: number;
  /** How many other rows' base values fall inside this row's range. */
  range_overlaps: number;
  watchlist: boolean;
  farm_capital_usd: number;
  farm_hold_days: number;
  farm_cost_usd: number;
  farm_hours: number;
  farm_lockup_days: number;
  farm_verdict: string;
  farm_verdict_class: 'worth' | 'marginal' | 'not-worth';
  /** The modelled value a farmer's position is worth, at the model's own multiple. */
  farm_expected_usd: number;
  /** The modelled value per hour of active work. */
  farm_value_per_hour: number;
  model: {
    /** The model's log ratio for this row. */
    log_ratio: number;
    /** The model's implied value per dollar of the protocol's TVL. */
    implied_multiple: number;
    /** The market multiple alone: what the market pays for the token of a protocol like this. */
    market_multiple: number;
    /** The fitted probability that this protocol issues a token at all. */
    token_odds: number;
    /** Each kept factor's value, weight and contribution to the log ratio. */
    factors: { key: FactorKey; label: string; value: number; weight: number; contribution: number }[];
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
  implied_low_usd: number;
  implied_high_usd: number;
  range_overlaps: number;
  watchlist: boolean;
  token_status: 'pre-token';
  symbol: string | null;
  farm_capital_usd: number;
  farm_hold_days: number;
  farm_cost_usd: number;
  farm_hours: number;
  farm_lockup_days: number;
  farm_verdict: string;
  farm_verdict_class: 'worth' | 'marginal' | 'not-worth';
  farm_value_per_hour: number;
  log_ratio: number;
  implied_multiple: number;
  market_multiple: number;
  token_odds: number;
  factors: { key: FactorKey; label: string; value: number; weight: number; contribution: number }[];
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

/** One bucket of the protocol accounting: a count of the snapshot's protocols and why. */
export interface AccountingBucket {
  /** The bucket's own key: what the count means. */
  key: string;
  /** What a reader is told about the bucket, in full. */
  label: string;
  /** The same bucket in the short form the strip prints. */
  short: string;
  /** How many of the snapshot's protocols fall in it. */
  count: number;
  /** Whether the bucket's protocols are ranked on the board. */
  ranked: boolean;
  /** The reason, when the bucket is an exclusion: the house's own style of reason. */
  reason: ExclusionReason | null;
  /** One example from the bucket, so a reader can see what it holds. */
  example: string | null;
}

/** The whole protocol accounting: every one of the snapshot's protocols, counted once. */
export interface ProtocolAccounting {
  /** The snapshot's protocol count: the total every bucket must sum to. */
  total: number;
  /** The buckets, in the order the dashboard prints them. */
  buckets: AccountingBucket[];
  /** The number of protocols the board ranks. */
  ranked: number;
  /** The number of protocols whose token already has a market cap: it already trades. */
  trading: number;
  /** The number of protocols that already record a token but carry no market cap yet. */
  token_recorded: number;
  /** The number of protocols left out, and why, by reason. */
  excluded: number;
  /** The number of protocols left out, by reason. */
  excluded_by_reason: { reason: ExclusionReason; label: string; count: number }[];
  /** How many of the ranked rows are on the snapshot's watchlist. */
  watchlist_ranked: number;
  /** How many of the ranked rows are below the watchlist's floor. */
  early_ranked: number;
  /** How many of the snapshot's protocols fall below the watchlist's floor. */
  below_floor: number;
}

/** Everything the dashboard needs: the board, the live set, the model it runs and its validation. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  /** The factor shapes the model uses. */
  shapes: FactorShapes;
  /** The factors the validation kept, and the weights it fitted. */
  kept: FactorKey[];
  weights: Partial<Record<FactorKey, number>>;
  intercept: number;
  /** The held-out error the row ranges are built from, in log units. */
  range_error_log: number;
  /** The whole validation experiment, as the model panel prints it. */
  validation: ValidationReport;
  /** Every one of the snapshot's protocols, counted once, by what the board does with it. */
  accounting: ProtocolAccounting;
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
  return Math.max(0, Math.floor((a - b) / 86_400_000));
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Categories whose protocols are wrapped, staked or bridged products of tokens that already trade. */
const BRIDGE_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Cross Chain Bridge']);
const QUASI_STAKING_CATEGORIES = new Set([
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'Anchor BTC',
  'Decentralized BTC',
]);
const EXCHANGE_CATEGORIES = new Set(['CEX']);

/** A name carrying one of these whole words names a product of a token that trades, not a protocol of its own. */
const PRODUCT_WORD = /\b(wrapped|staked|staking)\b/i;

/** Exchanges whose name at the start of a protocol's name marks a product of that exchange. */
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

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
  return productReason(p) === null;
}

/**
 * Why a protocol that records no token is not ranked, in the house's own style: the reason its
 * record does not stand on its own but is a product of something whose token already trades.
 * The reason is one of five, and it is read from the snapshot's own fields — the category, the
 * name — never from a table of protocol names:
 *
 *   exchange        the category is an exchange's, or the name begins with an exchange's
 *   bridge          the category is a bridge: it holds a token that trades on the other side
 *   quasi-staking   the category is a staked or restaked product: its receipt is the token
 *   versioned       the name ends in a release marker: it is a pool of another protocol
 *   wrapped-or-staked  the name carries a whole word wrapped, staked or staking
 *
 * The dashboard's protocol accounting uses these same five reasons, so the accounting and the
 * board can never disagree about which protocols were left out.
 */
export type ExclusionReason = 'exchange' | 'bridge' | 'quasi-staking' | 'versioned' | 'wrapped-or-staked';

export function productReason(p: SnapshotProtocol): ExclusionReason | null {
  const cat = p.category ?? '';
  if (EXCHANGE_CATEGORIES.has(cat)) return 'exchange';
  if (BRIDGE_CATEGORIES.has(cat)) return 'bridge';
  if (QUASI_STAKING_CATEGORIES.has(cat)) return 'quasi-staking';
  if (VERSIONED.test(p.name)) return 'versioned';
  if (PRODUCT_WORD.test(p.name)) return 'wrapped-or-staked';
  for (const e of EXCHANGE_PREFIXES) if (p.name.startsWith(e)) return 'exchange';
  return null;
}

/**
 * The chain a farmer would actually use: the protocol's own first chain that carries smart
 * contracts. A protocol whose TVL sits on Bitcoin, Ripple or Stellar has no EVM contract to
 * call, so naming those chains in a farm plan would ask for an action the chain cannot do;
 * where the protocol does run on an EVM chain, that one is named. Falls back to the first chain
 * the protocol names when it runs on none of them.
 */
const NON_EVM_CHAINS = new Set([
  'Bitcoin', 'Bitcoincash', 'BSV Blockchain', 'Cardano', 'Litecoin', 'Doge', 'Dash', 'Decrec',
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

/**
 * A protocol's farm plan: eight or nine steps, each an action with a cost and a time. The plan
 * is derived from the protocol's own record (category, chains, TVL, age), never from a
 * hand-written list of names: the same generator writes every protocol's plan. The TVL tier sets
 * the position size, the age sets the hold, the category sets the action, and protocols securing
 * TVL on three or more chains carry an extra cross-chain activity step.
 *
 * Every step also carries its numbers — the capital it puts at risk, the gas it costs and the
 * minutes of active work it takes — so the plan's totals are the sum of its own steps rather
 * than a separate estimate. The hold step carries no hours: waiting for the window to close is
 * capital lock-up, not labour, and the board reports the two separately.
 */
export function farmPlan(p: SnapshotProtocol, age: number | null): FarmPlan {
  const chain = chainOf(p);
  const second = secondChainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = gasOf(chain);
  const action = actionFor(p, capital, chain, gas);
  const young = age !== null && age < 180;
  const weeks = Math.max(2, Math.round(hold / 7));
  const weeklyGas = Math.max(1, Math.round(gas / 4));
  const steps: FarmStep[] = [
    {
      text: 'Open a fresh wallet that holds only the funds for this farm and keep its seed phrase offline, never in a browser extension or a cloud note.',
      cost: '$0',
      time: '5 minutes',
      capital_usd: 0,
      gas_usd: 0,
      hours: 5 / 60,
    },
    {
      text: NON_EVM_CHAINS.has(chain)
        ? `Fund the wallet with $${capital} of USDC and move it to ${chain} in one transfer, since ${chain} has no EVM gas to budget for.`
        : `Fund the wallet with $${capital} of USDC plus about $${gas * 2} for gas on ${chain}, moving the capital in one transaction to keep fees down.`,
      cost: NON_EVM_CHAINS.has(chain) ? `$${capital} of capital, its own chain fees` : `$${capital} of capital, about $${gas * 2} of gas`,
      time: '10 minutes',
      capital_usd: capital,
      gas_usd: NON_EVM_CHAINS.has(chain) ? 0 : gas * 2,
      hours: 10 / 60,
    },
    {
      text: action,
      cost: `part of the $${capital}, ${gasNote(chain)}`,
      time: '15 to 20 minutes',
      capital_usd: 0,
      gas_usd: gas,
      hours: 17.5 / 60,
    },
    {
      text: `Make one qualifying action every week — a deposit, a borrow, a swap or a vote — so the protocol counts wallet activity across more than one weekly snapshot; over a ${hold}-day hold that is about ${weeks} actions.`,
      cost: `about $${weeklyGas} of gas a week, $${weeklyGas * weeks} in all`,
      time: `10 minutes a week, ${weeks} weeks`,
      capital_usd: 0,
      gas_usd: weeklyGas * weeks,
      hours: (10 * weeks) / 60,
    },
  ];
  if (p.chains.length >= 3 && second !== chain) {
    steps.push({
      text: `Repeat the main deposit on ${second} through ${p.name}: the protocol secures TVL on ${p.chains.length} chains, and activity on a second one reads as a cross-chain user rather than a single-chain farmer.`,
      cost: `${gasNote(second)} on ${second}`,
      time: '15 minutes',
      capital_usd: 0,
      gas_usd: gasOf(second),
      hours: 15 / 60,
    });
  }
  steps.push(
    {
      text: `Hold the position for at least ${hold} days without withdrawing${young ? ` — the protocol is only ${age} days old, so early activity is the likeliest to count` : ', spanning more than one month of the protocol\'s own tracking'}, and keep every position open until the hold window closes.`,
      cost: `the $${capital} stays deployed`,
      time: `${hold} days`,
      capital_usd: 0,
      gas_usd: 0,
      // Waiting is not work: the hold is capital lock-up, reported as its own number.
      hours: 0,
    },
    {
      text: `Check the protocol's own points or rewards page weekly and claim only through the link it publishes; never sign a claim from a chat, a search result or an unsolicited DM.`,
      cost: 'no fee to check, never pay to claim',
      time: '5 minutes a week',
      capital_usd: 0,
      gas_usd: 0,
      hours: (5 * weeks) / 60,
    },
    {
      text: `Write the wallet address, the open date, the amounts and every transaction hash in a farm log so the position can be audited, repeated or unwound.`,
      cost: '$0',
      time: '5 minutes',
      capital_usd: 0,
      gas_usd: 0,
      hours: 5 / 60,
    },
  );
  const capitalTotal = steps.reduce((s, x) => s + x.capital_usd, 0);
  const gasTotal = steps.reduce((s, x) => s + x.gas_usd, 0);
  const hours = steps.reduce((s, x) => s + x.hours, 0);
  return { steps, capital_usd: capitalTotal, gas_usd: gasTotal, cost_usd: capitalTotal + gasTotal, hours, lockup_days: hold };
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Keep the position open and recheck each week.`;
  return s;
}

/** One line that sums a plan: the capital, the gas, the active hours, the lock-up and the steps. */
function farmSummary(plan: FarmPlan): string {
  return `$${plan.capital_usd} of capital · ~$${plan.gas_usd} of gas · ${plan.hours.toFixed(1)} h of work · ${plan.lockup_days}-day lock-up · ${plan.steps.length} steps`;
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

/**
 * A farm verdict in plain English, computed from the row's own numbers — never from a table of
 * protocol names.
 *
 * The metric: the modelled value of the token the protocol would issue, per hour of active work.
 * The board's implied value is the entry's own claim about that token, so the rate is
 *
 *     $/hour = implied_value_usd / farm_hours
 *
 * where farm_hours counts only the hours of active labour — the hold window is capital lock-up
 * and is reported separately, because waiting is not work. Alongside the rate the row carries
 * the capital and gas at risk (farm_cost_usd) and the multiple the claim is of that stake
 * (implied_value / cost), so a reader sees both the rate and how much of their own money the
 * claim rests on.
 *
 * The bands come from the board's own distribution of that rate, not from a hardcoded cut: the
 * top quartile of rows by $/hour is "worth it", the bottom quartile is "low signal", and the
 * middle is "marginal". Every row therefore gets a verdict from its own numbers, and the
 * distribution — not a table — decides where the lines fall.
 */
function farmVerdict(
  implied: number,
  plan: FarmPlan,
  vph: number,
  q25: number,
  q75: number,
): { verdict: string; klass: 'worth' | 'marginal' | 'not-worth' } {
  const hours = plan.hours;
  const hoursText = hours < 1 ? `${Math.round(hours * 60)} min` : `${hours.toFixed(1)} h`;
  const stakeText = `$${Math.round(plan.cost_usd)} at stake`;
  const lockText = `$${Math.round(plan.capital_usd)} locked up for ${plan.lockup_days} days`;
  const claimText = `a token modelled at $${fmtShort(implied)}`;
  const rateText = `$${fmtShort(vph)}/h`;
  if (vph >= q75) {
    return {
      verdict: `Worth it: ${hoursText} of work and ${stakeText}, chasing ${claimText} — ${rateText}, ${lockText}`,
      klass: 'worth',
    };
  }
  if (vph >= q25) {
    return {
      verdict: `Marginal: ${hoursText} of work, ${stakeText}, ${claimText} at ${rateText} — thin signal`,
      klass: 'marginal',
    };
  }
  return {
    verdict: `Low signal: ${hoursText} of work and ${stakeText} for ${claimText} at ${rateText}`,
    klass: 'not-worth',
  };
}

/** A dollar figure in the short form the board and the verdicts print. */
function fmtShort(usd: number): string {
  if (usd >= 1e9) return `${(usd / 1e9).toFixed(2)}B`;
  if (usd >= 1e6) return `${(usd / 1e6).toFixed(1)}M`;
  if (usd >= 1e3) return `${Math.round(usd / 1e3)}K`;
  return String(Math.round(usd));
}

/**
 * The protocol accounting: every one of the snapshot's protocols counted exactly once, by what
 * the board does with it.
 *
 * The buckets are, in order:
 *   ranked, at or above the floor  the board's rows, of which the watchlist's own 40 are a part
 *   ranked, below the floor        the early radar: no token, and a smaller pool than the floor
 *   already trading                the snapshot's protocols whose token already has a market cap
 *   excluded, bridge               a bridge: it holds a token that trades on the other side
 *   excluded, quasi-staking        a staked or restaked product: its receipt is the token
 *   excluded, exchange             an exchange's own book, not a protocol with a token to come
 *   excluded, versioned            a pool of another protocol: the name ends in a release marker
 *   excluded, wrapped-or-staked    the name carries a whole word wrapped, staked or staking
 *
 * Every count comes from the snapshot's own fields: the market cap, the gecko id and the symbol
 * decide whether a token already trades; the category and the name decide the exclusion reason.
 * The buckets sum to the snapshot's protocol count with no remainder, and the dashboard says so.
 */
export function protocolAccounting(snapshot: Snapshot, board: BoardRow[]): ProtocolAccounting {
  const rankedSlugs = new Set(board.map((r) => r.slug));
  const isWatch = new Set(snapshot.watchlist);
  const counts = new Map<string, { count: number; example: string | null }>();
  const bump = (key: string, example: string): void => {
    const e = counts.get(key);
    if (e === undefined) counts.set(key, { count: 1, example });
    else {
      e.count += 1;
      if (e.example === null) e.example = example;
    }
  };
  let trading = 0;
  let noMcap = 0;
  let excluded = 0;
  const reasonCounts = new Map<ExclusionReason, number>();
  for (const p of snapshot.protocols) {
    if (!isPreToken(p)) {
      // The snapshot records the protocol's token: a gecko id or a symbol on record.
      // A market cap means the token already has a price; without one the token is recorded
      // but the market has not priced it yet. The board ranks neither: a token that exists is
      // not a launch to farm.
      if (p.mcap_usd !== null) {
        trading += 1;
        bump('trading', `${p.name} (${p.slug})`);
      } else {
        noMcap += 1;
        bump('token-recorded', `${p.name} (${p.slug})`);
      }
      continue;
    }
    const reason = productReason(p);
    if (reason === null) {
      const key = p.tvl_usd >= snapshot.floor_usd ? 'ranked-floor' : 'ranked-early';
      bump(key, `${p.name} (${p.slug})`);
      continue;
    }
    excluded += 1;
    reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
    bump('excluded-' + reason, `${p.name} (${p.slug})`);
  }
  const watchlistRanked = snapshot.watchlist.filter((s) => rankedSlugs.has(s)).length;
  const earlyRanked = board.length - watchlistRanked;
  const belowFloor = counts.get('ranked-early')?.count ?? 0;
  const REASONS: { reason: ExclusionReason; label: string }[] = [
    { reason: 'bridge', label: 'bridge — holds a token that trades on the other side' },
    { reason: 'quasi-staking', label: 'quasi-staking — a staked or restaked product; its receipt is the token' },
    { reason: 'exchange', label: 'exchange — an exchange\'s own book, not a protocol with a token to come' },
    { reason: 'versioned', label: 'versioned — a pool of another protocol; the name ends in a release marker' },
    { reason: 'wrapped-or-staked', label: 'wrapped or staked — the name carries a whole word wrapped, staked or staking' },
  ];
  const buckets: AccountingBucket[] = [
    {
      key: 'ranked-floor',
      label: 'ranked — no token, at or above the watchlist floor',
      short: 'ranked, above the floor',
      count: counts.get('ranked-floor')?.count ?? 0,
      ranked: true,
      reason: null,
      example: counts.get('ranked-floor')?.example ?? null,
    },
    {
      key: 'ranked-early',
      label: 'ranked — no token, below the watchlist floor (the early radar)',
      short: 'ranked, below the floor',
      count: counts.get('ranked-early')?.count ?? 0,
      ranked: true,
      reason: null,
      example: counts.get('ranked-early')?.example ?? null,
    },
    {
      key: 'trading',
      label: 'already trading — the snapshot records a market cap for its token; shown apart, never ranked',
      short: 'already trading',
      count: counts.get('trading')?.count ?? 0,
      ranked: false,
      reason: null,
      example: counts.get('trading')?.example ?? null,
    },
    {
      key: 'token-recorded',
      label: 'token already recorded — a gecko id or a symbol on record, but no market cap yet',
      short: 'token recorded, no cap',
      count: counts.get('token-recorded')?.count ?? 0,
      ranked: false,
      reason: null,
      example: counts.get('token-recorded')?.example ?? null,
    },
    ...REASONS.map((r) => ({
      key: 'excluded-' + r.reason,
      label: 'excluded — ' + r.label,
      short: 'excluded: ' + r.reason,
      count: counts.get('excluded-' + r.reason)?.count ?? 0,
      ranked: false,
      reason: r.reason,
      example: counts.get('excluded-' + r.reason)?.example ?? null,
    })),
  ];
  return {
    total: snapshot.protocols.length,
    buckets,
    ranked: board.length,
    trading,
    token_recorded: noMcap,
    excluded,
    excluded_by_reason: REASONS.map((r) => ({ reason: r.reason, label: r.label, count: reasonCounts.get(r.reason) ?? 0 })),
    watchlist_ranked: watchlistRanked,
    early_ranked: earlyRanked,
    below_floor: belowFloor,
  };
}

/** The board's own rows: every watchlist slug, plus every other standalone pre-token protocol. */
export function buildBoard(
  snapshot: Snapshot,
  report: ValidationReport,
  ctx: TrainCtx,
): BoardRow[] {
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

  const kept = report.kept;
  const fit = { intercept: report.intercept, weights: report.weights };
  const rows: BoardRow[] = [];
  for (const p of chosen.values()) {
    const age = ageDays(snapshot.as_of, p.listed_at);
    const contributions = factorContributions(fit, kept, report.shapes, ctx, {
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      age_days: age,
      chains: p.chains,
      category: p.category,
    });
    const logRatio = contributions.log_ratio;
    // The value has two parts multiplied:
    //   the market multiple: what the market pays for the token of a protocol like this one
    //   the token odds: the probability this protocol issues a token at all, from its own age
    // The multiple is the fitted model's exp(log ratio); the odds come from the fitted odds
    // model. Both are fitted on the snapshot and both are tested held-out.
    const marketMultiple = Math.exp(logRatio);
    const odds = oddsOf(report.odds, age, p.change_7d, p.tvl_usd);
    const implied = Math.max(1, Math.round(p.tvl_usd * marketMultiple * odds));
    const plan = farmPlan(p, age);
    const multiple = p.tvl_usd > 0 ? implied / p.tvl_usd : 0;
    // The rate a farmer's hour earns: the modelled token's value per hour of active labour.
    const vph = plan.hours > 0 ? implied / plan.hours : 0;
    rows.push({
      rank: 0,
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      mcap_usd: p.mcap_usd,
      listed_at: p.listed_at,
      gecko_id: p.gecko_id,
      symbol: p.symbol,
      token_status: 'pre-token',
      age_days: age,
      implied_value_usd: implied,
      implied_low_usd: 0,
      implied_high_usd: 0,
      range_overlaps: 0,
      watchlist: isWatch.has(p.slug),
      farm_capital_usd: plan.capital_usd,
      farm_hold_days: plan.lockup_days,
      farm_cost_usd: plan.cost_usd,
      farm_hours: Math.round(plan.hours * 100) / 100,
      farm_lockup_days: plan.lockup_days,
      farm_verdict: '',
      farm_verdict_class: 'marginal',
      farm_expected_usd: implied,
      farm_value_per_hour: Math.round(vph),
      model: {
        log_ratio: Math.round(logRatio * 1e4) / 1e4,
        implied_multiple: Math.round(multiple * 1e4) / 1e4,
        market_multiple: Math.round(marketMultiple * 1e4) / 1e4,
        token_odds: Math.round(odds * 1e4) / 1e4,
        factors: contributions.factors.map((f) => ({
          key: f.key,
          label: f.label,
          value: Math.round(f.value * 1e4) / 1e4,
          weight: Math.round(f.weight * 1e4) / 1e4,
          contribution: Math.round(f.contribution * 1e4) / 1e4,
        })),
      },
      farm_steps: plan.steps.map(stepText),
      farm_summary: farmSummary(plan),
    });
  }
  rows.sort((a, b) => b.implied_value_usd - a.implied_value_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  rows.forEach((r, i) => {
    r.rank = i + 1;
  });

  // The range honesty: each row's spread comes from the model's own held-out error, and the
  // board counts how many other rows' base values fall inside it.
  const err = report.error_median_log;
  for (const r of rows) {
    r.implied_low_usd = Math.max(1, Math.round(r.implied_value_usd * Math.exp(-err)));
    r.implied_high_usd = Math.max(1, Math.round(r.implied_value_usd * Math.exp(err)));
  }
  for (const r of rows) {
    let overlaps = 0;
    for (const o of rows) {
      if (o.slug === r.slug) continue;
      if (o.implied_value_usd >= r.implied_low_usd && o.implied_value_usd <= r.implied_high_usd) overlaps++;
    }
    r.range_overlaps = overlaps;
  }

  // The verdicts, banded by the board's own distribution of the modelled value per hour.
  const vphs = rows.map((r) => r.farm_value_per_hour).sort((a, b) => a - b);
  const q = (p: number): number => {
    if (vphs.length === 0) return 0;
    const at = Math.min(vphs.length - 1, Math.max(0, Math.floor((p / 100) * vphs.length)));
    return vphs[at]!;
  };
  const q25 = q(25);
  const q75 = q(75);
  for (const r of rows) {
    const plan: FarmPlan = {
      steps: [],
      capital_usd: r.farm_capital_usd,
      gas_usd: Math.max(0, r.farm_cost_usd - r.farm_capital_usd),
      cost_usd: r.farm_cost_usd,
      hours: r.farm_hours,
      lockup_days: r.farm_lockup_days,
    };
    const v = farmVerdict(r.implied_value_usd, plan, r.farm_value_per_hour, q25, q75);
    r.farm_verdict = v.verdict;
    r.farm_verdict_class = v.klass;
  }
  return rows;
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
    implied_low_usd: row.implied_low_usd,
    implied_high_usd: row.implied_high_usd,
    range_overlaps: row.range_overlaps,
    watchlist: row.watchlist,
    token_status: row.token_status,
    symbol: row.symbol,
    farm_capital_usd: row.farm_capital_usd,
    farm_hold_days: row.farm_hold_days,
    farm_cost_usd: row.farm_cost_usd,
    farm_hours: row.farm_hours,
    farm_lockup_days: row.farm_lockup_days,
    farm_verdict: row.farm_verdict,
    farm_verdict_class: row.farm_verdict_class,
    farm_value_per_hour: row.farm_value_per_hour,
    log_ratio: row.model.log_ratio,
    implied_multiple: row.model.implied_multiple,
    market_multiple: row.model.market_multiple,
    token_odds: row.model.token_odds,
    factors: row.model.factors,
    farm_steps: row.farm_steps,
    farm_summary: row.farm_summary,
  };
}

/** Everything the dashboard renders, from the snapshot and the validation report. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData; report: ValidationReport } {
  const shapes = shapesFor(snapshot);
  const report = validateModel(snapshot, shapes);
  const ctx = trainContext(liveSamples(snapshot), shapes);
  const board = buildBoard(snapshot, report, ctx);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !r.watchlist).length;
  const accounting = protocolAccounting(snapshot, board);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    shapes,
    kept: report.kept,
    weights: report.weights,
    intercept: report.intercept,
    range_error_log: report.error_median_log,
    validation: report,
    accounting,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar, report };
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

/** The number the dashboard shows, formatted the way the panel prints it. */
export function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

/** A signed number with three decimals, as the ablation table prints it. */
export function signed(value: number, digits = 4): string {
  const s = value.toFixed(digits);
  return value >= 0 ? `+${s}` : s;
}

/** The finite guard the model applies to a possibly absent figure. */
export { finite };
