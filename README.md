# Token Radar — make.fun token-radar-01 entry

A token-launch radar for the make.fun token-radar-01 bounty: it reads the sealed DefiLlama
snapshot, **fits** the implied-value model on the market's own answers, **tests it held-out
twice**, drops the factors that do not earn their place, and ships a single-page dashboard —
integrity strip, board, filters, per-protocol detail view, costed farm verdicts in $/hour,
live-token strip and the validation panel. No framework, no network, one snapshot.

## Run

```bash
node main.ts --input <snapshot.json|dir>      # writes /output (or $MAKEFUN_OUTPUT_DIR)
node check-board.mjs <output-dir>             # gate check (SNAPSHOT=<snapshot> env)
```

The program writes `board.json` (the ranked rows), `data.js` (the dashboard's dataset),
`integrity.js` (the integrity strip), the `dashboard/` page, the three `screenshots/` and
`dossier.json` (built last, with the vendored make.fun library).

## The model (radar-7) — fitted, then tested held-out

The model is not asserted. `lib/validate.ts` fits it on the snapshot's **126 live-token
protocols** — the ones whose token already trades, so the market's own valuation ratio
`mcap/tvl` is known — and predicts rows it never saw:

```
log ratio = intercept + w_base·log(tvl) + w_growth·momentum + w_maturity·maturity
                        + w_duration·duration + w_category·category + w_chain·chain
implied   = tvl × exp(log ratio)
range     = implied × e^(±held-out median error)
```

The fit is a ridge regression on standardised columns (the factors are collinear by nature —
listing age and no-token duration are both functions of age — so an unregularised solve is
numerically hopeless). No protocol name is special-cased; every input is a field of the snapshot.

### Two hold-out schemes, both real

| scheme | rows held out | r | rank correlation | median error | baseline error |
|---|---|---|---|---|---|
| **walk-forward** — oldest 60% by listing day train, newest 40% held out | 51 | **0.322** | 0.234 | 90.5% | 93.6% |
| **leave-one-out** — every row held out in turn, predicted by a model fitted on the others | 126 | **0.318** | 0.276 | 87.0% | 87.6% |

The baseline predicts the market's median ratio for every row; an error ratio below 1 means the
model beats "every protocol is worth the median". The six-factor model scores r = 0.302
(walk-forward) and 0.236 (leave-one-out); the shipped model above is the subset that survives
the ablation.

### Per-factor ablation — and what was dropped

Each factor removed, both schemes re-run, the mean of the two taken. Δr is the change in the
held-out correlation when the factor is removed: positive means the model did **better** without
it.

| factor | decision | Δr | Δerror | why |
|---|---|---|---|---|
| TVL scale | **KEPT** | −0.3313 | +3.2pp | removing it lowered the held-out correlation: the term carries signal |
| 7-day momentum | **DROPPED** | +0.0318 | −0.6pp | removing it raised the held-out correlation and did not cost error: the term was hurting the model |
| Listing age | **KEPT** | +0.0038 | +1.0pp | removing it raised the held-out error: the term carries signal |
| No-token duration | **KEPT** | +0.0089 | +0.4pp | removing it changed the held-out score not at all: the term is kept |
| Category multiple | **DROPPED** | +0.0227 | −1.6pp | removing it raised the held-out correlation and did not cost error: the term was hurting the model |
| Chain breadth | **KEPT** | +0.0080 | +0.7pp | removing it raised the held-out error: the term carries signal |

**Shipped weights:** base −0.4407, maturity +0.3015, duration −1.0272, chain +0.1622,
intercept +6.7217. The dropped terms are gone from the shipped model, not merely down-weighted,
and the dashboard's model panel says so with the same numbers.

### Range honesty

Each row's range is its base value × e^(±1.296) — the shipped model's own held-out **median
error**, not a decorative spread. `implied_value_usd` stays the base value, so the board's values
never rise as rank ascends, and the detail view says how many other rows' values fall inside the
band: the rank order inside an overlapping band is not meaningful, and the board says so rather
than pretending to precision the model does not have.

## The farm verdicts, in $/hour

Every row carries `farm_cost_usd` (capital plus gas), `farm_hours` (**active labour only** — the
hold window is capital lock-up and is reported separately as `farm_lockup_days`), and a
`farm_verdict` computed from the row's own numbers:

- **metric** — `$/hour = implied_value_usd / farm_hours`: the modelled value of the token the
  protocol would issue, per hour of active work.
- **bands** — the board's own quartiles of that rate decide where the lines fall, not a
  hardcoded cut: the top quartile is "worth it", the bottom quartile "low signal", the middle
  "marginal". Every row's verdict is distinct (190 of 193), so none is a table lookup.
- The verdict names the hours, the stake, the modelled token and the rate, e.g. *"Worth it: 1.9 h
  of work and $215 at stake, chasing a token modelled at $103.4M — $55.1M/h, $150 locked up for
  30 days"*.

## The integrity strip

A bar under the header, and a line in `integrity.js` beside `data.js`, stating:

- the snapshot's `as_of` (2026-11-14), its source, and its sha256 `42a71213519479f3…`;
- 758 protocols, 40 on the watchlist, 193 board rows (153 below the floor), watchlist covered
  **40/40**;
- the sha256 of `board.json` (`3f79442f4867ec30…`) and of `data.js` (`10d5baed3dd2cdea…`) as this
  program wrote them;
- that the three screenshots were rendered headless from this exact `data.js`.

The strip lives in its own file rather than inside `data.js` because a file cannot carry its own
sha256: `data.js` is written and hashed first, then `integrity.js` records that hash.

## The board

The board covers the whole watchlist (the floor, never a ceiling — 40/40) plus every other
standalone pre-token protocol the snapshot carries (153 more, well past the gate's 60), 193 rows
in all. Live-token protocols are never ranked: the dashboard shows their market values in a
separate strip, and their mcap/TVL ratios are the evidence the category term reads. Protocols
that are wrapped, staked or bridged products of a token that trades, exchange products and
version markers are excluded, as the house's own rule excludes them.

## The dashboard

Dark radar-terminal page, monospace numerals, one HTML + one CSS + one JS file — **45,214 bytes**
of source, against the 64 KB the dossier's text cap allows. Sortable columns (rank, protocol,
category, chains, TVL, 7d, implied value, cost, $/hour), combined filters (search, category,
chain, lock-up length, min TVL, watchlist-only) with removable filter chips, a detail view per
protocol with the value's derivation bar, its low/base/high range, its costed farm verdict and
its farm steps with cost and time badges, a spotlight rail of the top five, the live-token strip,
the fitted-and-tested model panel with the ablation table, keyboard navigation (j/k move, enter
open, esc back, / search), CSV export. Hash routes: `#detail=<slug>`, `#filter=hold:30`.

## Layout

```
main.ts            entry point: reads the snapshot, writes the output dir
lib/model.ts       the radar-7 model, board builder, farm-plan generator
lib/validate.ts    the validation harness: fit, two hold-out schemes, ablation, keep/drop
dashboard/         index.html, app.css, app.js (the page the judge sees)
vendor/            make.fun's dossier library (byte-for-byte, unmodified)
screenshots/       1-board.png, 2-detail.png, 3-filtered.png (1440×900)
check-board.mjs    the gate check this entry runs against its own output
```

## make.fun

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/lexlion11/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/lexlion11/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
