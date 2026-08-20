import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  ALL_SETTING_IDS,
  SETTING_IDS,
  applySettingValues,
  collectSettingValues,
  readSharedSettings,
} from "../settings.mjs";
import { portraitImageUrl, supportImageUrl } from "../app.mjs";
import { decodeShareState, encodeShareState } from "../share.mjs";
import { loadCards, resetCardCache } from "../data.mjs";
import {
  buildGroups,
  cardFor,
  cardImageMarkup,
  cardSearchText,
  lbLabel,
  maxLimitBreak,
  restoreSelected,
  searchGroups,
} from "../view-model.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(join(root, "index.html"), "utf-8");
const moduleSources = readdirSync(root)
  .filter((name) => name.endsWith(".mjs"))
  .map((name) => ({ name, source: readFileSync(join(root, name), "utf-8") }));

function declaredIds(text) {
  return new Set(
    [...text.matchAll(/id="([^"$]+)"/g)].map((match) => match[1]),
  );
}

/** Ids the page ships, plus the ones the view builds at runtime. */
function availableIds() {
  const ids = declaredIds(html);
  for (const { source } of moduleSources)
    for (const match of source.matchAll(/id="([a-z-]+)-\$\{(?:i|index)\}"/g))
      for (let index = 0; index < 5; index++) ids.add(`${match[1]}-${index}`);
  return ids;
}

// A renamed element id is silently swallowed by `querySelector(...)?.value`, so
// the contract between the markup and the modules is asserted directly.
test("every element id the modules query actually exists", () => {
  const ids = availableIds();
  const missing = [];
  let checked = 0;
  for (const { name, source } of moduleSources) {
    for (const match of source.matchAll(/querySelector(?:All)?\(\s*"([^"]+)"/g)) {
      // A wiring call can pass a comma-separated list; every id in it counts.
      for (const selector of match[1].split(",").map((part) => part.trim())) {
        if (!selector.startsWith("#") || selector.includes(" ")) continue;
        checked += 1;
        if (!ids.has(selector.slice(1))) missing.push(`${name} → ${selector}`);
      }
    }
  }
  assert.deepEqual(missing, []);
  // Guards the regexes above: if they stop matching, the test must not pass by
  // checking nothing.
  assert.ok(checked > 25, `only ${checked} selectors were checked`);
});

// Importing every module link-checks it: a typo'd import name or a symbol that
// no longer exists is a load-time error, and the page loads these directly with
// no bundler in front of them to catch it.
test("every module the page loads links cleanly", async () => {
  const names = moduleSources.map(({ name }) => name);
  assert.ok(names.includes("app-ui.mjs") && names.includes("deck-ui.mjs"));
  for (const name of names)
    await assert.doesNotReject(
      () => import(`../${name}`),
      `${name} failed to load`,
    );
});

// An unbalanced or crossed tag closes a section early and silently drops
// everything after it, which no id check would notice.
test("the page's container tags nest correctly", () => {
  const tracked = new Set(["div", "section", "details", "label", "table", "p", "tbody", "thead", "tr"]);
  const withoutComments = html.replace(/<!--[\s\S]*?-->/g, "");
  const stack = [];
  let depth = 0;
  for (const match of withoutComments.matchAll(/<(\/?)([a-z]+)(\s[^>]*)?>/g)) {
    const [, closing, tag] = match;
    if (!tracked.has(tag)) continue;
    if (!closing) {
      stack.push(tag);
      depth = Math.max(depth, stack.length);
      continue;
    }
    assert.equal(
      stack.pop(),
      tag,
      `</${tag}> closes the wrong element around index ${match.index}`,
    );
  }
  assert.deepEqual(stack, [], "unclosed elements remain open");
  assert.ok(depth > 5, "expected the page structure to actually be walked");
});

test("every shared setting id exists in the page", () => {
  const ids = availableIds();
  const missing = ALL_SETTING_IDS.filter((id) => !ids.has(id));
  assert.deepEqual(missing, []);
  assert.ok(SETTING_IDS.includes("rank-metric"));
});

