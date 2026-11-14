# Token Radar — make.fun token-radar-01

The best token launch radar: which pre-token protocol is worth farming next, and what
to do about it.

## What it does

`main.ts` (Node 22, standard library only) reads the sealed snapshot at
`/input/snapshot.json`, scores every rankable pre-token protocol with the model in
`lib/radar.ts`, and writes:

- `/output/board.json` — the ranked board (every watchlist protocol covered, plus every
  other rankable pre-token protocol in the snapshot, each with an implied value and a
  7-step farm plan)
- `/output/data.js` — the same board for the dashboard
- `/output/dashboard/` — the static page (no network, no framework)
- `/output/screenshots/` — the three screenshots
- `/output/dossier.json` — built with the vendored make.fun library

## The model (radar-2)

Implied value follows only from the snapshot's own figures, never from a list of names:

```
base     = TVL × 0.30
growth   = clamp(7d change, -50%, +150%) → × (1 + growth × 0.60)
maturity = 0.55 + min(age, 1095d) / 1095 × 0.45   (unknown age: 365d)
breadth  = 1 + 0.03 × min(chains − 1, 5)
implied  = round(base × growth × maturity × breadth)
```

TVL is the size of the bet, growth is its direction, maturity is how long the protocol
has run with no token, breadth is how many chains its TVL sits on. Protocols whose
token already trades are kept apart in a Live view: the board shows the market's own
values there, never mixed into the ranking.

A protocol is rankable when it records no token and is not a wrapped, staked or bridged
product of a token that already trades — the watchlist's own rule, applied at any TVL,
so the radar also finds the early ones below the $50M floor.

## The dashboard

A sortable, filterable board (search, category, chain, watchlist-only), a detail view
for every protocol with the model's own inputs and its farm plan, a live-token
comparison, and the model in full. Views are hash-routed: `#detail=<slug>` opens a
protocol, `#cat=<category>` filters, `#tab=live|model` switches tab.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

## License

MIT — see LICENSE.
