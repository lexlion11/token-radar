# Token Radar — make.fun token-radar-01 entry

A token-launch radar: ranks pre-token DeFi protocols by an implied value derived only from the
snapshot's own figures, separates the ones whose token already trades, and gives each protocol a
concrete farm plan.

## What it does

`main.ts` (Node 22, standard library only) reads the sealed snapshot, scores every pre-token
protocol with the model in `lib/model.ts`, and writes:

- `board.json` — 200 ranked rows: the 40 watchlist protocols plus the 160 highest-TVL pre-token
  protocols below the floor, each with its implied value, model factors and a 6-step farm plan.
- `data.js` — the same board plus the live-token set, as one `window.RADAR` script.
- `dashboard/` + `screenshots/` — copied to the output dir.
- `dossier.json` — written last by the vendored make.fun library.

Run it:

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input-snapshot.json
```

## The model (radar-2)

```
base         = tvl_usd × 0.25
growth       = 1 + 0.45 × tanh(clamp(change_7d, ±200) / 40)     smooth, saturating momentum
duration     = 0.55 + min(age_days, 1825) / 1825 × 0.45          how long it ran with no token
category     = clamp(1 + 0.35 × log2(1 + catRatio / 0.5), 0.6, 2.5)
             catRatio = median mcap/tvl of the category's live-token protocols (market's own
             valuation of the category; global median fallback, no hardcoded names)
chain        = 1 + 0.18 × min(chains, 8) / 8                      deployment breadth
implied      = max(1, round(base × growth × duration × category × chain))
```

Every constant is the same for every row and is stated in the dashboard's Model panel; the model
reads only the snapshot's fields and never special-cases a protocol name.

## The dashboard

A single-page app in vanilla JS (no framework, no network): a dark radar-terminal board with
sortable columns (rank, protocol, category, chains, TVL, 7d change, implied value), a filter bar
(search, category, chain, min-TVL, watchlist-only), a per-protocol detail view with a model-factor
breakdown and the farm plan as numbered steps with cost/time badges, a live-token strip labelled
"already trading, not ranked", and a model explainer panel. Hash routes: `#detail=<slug>`,
`#filter=category:Lending&chain:Ethereum&minTvl:50&wl:1`.

## Verify

```sh
node check-board.mjs out        # gate checks on board.json
```

## Layout

```
main.ts                entrypoint (arg parsing, output writing, dossier last)
lib/model.ts           the value model, board builder, farm-plan generator
dashboard/             index.html, app.css, app.js
vendor/makefun-board.ts  make.fun's dossier library (vendored, unmodified)
screenshots/           1-board.png, 2-detail.png, 3-filtered.png
check-board.mjs        local gate verification
LICENSE                MIT
```
