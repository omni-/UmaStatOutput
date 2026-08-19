# Uma Stat Output

A tiny static calculator for comparing **Umamusume support cards by placement-weighted training output**.

Most support-card calculators show how strong a training click is *after the card is already there*. That can hide a meaningful difference between cards with different **Specialty Priority / 得意率**, especially in scenarios such as **Grand Live**, which adds a global Specialty Priority bonus.

## What it calculates

For each selected support card, the site reports:

- effective specialty weight and preferred-training appearance probability;
- isolated rainbow marginal output;
- **Specialty EV** = preferred appearance probability × rainbow marginal output;
- **All-placement EV** = Specialty EV + non-rainbow marginal output across the other training rooms.

Both are shown in the comparison table and either can be the ranking metric. Specialty EV is the default because it directly answers “how much expected rainbow training output does this card create after accounting for 得意率?”. Friend and group supports have no specialty training at all, so All-placement EV is the only ranking that describes them.

Every ranking runs through per-stat weights, so a build that does not want Guts can stop crediting cards for producing it.

Three views sit on the same settings:

- the **per-click comparison**, an isolated-card model with a configurable number of anonymous supports sharing the click;
- the **run projection**, which follows one card's bond across a 56-turn career and reports what it produces, including when it starts rainbowing and where that bond estimate came from;
- the **deck projection**, which enumerates every way up to six selected supports can spread across the five training rooms each turn, assumes the player takes the best room, and prices each support by what the whole deck loses without it.

Support-event stat rewards, race bonuses, hints, energy converting into extra actions, and scenario links remain outside all three. Context-dependent unique effects are flagged in the UI rather than silently guessed.

## Data source

The deploy workflow downloads the current Global support-card export from [`Euophrys/umamusume-tierlist`](https://github.com/Euophrys/umamusume-tierlist), whose `gl.js` is generated from the Global game's `master.mdb`. The upstream project is MIT-licensed. Raw unique-effect metadata comes from [`niiyant/uma--guide`](https://github.com/niiyant/uma--guide); a build that cannot collect unique records for at least `--min-unique-rows` supports fails rather than publishing a dataset in which every card is silently missing its unique.

Card art and character portraits are copied into the deploy artifact by `--images`, so the published page serves its own images and only falls back to an upstream host for a file that could not be downloaded. `--images` must point at the site's `img/` directory, which is the path the page asks for.

The site does **not** need a backend. Every deploy (and a daily scheduled run) downloads and normalizes the upstream data into the GitHub Pages artifact.

## Model notes

The appearance model follows Euophrys' documented convention:

```text
specialtyWeight = (100 + cardSpecialty + globalSpecialty) × uniqueSpecialty × friendshipSpecialty
P(specialty) = specialtyWeight / (specialtyWeight + 4×100 + 50)
P(each off-type room) = 100 / same denominator
P(no training) = 50 / same denominator
```

`friendshipSpecialty` is a bonded-state effect, so it only enters the weight once the card is at 80 bond. Below that the card appears at its base rate, which is what the pre-rainbow phase of a run actually looks like.

Training output uses the same multiplicative structure as Euophrys' calculator. Grand Live late-run and summer base training values, its +20 global Specialty Priority, and its rainbow-only 1.4 multiplier are taken from the Global scenario configuration.

Two places deliberately diverge from upstream:

- **A card's marginal value is measured against the same click without it**, and that baseline keeps the trainee's own mood and growth multipliers. Upstream's solo-card branch subtracts the raw base gain instead, which credits every card with the trainee's mood and growth on top of its real contribution — an inflation proportional to the base gains of the card's training type, so it distorts comparisons across types and grows as mood and growth rise.
- **Bond timing is driven by how often the card is actually picked** (5 bond per selected training, plus a configurable trickle from outings and events) rather than by a fixed deck-wide bond rate. Specialty Priority therefore changes when a card starts rainbowing, which is the main thing the site exists to measure.

Euophrys flattens several context-dependent uniques into dedicated card fields (`crowd_bonus`, `highlander_*`, `fan_bonus`, `fs_ramp`). Each has a raw effect type that models the same mechanic, so the flattened value is used only when the card's raw metadata never declared that effect — never on top of it, and never while the card's unique is still locked at that limit break. `wisdom_recovery` has no training-output equivalent and is disclosed as outside the metric instead.

## GitHub Pages

The workflow at `.github/workflows/pages.yml` builds and deploys the site on pushes to `main`, on manual dispatch, and once daily to pick up upstream card updates.

If this is the repository's first Pages deployment, open **Settings → Pages → Build and deployment → Source** and select **GitHub Actions** once.

## Local development

Generate data and card art:

```bash
python3 scripts/sync_cards.py --output data/cards.json --images img
```

Then serve the repository root:

```bash
python3 scripts/serve.py --port 8000
```

Any static server works, as long as it sends `.mjs` as JavaScript — `python3 -m http.server` does not on every platform, which is the only thing `scripts/serve.py` fixes.

Run the tests:

```bash
npm test
```

`npm test` covers the model, the run and deck projections, the shared settings and share links, and the contract between `index.html`'s element ids and the modules that query them. `npm run test:python` covers the data sync.

## Disclaimer

This is an unofficial fan tool. Umamusume: Pretty Derby and its game data are the property of Cygames. Upstream data/model credit belongs to the contributors of Euophrys/umamusume-tierlist.