// The page renders card art from three modules; all of them must ask for the
// artifact's own copy and fall back to the upstream host, or a missing file is
// a broken image instead of a slower one.
test("card art markup points at the local copy and falls back upstream", () => {
  const local = cardImageMarkup({ id: 30028 });
  assert.ok(local.includes('src="./img/support_card_s_30028.png"'));
  assert.match(local, /onerror="this\.onerror=null;this\.src='https:\/\/[^']+30028\.png'"/);
  assert.ok(local.includes('loading="lazy"'));

  // The portrait option is retired: support-card art is used everywhere, even
  // when a card carries a portrait_url.
  const cardWithPortrait = cardImageMarkup(
    { id: 30028, portrait_url: "./img/portrait_30028.png" },
    { portrait: true, small: true },
  );
  assert.ok(cardWithPortrait.includes('src="./img/support_card_s_30028.png"'));
  assert.ok(cardWithPortrait.includes("small"));
  assert.match(cardWithPortrait, /this\.src='https:\/\//);

  for (const { name, source } of moduleSources.filter(({ name }) =>
    ["app-ui.mjs", "career.mjs", "deck-ui.mjs"].includes(name),
  ))
    assert.ok(
      source.includes("cardImageMarkup"),
      `${name} should build card art through the shared helper`,
    );
});

// The sync writes files the page then asks for by name. The two sides are
// separate literals in two languages, so a rename on either side is a silent
// 404 for every image unless something ties them together.
test("the sync's image paths are the paths the page requests", () => {
  const sync = readFileSync(join(root, "scripts", "sync_cards.py"), "utf-8");
  const constant = (name) =>
    sync.match(new RegExp(`^${name}="([^"]+)"`, "m"))?.[1];

  const prefix = constant("IMAGE_WEB_PREFIX");
  const supportName = constant("SUPPORT_IMAGE_NAME");
  assert.ok(prefix && supportName, "sync constants not found");

  const cardId = 30028;
  const expectedSupport = prefix + supportName.replace("{card_id}", cardId);
  assert.equal(supportImageUrl(cardId), expectedSupport);
  assert.equal(
    portraitImageUrl({ id: cardId, portrait_url: prefix + "portrait_x.png" }),
    expectedSupport,
    "portrait_url is ignored; support card art is used everywhere",
  );
});

function fakeElement(value, type = "text") {
  return { value: String(value), type, checked: value !== false };
}

function fakeDocument(values) {
  const map = new Map(Object.entries(values));
  return {
    querySelector(selector) {
      return map.get(selector.replace("#", "")) || null;
    },
  };
}

test("shared settings fall back to profile defaults when controls are absent", () => {
  const settings = readSharedSettings(fakeDocument({}));
  assert.equal(settings.profile, "gl-late");
  assert.equal(settings.globalSpecialty, 20);
  assert.equal(settings.spWeight, 1.2);
  assert.equal(settings.facilityLevel, 5);
  assert.deepEqual(settings.statWeights, [1, 1, 1, 1, 1]);
  assert.deepEqual(settings.growth, [1, 1, 1, 1, 1, 1]);
  assert.equal(settings.rankMetric, "specialty");
});

test("shared settings read every control the views depend on", () => {
  const settings = readSharedSettings(
    fakeDocument({
      "training-profile": fakeElement("unity-late"),
      "global-spec": fakeElement(35),
      motivation: fakeElement(0.1),
      "sp-weight": fakeElement(0.8),
      "facility-level": fakeElement(9),
      "facility-pace": fakeElement(50),
      "supports-on-training": fakeElement(3),
      "deck-types": fakeElement(4),
      fans: fakeElement(50000),
      "max-energy": fakeElement(120),
      "current-energy": fakeElement(60),
      "passive-bond": fakeElement(2),
      "rank-metric": fakeElement("allPlacement"),
      "growth-0": fakeElement(20),
      "stat-weight-3": fakeElement(0),
      "include-initial-stats": { type: "checkbox", checked: false },
    }),
  );
  assert.equal(settings.profile, "unity-late");
  assert.equal(settings.globalSpecialty, 35);
  assert.equal(settings.motivation, 0.1);
  assert.equal(settings.spWeight, 0.8);
  assert.equal(settings.facilityLevel, 5, "facility level is clamped");
  assert.equal(settings.supportsOnTraining, 3);
  assert.equal(settings.deckTypes, 4);
  assert.equal(settings.fans, 50000);
  assert.equal(settings.maxEnergy, 120);
  assert.equal(settings.currentEnergy, 60);
  assert.equal(settings.passiveBondPerTurn, 2);
  assert.equal(settings.rankMetric, "allPlacement");
  assert.equal(settings.growth[0], 1.2);
  assert.deepEqual(settings.statWeights, [1, 1, 1, 0, 1]);
  assert.equal(settings.includeInitialStats, false);
});

test("an unknown rank metric or profile falls back instead of breaking", () => {
  const settings = readSharedSettings(
    fakeDocument({
      "rank-metric": fakeElement("nonsense"),
      "training-profile": fakeElement("no-such-profile"),
    }),
  );
  assert.equal(settings.rankMetric, "specialty");
  assert.equal(settings.profile, "gl-late");
});

test("setting values round-trip through collect and apply", () => {
  const source = fakeDocument({
    "sp-weight": fakeElement(1.4),
    "growth-2": fakeElement(15),
    "include-initial-stats": { type: "checkbox", checked: false },
  });
  const values = collectSettingValues(source);
  assert.equal(values["sp-weight"], "1.4");
  assert.equal(values["include-initial-stats"], false);

  const target = fakeDocument({
    "sp-weight": fakeElement(1.2),
    "growth-2": fakeElement(0),
    "include-initial-stats": { type: "checkbox", checked: true },
  });
  applySettingValues(target, values);
  assert.equal(target.querySelector("#sp-weight").value, "1.4");
  assert.equal(target.querySelector("#growth-2").value, "15");
  assert.equal(target.querySelector("#include-initial-stats").checked, false);
});

test("share links carry selection and settings both ways", () => {
  const state = {
    selected: [
      { id: 30028, lb: 4 },
      { id: 30112, lb: 2 },
    ],
    settings: { "sp-weight": "1.4", "include-initial-stats": false },
    includeFuture: true,
  };
  const hash = encodeShareState(state);
  assert.ok(hash.startsWith("s="));
  const decoded = decodeShareState(`#${hash}`);
  assert.deepEqual(decoded.selected, state.selected);
  assert.deepEqual(decoded.settings, state.settings);
  assert.equal(decoded.includeFuture, true);
});

test("a malformed or absent share link is ignored", () => {
  assert.equal(decodeShareState(""), null);
  assert.equal(decodeShareState("#other=1"), null);
  assert.equal(decodeShareState("#s=not-base64!!"), null);
  assert.equal(decodeShareState("#s=" + btoa("[1,2,3]")).selected.length, 0);
});

test("the dataset is fetched once and shared by every view", async () => {
  resetCardCache();
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return { ok: true, json: async () => ({ cards: [] }) };
  };
  const [first, second] = await Promise.all([
    loadCards(fetchImpl),
    loadCards(fetchImpl),
  ]);
  await loadCards(fetchImpl);
  assert.equal(calls, 1);
  assert.equal(first, second);
  resetCardCache();
});

