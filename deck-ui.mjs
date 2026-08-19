import { STAT_NAMES, hasTrainingSpecialty, typeLabel } from "./app.mjs";
import { MAX_DECK_SIZE, calculateDeckProjection } from "./deck.mjs";
import { loadCards } from "./data.mjs";
import { SETTINGS_EVENT, readSharedSettings } from "./settings.mjs";
import {
  RENDER_DELAY_MS,
  cardImageMarkup,
  formatNumber as fmt,
  htmlEscape,
  lbLabel,
  readSelectedCards,
  revealResultsPanel,
} from "./view-model.mjs";

function thumb(card) {
  return cardImageMarkup(card, { small: true });
}

function initDeckView() {
  const body = document.querySelector("#deck-body");
  const wrap = document.querySelector("#deck-results");
  const totals = document.querySelector("#deck-totals");
  const note = document.querySelector("#deck-note");
  const selectedRoot = document.querySelector("#selected-cards");
  if (!body || !wrap || !totals || !note || !selectedRoot) return;
  let payload = null;
  let timer = null;

  function render() {
    const selected = readSelectedCards(payload, selectedRoot);
    if (selected.length < 2) {
      wrap.hidden = true;
      body.innerHTML = "";
      totals.innerHTML = "";
      return;
    }
    const deck = selected.slice(0, MAX_DECK_SIZE);
    const options = readSharedSettings(document);
    const projection = calculateDeckProjection(deck, options);
    const rows = projection.members
      .slice()
      .sort((a, b) => (b.marginalScore ?? 0) - (a.marginalScore ?? 0));

    totals.innerHTML = `<div class="stat-vector">${STAT_NAMES.map(
      (name, stat) =>
        `<div class="stat-cell"><span>${name}</span><strong>${fmt(projection.vector[stat], 1)}</strong></div>`,
    ).join("")}<div class="stat-cell deck-total-cell"><span>Weighted total</span><strong>${fmt(projection.score, 1)}</strong></div><div class="stat-cell deck-total-cell"><span>From these supports</span><strong>+${fmt(projection.supportScore, 1)}</strong></div></div>`;

    body.innerHTML = rows
      .map((member, index) => {
        const card = member.card;
        const marginal =
          member.marginalScore === undefined ? "—" : fmt(member.marginalScore, 1);
        const bondMeta = !hasTrainingSpecialty(card)
          ? "no specialty room"
          : member.daysToBond >= projection.trainingTurns
            ? "never reaches rainbow bond"
            : `bonds ≈ T${fmt(member.daysToBond, 1)}`;
        return `<tr data-card-type="${card.type}"><td class="rank">${index + 1}</td><td><div class="career-support">${thumb(card)}<div class="career-support-copy"><div class="name-row"><div class="career-card-name">${htmlEscape(card.char_name)}</div></div><div class="career-card-meta">${htmlEscape(typeLabel(card))} · ${lbLabel(card.limit_break)} · ${bondMeta} · picked ≈ ${fmt(member.selectionTurns, 1)} turns · rainbows ≈ ${fmt(member.rainbowTurns, 1)}</div></div></div></td><td class="${index === 0 ? "best" : ""}"><div class="metric-main">${marginal}</div><div class="metric-sub">weighted stats lost if dropped</div></td></tr>`;
      })
      .join("");

    note.textContent =
      selected.length > MAX_DECK_SIZE
        ? `Showing the first ${MAX_DECK_SIZE} selected supports; a deck holds ${MAX_DECK_SIZE}.`
        : `${deck.length} of ${MAX_DECK_SIZE} deck slots · ${projection.deckTypes} training types · ${projection.runLabel}`;
    wrap.hidden = false;
  }

  function queueRender() {
    clearTimeout(timer);
    timer = setTimeout(render, RENDER_DELAY_MS);
  }

  loadCards()
    .then((data) => {
      payload = data;
      render();
      new MutationObserver(queueRender).observe(selectedRoot, {
        childList: true,
        subtree: true,
        attributes: true,
      });
      selectedRoot.addEventListener("change", queueRender);
      document.addEventListener(SETTINGS_EVENT, queueRender);
    })
    .catch((error) => {
      console.error("Deck projection data failed to load", error);
      revealResultsPanel();
      wrap.hidden = false;
      body.innerHTML = `<tr><td colspan="3" class="career-error">Deck projection data failed to load.</td></tr>`;
    });
}

if (typeof document !== "undefined") initDeckView();
