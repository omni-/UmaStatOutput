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
import { decodeShareState, encodeShareState } from "../share.mjs";
import { loadCards, resetCardCache } from "../data.mjs";
import {
  buildGroups,
  cardFor,
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
    for (const match of source.matchAll(/querySelector(?:All)?\(\s*"#([^"]+)"/g)) {
      const selector = match[1];
      if (selector.includes(" ") || selector.includes(",")) continue;
      checked += 1;
      if (!ids.has(selector)) missing.push(`${name} → #${selector}`);
    }
  }
  assert.deepEqual(missing, []);
  // Guards the regexes above: if they stop matching, the test must not pass by
  // checking nothing.
  assert.ok(checked > 20, `only ${checked} selectors were checked`);
  assert.ok(ids.has("growth-4") && ids.has("stat-weight-4"));
});

// An unbalanced tag closes a section early and silently drops everything after
// it, which no id check would notice.
test("the page's container tags are balanced", () => {
  for (const tag of ["div", "section", "details", "label", "table", "p"]) {
    const open = [...html.matchAll(new RegExp(`<${tag}[\\s>]`, "g"))].length;
    const close = [...html.matchAll(new RegExp(`</${tag}>`, "g"))].length;
    assert.equal(close, open, `<${tag}> is unbalanced`);
  }
});

test("every shared setting id exists in the page", () => {
  const ids = availableIds();
  const missing = ALL_SETTING_IDS.filter((id) => !ids.has(id));
  assert.deepEqual(missing, []);
  assert.ok(SETTING_IDS.includes("rank-metric"));
});

test("multi-element selectors used for wiring resolve to real ids", () => {
  const ids = availableIds();
  const [, selectorList] =
    moduleSources
      .find(({ name }) => name === "app-ui.mjs")
      .source.match(/querySelectorAll\(\s*\n?\s*"(#motivation[^"]+)"/) || [];
  assert.ok(selectorList, "expected the settings wiring selector list");
  for (const selector of selectorList.split(",").map((part) => part.trim()))
    assert.ok(ids.has(selector.slice(1)), `${selector} is not in the page`);
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