test("a failed load is not cached as a permanent failure", async () => {
  resetCardCache();
  let calls = 0;
  const failing = async () => {
    calls += 1;
    return { ok: false, status: 404 };
  };
  await assert.rejects(() => loadCards(failing), /HTTP 404/);
  await assert.rejects(() => loadCards(failing), /HTTP 404/);
  assert.equal(calls, 2);
  resetCardCache();
});

const cards = [
  { id: 1, limit_break: 0, type: 0, rarity: 3, char_name: "Alpha", title: "Runner" },
  { id: 1, limit_break: 4, type: 0, rarity: 3, char_name: "Alpha", title: "Runner" },
  { id: 2, limit_break: 4, type: 6, rarity: 1, char_name: "Beta", future: true },
];

test("groups collapse limit breaks under one support id", () => {
  const groups = buildGroups(cards);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].id, 2);
  assert.equal(maxLimitBreak(groups[1]), 4);
  assert.equal(cardFor(groups, { id: 1, lb: 0 }).limit_break, 0);
  assert.equal(cardFor(groups, { id: 1, lb: 9 }).limit_break, 4);
  assert.equal(cardFor(groups, { id: 404, lb: 0 }), null);
  assert.equal(lbLabel(4), "MLB");
  assert.equal(lbLabel(2), "LB2");
});

test("search matches name, title, id, type, and rarity", () => {
  const groups = buildGroups(cards);
  assert.equal(searchGroups(groups, "alpha").length, 1);
  assert.equal(searchGroups(groups, "runner").length, 1);
  assert.equal(searchGroups(groups, "ssr").length, 1);
  assert.equal(searchGroups(groups, "speed").length, 1);
  assert.equal(searchGroups(groups, "").length, 0);
  assert.equal(searchGroups(groups, "beta").length, 0, "future cards are hidden");
  assert.equal(searchGroups(groups, "beta", { includeFuture: true }).length, 1);
  assert.equal(searchGroups(groups, "alpha", { exclude: [1] }).length, 0);
  assert.ok(cardSearchText(cards[2]).includes("friend"));
});

test("restoring a selection drops what the dataset no longer has", () => {
  const groups = buildGroups(cards);
  const restored = restoreSelected(groups, [
    { id: 1, lb: 0 },
    { id: 1, lb: 4 },
    { id: 404, lb: 4 },
    { id: 2, lb: 9 },
  ]);
  assert.deepEqual(restored, [
    { id: 1, lb: 0 },
    { id: 2, lb: 4 },
  ]);
  assert.deepEqual(restoreSelected(groups, null), []);
});
