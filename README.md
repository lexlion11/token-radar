# Token Radar — make.fun token-radar-01 entry

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/lexlion11/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/lexlion11/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A pre-token protocol radar: reads the sealed DefiLlama snapshot, scores every protocol that has
no token yet with the **radar-2** value model, and renders a dark "radar terminal" dashboard with
the ranked board, per-protocol detail views, live-token strip and the model's own explainer.

## Run it

```bash
node main.ts --input /path/to/snapshot.json          # writes /output (or MAKEFUN_OUTPUT_DIR)
MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input-snapshot.json
node check-board.mjs out                             # the entry's own gate check
```

Node 22+ with type stripping (Node 23+ runs `main.ts` as-is; Node 22 needs `--experimental-strip-types`).
Standard library only — no dependencies, no build step, no network.

## What it writes

- `board.json` — `rows`: the ranked board. Every watchlist slug (the floor, never a ceiling) plus
  the early radar: pre-token protocols below the floor, by TVL. Ranks 1..N, implied value
  non-increasing, 3–12 farm steps per protocol.
- `data.js` — `window.RADAR=...`: the dashboard's whole dataset, no fetch, no network.
- `dashboard/` + `screenshots/` — copied to the output directory.
- `dossier.json` — written last by the vendored `vendor/makefun-board.ts` (`buildDossier`).

## The radar-2 model

```
base       = tvl_usd × 0.25
growth     = clamp(change_7d, −60, +120) %, saturated: 1 + tanh(growth / 45) × 0.35
maturity   = 0.55 + min(age_days, 1460) / 1460 × 0.45      (age = how long it ran with no token)
catMult    = clamp((categoryMedianMcapTvl / globalMedianMcapTvl) ^ 0.3, 0.6, 2.0)
             — each category's median market cap per TVL dollar over its own live-token protocols,
               against the same median network-wide; 1.0 when the category has < 3 live samples
chainMult  = 1 + (min(chains, 10) − 1) × 0.02
implied    = max(1, round(base × growth × maturity × catMult × chainMult))
```

Everything is derived from the snapshot's own fields — TVL, 7-day change, listed-at age, category,
chains, and the live set's market caps. No protocol name is ever special-cased; the same function
scores every row. `MODEL_VERSION = 'radar-2'`, constants named in `lib/model.ts` and stated in the
dashboard's model explainer panel.

## The dashboard

`dashboard/index.html` + `app.css` + `app.js`, vanilla JS, no framework, no network, ~43KB of source:

- **Board table** — rank, protocol, category tag, chains (first two + "+N"), TVL, colored 7-day
  change, implied value with a bar. Every column header sorts asc/desc; rows click through to the
  detail view. Amber dot = watchlist.
- **Filter bar** — text search, category, chain, min-TV and a watchlist-only toggle; filters
  combine, an active-filter count and a clear button. The filter state lives in the hash
  (`#filter=category:Lending&minTvl:50&watchlist:1`) so a filtered view is a link.
- **Detail view** — `#detail=<slug>` hash route: full stats, a bar visualization of every model
  factor (base, growth, maturity, category, chain breadth), the farm plan as a numbered step list
  with cost/time badges, the chain list, and the page's own recomputation of the implied value
  against the number board.json carries.
- **Live-token strip** — the top live-token protocols by market cap with their mcap/TVL ratio,
  labeled "already trading, not ranked": the market's values, never mixed into the model's board.
- **Model explainer** — the formula in plain words, every named constant, and the derived category
  multipliers.
- **Footer** — the snapshot's data source and as-of date; "built for make.fun token-radar-01".

## Farm plans

Every protocol gets 3–12 concrete steps (6–7 here), each with a cost and a time, derived from its
own record: the category decides the action (supply, provide liquidity, bridge, stake, …), TVL
decides the capital ($50–$250), age decides the hold (30–60 days), and a protocol on more than one
chain gets a breadth step. `lib/model.ts` writes the plan to board.json; the dashboard's detail
view regenerates the same plan from the same figures.

## Layout

```
main.ts              reads the snapshot, writes the outputs, dossier last
lib/model.ts         the radar-2 model: scoring, farm plans, board build, gate validation
dashboard/           the page (index.html, app.css, app.js)
vendor/makefun-board.ts   the house's dossier library, copied byte-for-byte
check-board.mjs      the entry's own gate check (row count, coverage, ranks, steps, URLs, bytes)
screenshots/         1-board.png, 2-detail.png, 3-filtered.png
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=lexlion11&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>

Implied value is a model, not a promise — and the model's only inputs are the snapshot's own figures.
