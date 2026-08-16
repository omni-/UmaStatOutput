# Uma Stat Output

A tiny static calculator for comparing **Umamusume support cards by placement-weighted training output**.

Most support-card calculators show how strong a training click is *after the card is already there*. That can hide a meaningful difference between cards with different **Specialty Priority / 得意率**, especially in scenarios such as **Grand Live**, which adds a global Specialty Priority bonus.

## What it calculates

For each selected five-training-type support card, the site reports:

- effective specialty weight and preferred-training appearance probability;
- isolated rainbow marginal output;
- **Specialty EV** = preferred appearance probability × rainbow marginal output;
- **All-placement EV** = Specialty EV + non-rainbow marginal output across the other four training rooms.

The default ranking is Specialty EV because it directly answers “how much expected rainbow training output does this card create after accounting for 得意率?”

This is deliberately **not** a full career/deck simulator. Multi-card friendship multiplication, bond timing, support events, race bonuses, scenario-specific turn choice, and other cards' placement are outside the v1 model. Context-dependent unique effects are flagged in the UI rather than silently guessed.

## Data source

The deploy workflow downloads the current Global support-card export from [`Euophrys/umamusume-tierlist`](https://github.com/Euophrys/umamusume-tierlist), whose `gl.js` is generated from the Global game's `master.mdb`. The upstream project is MIT-licensed.

The site does **not** need a backend. Every deploy (and a daily scheduled run) downloads and normalizes the upstream data into the GitHub Pages artifact.

## Model notes

The appearance model follows Euophrys' documented convention:

```text
specialtyWeight = (100 + cardSpecialty + globalSpecialty) × uniqueSpecialty × friendshipSpecialty
P(specialty) = specialtyWeight / (specialtyWeight + 4×100 + 50)
P(each off-type room) = 100 / same denominator
P(no training) = 50 / same denominator
```

Training output uses the same isolated-card multiplicative structure as Euophrys' calculator. Grand Live late-run and summer base training values are taken from its Global scenario configuration.

## GitHub Pages

The workflow at `.github/workflows/pages.yml` builds and deploys the site on pushes to `main`, on manual dispatch, and once daily to pick up upstream card updates.

If this is the repository's first Pages deployment, open **Settings → Pages → Build and deployment → Source** and select **GitHub Actions** once.

## Local development

Generate data:

```bash
mkdir -p data
python3 scripts/sync_cards.py --output data/cards.json
```

Then serve the repository root with any static HTTP server, for example:

```bash
python3 -m http.server 8000
```

Run the math tests with:

```bash
node --test tests/math.test.mjs
```

## Disclaimer

This is an unofficial fan tool. Umamusume: Pretty Derby and its game data are the property of Cygames. Upstream data/model credit belongs to the contributors of Euophrys/umamusume-tierlist.
