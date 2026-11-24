# Token Radar — make.fun token-radar-01 entry

A token-launch radar for the make.fun token-radar-01 bounty: it reads the sealed DefiLlama
snapshot, scores every pre-token protocol with a documented implied-value model, and ships a
single-page dashboard — board, filters, per-protocol detail view, live-token strip and model
explainer. No framework, no network, one snapshot.

## Run

```bash
node main.ts --input <snapshot.json|dir>      # writes /output (or $MAKEFUN_OUTPUT_DIR)
node check-board.mjs <output-dir>             # gate check (SNAPSHOT=<snapshot> env)
```

The program writes `board.json` (the ranked rows), `data.js` (the dashboard's dataset), the
`dashboard/` page, the three `screenshots/` and `dossier.json` (built last, with the vendored
make.fun library).

## The model (radar-4)

Every figure comes from the snapshot itself — TVL, 7-day TVL change, days listed with no token,
the category's live-token mcap/TVL habit, chain breadth. No protocol name is special-cased.

```
base       = tvl × 0.25
momentum   = 1 + 0.55 × tanh(clamp(7d, −60…120) / 45)     smooths one wild week
maturity   = 0.6 + min(age, 1095)/1095 × 0.4
duration   = 1 + 0.35 × (1 − e^(−age/400))                no-token duration, diminishing
category   = 1 + 0.6 × log1p(min(catMedian, 4))/log1p(4)  catMedian = median live mcap/TVL
chain      = 1 + 0.3 × log1p(min(chains, 8))/log1p(8)
implied    = max(1, round(base × momentum × maturity × duration × category × chain))
```

The board covers the whole watchlist (the floor, never a ceiling) plus every other rankable
pre-token protocol below the floor the snapshot carries, plus the standalone pre-token
protocols at or above the floor that pass the watchlist's own product test (no wrapped, staked
or bridged products of tokens that trade). Live-token protocols are never ranked:
the dashboard shows their market values in a separate strip, and their mcap/TVL ratios are the
evidence the category multiplier reads.

## The dashboard

Dark radar-terminal page, monospace numerals, one HTML + one CSS + one JS file. Sortable
columns, combined filters (search, category, chain, min TVL, watchlist-only) with removable
filter chips, a detail view per protocol with a log-scale factor-contribution chart, the model's
six factors as bars and a seven-or-eight-step farm plan with cost and time badges, a
spotlight rail of the top five with factor-mix bars, keyboard navigation (j/k move, enter open,
esc back, / search), CSV export of the filtered board, a live-token strip labelled "already
trading, not ranked", and a model panel that states every constant. Hash routes:
`#detail=<slug>`, `#filter=cat:X;chain:Y;min:50;wl:1;q:text`.

## Layout

```
main.ts            entry point: reads the snapshot, writes the output dir
lib/model.ts       the radar-4 model, board builder, farm-plan generator
dashboard/         index.html, app.css, app.js (the page the judge sees)
vendor/            make.fun's dossier library (byte-for-byte, unmodified)
screenshots/       1-board.png, 2-detail.png, 3-filtered.png (1440×900)
check-board.mjs    the gate check this entry runs against its own output
```

## make.fun

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/lexlion11/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/lexlion11/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
