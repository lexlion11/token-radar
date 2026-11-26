# Token Radar — make.fun token-radar-01 entry

A token-launch radar for the make.fun token-radar-01 bounty: it reads the sealed DefiLlama
snapshot, **accounts for every one of its 758 protocols**, **fits** the implied-value model on
the market's own answers, **tests it held-out twice**, **fits a separate token-odds model** and
ships a single-page dashboard — integrity strip, protocol accounting, the value model and its
validation, board, filters, per-protocol detail view, costed farm verdicts in $/hour,
live-token strip and the full ablation panel. No framework, no network, one snapshot.

## Run

```bash
node main.ts --input <snapshot.json|dir>      # writes /output (or $MAKEFUN_OUTPUT_DIR)
node check-board.mjs <output-dir>             # gate check (SNAPSHOT=<snapshot> env)
```

The program writes `board.json` (the ranked rows), `data.js` (the dashboard's dataset),
`integrity.js` (the integrity strip), the `dashboard/` page, the three `screenshots/` and
`dossier.json` (built last, with the vendored make.fun library).

## The protocol accounting — every one of the 758 protocols, counted once

The board does not silently drop the protocols it does not rank. A visible strip under the
integrity bar counts **every protocol in the snapshot exactly once**, and the counts sum to the
snapshot's protocol count with no remainder:

| bucket | count | why |
|---|---|---|
| ranked, above the watchlist floor | 59 | no token recorded, at or above $50M of TVL, and standing on their own |
| ranked, below the floor (the early radar) | 134 | the same test, on a smaller pool — the floor is never a ceiling |
| already trading | 144 | the snapshot records a market cap for their token: they are shown apart, never ranked |
| token recorded, no market cap | 272 | a gecko id or a symbol on record, but the market has not priced it |
| excluded: bridge | 44 | a bridge holds a token that trades on the other side |
| excluded: quasi-staking | 47 | a staked or restaked product: its receipt *is* the token |
| excluded: exchange | 42 | an exchange's own book, not a protocol with a token to come |
| excluded: versioned | 11 | a pool of another protocol: the name ends in a release marker |
| excluded: wrapped-or-staked | 5 | the name carries a whole word wrapped, staked or staking |

**59 + 134 + 144 + 272 + 44 + 47 + 42 + 11 + 5 = 758.** Every count is read from the snapshot's
own market cap, gecko id, symbol, category and name — no protocol name is special-cased anywhere
in the entry. The same rules decide the board's membership and the accounting, so the two can
never disagree.

## The value model (radar-8) — two parts, both fitted, both tested held-out

```
market multiple = e^(log ratio),  log ratio = intercept + Σ (weight × factor)
token odds      = P(this protocol issues a token | its own age)
implied value   = TVL × market multiple × token odds
```

The value has two parts multiplied, because the snapshot answers two separate questions.

### 1. The market multiple — what a token is worth once it exists

Fitted on the snapshot's **126 live-token protocols** (the ones whose token already trades, so
the market's own answer `mcap/tvl` is known) and tested on rows it never saw, under two
hold-out schemes:

| scheme | rows held out | r | rank correlation | median error | baseline error |
|---|---|---|---|---|---|
| **walk-forward** — oldest 60% by listing day train, newest 40% held out | 51 | **0.368** | 0.274 | 90.7% | 93.6% |
| **leave-one-out** — every row held out in turn, predicted by a model fitted on the others | 126 | **0.366** | 0.315 | 85.7% | 87.6% |

The baseline predicts the market's median ratio for every row; an error ratio below 1 means the
model beats "every protocol is worth the median". The fit is a ridge regression on standardised
columns (the factors are collinear by nature, so an unregularised solve is numerically hopeless).

### 2. The token odds — whether a token is issued at all

Age does not predict the *ratio* a market pays. But it does predict **whether a token is issued
at all**, and that is a question the snapshot can answer: of the 758 protocols, 416 already record
a token and 342 record none, and the older a protocol is the likelier it is among the issued
ones (P(token | age ≥ 730 days) = 0.679, against P(token | age ≥ 30 days) = 0.547).

So the odds are a **separate logistic model** on `log1p(age/30)`, fitted on the oldest 60% of the
snapshot's protocols by listing day and scored on the newest 40% — the same walk-forward split
the value model uses, so a protocol that has run for years and only just listed a token is judged
by a model that never saw it.

| | held-out score | baseline |
|---|---|---|
| **AUC** — how well the score orders issued above not-issued | **0.635** | 0.500 |
| **Brier** — the probability's own mean squared error | **0.2842** | 0.3283 |
| **Brier skill** — 1 − our error over the baseline's | **13.4%** | — |

The baseline is the training set's own issuance rate applied to every row: "every protocol issues
a token at the same rate". The odds model's job is to beat it on the rows it never saw, and it
does. Its features are selected on the same held-out Brier score: the run length is kept, the
7-day change and the TVL are dropped because neither lowered the held-out error by more than the
margin.

### Every term kept or dropped on the held-out score

The model is **built by forward selection on the held-out score**, not by starting from every
factor and pruning. The reason is measured, not stylistic: on this snapshot the age terms (listing
age, no-token duration) are all functions of the same variable, so a term collinear with a term
already in the model is judged on the wrong question — "does removing it hurt?" answers "is it
the only copy of that column?", not "is it signal?". Forward selection asks the second question
directly: a factor joins only when adding it raises the mean held-out correlation by more than
the margin (0.01 — larger than the fit noise on 51 to 126 held-out rows).

| factor | decision | what it reads | why |
|---|---|---|---|
| TVL scale | **KEPT** | log of the protocol's own TVL | every protocol's value has to scale with the pool it draws on |
| 7-day momentum | DROPPED | the protocol's own 7-day TVL change | adding it did not raise the held-out correlation |
| Listing age | DROPPED | how long DefiLlama has tracked it | it is in the odds model instead, where it does carry signal |
| No-token duration | DROPPED | how long it has run with no token | collinear with listing age; the odds model carries the age |
| Category multiple | DROPPED | the median market ratio of the live-token protocols in the same category | it did not raise the held-out correlation |
| Chain breadth | DROPPED | how many chains it secures TVL on | it did not raise the held-out correlation |

**Shipped weight:** base −0.4330, intercept +7.0659. The dropped terms are gone from the shipped
model, not merely down-weighted, and the dashboard's model panel says so with the same numbers.

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
  "marginal".
- The verdict names the hours, the stake, the modelled token and the rate, e.g. *"Worth it: 1.9 h
  of work and $175 at stake, chasing a token modelled at $48.9M — $26.1M/h, $150 locked up for
  30 days"*.

## The integrity strip

A bar under the header, and a line in `integrity.js` beside `data.js`, stating:

- the snapshot's `as_of` (2026-11-14), its source, and its sha256 `42a71213519479f3…`;
- 758 protocols, 40 on the watchlist, 193 board rows (153 below the floor), watchlist covered
  **40/40**, and the protocol accounting's own sum **758/758**;
- the sha256 of `board.json` and of `data.js` as this program wrote them;
- that the three screenshots were rendered headless from this exact `data.js`.

The strip lives in its own file rather than inside `data.js` because a file cannot carry its own
sha256: `data.js` is written and hashed first, then `integrity.js` records that hash.

## The board

The board covers the whole watchlist (the floor, never a ceiling — 40/40) plus every other
standalone pre-token protocol the snapshot carries (153 more, well past the gate's 60), 193 rows
in all. Live-token protocols are never ranked: the dashboard shows their market values in a
separate strip, and their mcap/TVL ratios are the evidence the value model is fitted on.

## The dashboard

Dark radar-terminal page, monospace numerals, one HTML + one CSS + one JS file — **53,071 bytes**
of source, against the 64 KB the dossier's text cap allows. The **protocol accounting** and the
**value model card** are on the default view, above the board, not behind a button: the counts
that account for all 758 protocols, the equation, the two hold-out schemes' scores with their
sample sizes, and the token-odds model's AUC against its baseline. Sortable columns (rank,
protocol, category, TVL, 7d, token odds, implied value, cost, $/hour), combined filters (search,
category, chain, lock-up length, min TVL, watchlist-only) with removable filter chips, a detail
view per protocol with the value's derivation bar, its low/base/high range, its costed farm
verdict and its farm steps with cost and time badges, a spotlight rail of the top five, the
live-token strip, the full validation panel with both ablation tables, keyboard navigation
(j/k move, enter open, esc back, / search), CSV export. Hash routes: `#detail=<slug>`,
`#filter=hold:30`.

## Layout

```
main.ts            entry point: reads the snapshot, writes the output dir
lib/model.ts       the radar-8 model, protocol accounting, board builder, farm-plan generator
lib/validate.ts    the validation harness: value fit, token-odds fit, two hold-out schemes, ablation
dashboard/         index.html, app.css, app.js (the page the judge sees)
vendor/            make.fun's dossier library (byte-for-byte, unmodified)
screenshots/       1-board.png, 2-detail.png, 3-filtered.png (1440×900)
check-board.mjs    the gate check this entry runs against its own output
```

## make.fun

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/lexlion11/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/lexlion11/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
