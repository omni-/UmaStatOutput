import {
  RARITY_NAMES,
  portraitImageUrl,
  remoteSupportImageUrl,
  supportImageUrl,
  typeLabel,
} from "./app.mjs";

export const MAX_SELECTED_CARDS = 10;

export function rarityLabel(card) {
  return RARITY_NAMES[card.rarity] || `R${card.rarity}`;
}

export function lbLabel(lb) {
  return Number(lb) === 4 ? "MLB" : `LB${lb}`;
}

export function cardSearchText(card) {
  return `${card.char_name} ${card.title || ""} ${card.id} ${typeLabel(card)} ${rarityLabel(card)}`
    .toLowerCase();
}

/** One entry per support id, holding every limit break that id has data for. */
export function buildGroups(cards) {
  const map = new Map();
  for (const card of cards) {
    if (!map.has(card.id))
      map.set(card.id, { id: card.id, lbs: new Map(), sample: card });
    map.get(card.id).lbs.set(card.limit_break, card);
  }
  return [...map.values()].sort((a, b) => b.id - a.id);
}

export function maxLimitBreak(group) {
  return Math.max(...group.lbs.keys());
}

export function findGroup(groups, id) {
  return groups.find((group) => group.id === Number(id));
}

export function cardFor(groups, selection) {
  const group = findGroup(groups, selection?.id);
  if (!group) return null;
  return group.lbs.get(Number(selection.lb)) || group.lbs.get(maxLimitBreak(group));
}

export function searchGroups(groups, query, { includeFuture = false, exclude = [] } = {}) {
  const needle = String(query || "").trim().toLowerCase();
  if (!needle) return [];
  const excluded = new Set(exclude.map(Number));
  return groups
    .filter(
      (group) =>
        !excluded.has(group.id) &&
        (!group.sample.future || includeFuture) &&
        cardSearchText(group.sample).includes(needle),
    )
    .slice(0, 20);
}

/** Drops selections the dataset no longer has, de-duplicates, and clamps size. */
export function restoreSelected(groups, saved) {
  if (!Array.isArray(saved)) return [];
  const restored = [];
  for (const raw of saved) {
    const id = Number(raw?.id);
    const group = findGroup(groups, id);
    if (!group || restored.some((item) => item.id === id)) continue;
    const requestedLb = Number(raw?.lb);
    restored.push({
      id,
      lb: group.lbs.has(requestedLb) ? requestedLb : maxLimitBreak(group),
    });
    if (restored.length === MAX_SELECTED_CARDS) break;
  }
  return restored;
}

/**
 * The cards the selection panel currently holds, in display order, resolved
 * from the dataset at the limit break each row's picker is showing.
 */
export function readSelectedCards(payload, root) {
  if (!payload || !root) return [];
  const byIdLb = new Map(
    payload.cards.map((card) => [`${card.id}:${card.limit_break}`, card]),
  );
  const cards = [];
  root.querySelectorAll("select[data-lb-id]").forEach((select) => {
    const card = byIdLb.get(
      `${Number(select.dataset.lbId)}:${Number(select.value)}`,
    );
    if (card) cards.push(card);
  });
  return cards;
}

// How long the run and deck views wait before re-rendering. Both integrate a
// whole career per card, and one interaction can trigger several notifications.
export const RENDER_DELAY_MS = 120;

/**
 * The run and deck sections live inside the results panel, which stays hidden
 * until there is something to show — so a view that needs to report a failure
 * has to open the panel first or its message is never seen.
 */
export function revealResultsPanel(root = document) {
  const results = root.querySelector("#results");
  const empty = root.querySelector("#results-empty");
  if (results) results.hidden = false;
  if (empty) empty.hidden = true;
}

export function htmlEscape(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/**
 * Card art built once for all three views: the artifact's own copy, with the
 * upstream host as the fallback for any file the sync could not download.
 */
export function cardImageMarkup(card, { portrait = false, small = false } = {}) {
  const source = portrait ? portraitImageUrl(card) : supportImageUrl(card.id);
  const fallback = remoteSupportImageUrl(card.id);
  const wrapperClass = `accent-card-thumb${portrait ? " portrait-card-thumb" : ""}${small ? " small" : ""}`;
  const imageClass = `card-thumb${portrait ? " portrait-thumb" : ""}`;
  return `<div class="${wrapperClass}"><img class="${imageClass}" src="${htmlEscape(source)}" alt="" loading="lazy" onerror="this.onerror=null;this.src='${htmlEscape(fallback)}'" /></div>`;
}

export function formatNumber(value, digits = 2) {
  return Number(value).toFixed(digits);
}

export function formatPercent(value) {
  return `${(Number(value) * 100).toFixed(2)}%`;
}
