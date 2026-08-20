import {
  GLOBAL_UNIQUE_COVERAGE,
  STAT_NAMES,
  STORAGE_KEY,
  TRAINING_PROFILES,
  calculateCardEV,
  clampFacilityLevel,
  hasFacilityLevelUnique,
  turnsPerFacilityLevel,
  typeLabel,
  uniqueModelWarnings,
} from "./app.mjs";
import { loadCards } from "./data.mjs";
import {
  DEFAULT_SETTING_VALUES,
  applySettingValues,
  collectSettingValues,
  emitSettingsChanged,
  readSharedSettings,
} from "./settings.mjs";
import { decodeShareState, encodeShareState } from "./share.mjs";
import {
  MAX_SELECTED_CARDS,
  buildGroups,
  cardFor,
  cardImageMarkup,
  findGroup,
  formatNumber as fmt,
  formatPercent as pct,
  htmlEscape,
  lbLabel,
  maxLimitBreak,
  rarityLabel,
  restoreSelected,
  searchGroups,
} from "./view-model.mjs";

const GROWTH_NAMES = ["Speed", "Stamina", "Power", "Guts", "Wit"];

function cardTitle(card) {
  return card.title ? `[${card.title}]` : "";
}
function titleMarkup(card, className = "card-titleline") {
  return card.title
    ? `<div class="${className}">${htmlEscape(cardTitle(card))}</div>`
    : "";
}
function rarityMarkup(card) {
  return `<span class="rarity-chip">${htmlEscape(rarityLabel(card))}</span>`;
}
function futureMarkup(card) {
  return card.future ? '<span class="future-chip">FUTURE</span>' : "";
}
function thumbMarkup(card, small = false) {
  return cardImageMarkup(card, { small });
}

function readStoredState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function initBrowser() {
  const els = {
    sourcePill: document.querySelector("#source-pill"),
    globalSpec: document.querySelector("#global-spec"),
    globalSpecRange: document.querySelector("#global-spec-range"),
    trainingProfile: document.querySelector("#training-profile"),
    motivation: document.querySelector("#motivation"),
    spWeight: document.querySelector("#sp-weight"),
    facilityLevel: document.querySelector("#facility-level"),
    facilityPace: document.querySelector("#facility-pace"),
    facilityPaceSummary: document.querySelector("#facility-pace-summary"),
    supportsOnTraining: document.querySelector("#supports-on-training"),
    rankMetric: document.querySelector("#rank-metric"),
    search: document.querySelector("#card-search"),
    searchResults: document.querySelector("#search-results"),
    selectedCards: document.querySelector("#selected-cards"),
    selectedCount: document.querySelector("#selected-count"),
    resetCards: document.querySelector("#reset-cards"),
    includeFuture: document.querySelector("#include-future"),
    results: document.querySelector("#results"),
    resultsEmpty: document.querySelector("#results-empty"),
    resultsBody: document.querySelector("#results-body"),
    resultDetails: document.querySelector("#result-details"),
    growthGrid: document.querySelector("#growth-grid"),
    statWeightGrid: document.querySelector("#stat-weight-grid"),
    resetSettings: document.querySelector("#reset-settings"),
    shareButton: document.querySelector("#share-link"),
    shareStatus: document.querySelector("#share-status"),
  };
  if (!els.selectedCards || !els.resultsBody) return;

  const state = { payload: null, groups: [], selected: [], activeDetailId: null };
  const shared = decodeShareState(location.hash);
  const stored = shared || readStoredState();
  // A share link seeds this visit and is then spent: leaving it in the address
  // bar would make every later edit vanish on the next reload.
  if (shared)
    history.replaceState(null, "", location.pathname + location.search);

  els.includeFuture.checked = Boolean(stored?.includeFuture);
  els.search.placeholder = "Search title, character, or support ID…";
  els.growthGrid.innerHTML = GROWTH_NAMES.map(
    (name, i) =>
      `<div class="growth-field"><label for="growth-${i}">${name} %</label><input id="growth-${i}" data-growth-index="${i}" type="number" min="0" max="100" step="1" value="0" /></div>`,
  ).join("");
  els.statWeightGrid.innerHTML = GROWTH_NAMES.map(
    (name, i) =>
      `<div class="growth-field"><label for="stat-weight-${i}">${name} ×</label><input id="stat-weight-${i}" data-stat-weight-index="${i}" type="number" min="0" max="5" step="0.1" value="1" /></div>`,
  ).join("");

  function settings() {
    return readSharedSettings(document);
  }

  function persistState() {
    const payload = {
      selected: state.selected.map(({ id, lb }) => ({ id, lb })),
      settings: collectSettingValues(document),
      includeFuture: els.includeFuture.checked,
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {}
    return payload;
  }

  function syncSpecUI(value) {
    els.globalSpec.value = value;
    els.globalSpecRange.value = Math.max(0, Math.min(100, Number(value)));
    document.querySelectorAll("[data-spec-preset]").forEach((button) =>
      button.classList.toggle(
        "active",
        Number(button.dataset.specPreset) === Number(value),
      ),
    );
  }

  function updateFacilityPaceSummary() {
    const pace = Number(els.facilityPace.value || 100);
    const turns = turnsPerFacilityLevel(pace);
    els.facilityPaceSummary.textContent = `${pace}% · ~${turns.toFixed(1)} turns / level · Lv5 ~ T${Math.ceil(turns * 4)}`;
  }

  function applyProfileDefaults(profileKey) {
    const profile = TRAINING_PROFILES[profileKey] || TRAINING_PROFILES["gl-late"];
    syncSpecUI(profile.globalSpecialty);
    els.spWeight.value = String(profile.spWeight);
    els.facilityLevel.value = String(profile.facilityLevel);
    els.facilityPace.value = String(profile.facilityPace);
    updateFacilityPaceSummary();
  }

  function restoreSettings(saved) {
    const profileKey =
      saved?.["training-profile"] && TRAINING_PROFILES[saved["training-profile"]]
        ? saved["training-profile"]
        : "gl-late";
    els.trainingProfile.value = profileKey;
    applyProfileDefaults(profileKey);
    applySettingValues(document, saved);
    els.facilityLevel.value = String(clampFacilityLevel(els.facilityLevel.value));
    els.facilityPace.value = String(
      Math.max(25, Math.min(100, Number(els.facilityPace.value) || 100)),
    );
    syncSpecUI(els.globalSpec.value);
    updateFacilityPaceSummary();
  }

  restoreSettings(stored?.settings);

  function currentCard(selection) {
    return cardFor(state.groups, selection);
  }

  function renderSearch() {
    const matches = state.payload
      ? searchGroups(state.groups, els.search.value, {
          includeFuture: els.includeFuture.checked,
          exclude: state.selected.map((selection) => selection.id),
        })
      : [];
    if (!els.search.value.trim() || !state.payload) {
      els.searchResults.hidden = true;
      return;
    }
    if (!matches.length) {
      els.searchResults.innerHTML =
        '<div class="search-meta" style="padding:12px">No matching support cards.</div>';
      els.searchResults.hidden = false;
      return;
    }
    els.searchResults.innerHTML = matches
      .map((group) => {
        const card = group.lbs.get(maxLimitBreak(group)) || group.sample;
        return `<button class="search-result" type="button" data-add-id="${card.id}" data-card-type="${card.type}">${thumbMarkup(card)}<div>${titleMarkup(card, "search-titleline")}<div class="name-row"><div class="search-name">${htmlEscape(card.char_name)}</div>${rarityMarkup(card)}${futureMarkup(card)}</div><div class="search-meta">${htmlEscape(typeLabel(card))} · #${card.id} · LB0–${lbLabel(maxLimitBreak(group))}</div></div><div class="add-mark">＋</div></button>`;
      })
      .join("");
    els.searchResults.hidden = false;
  }

  function addCard(id) {
    if (
      state.selected.length >= MAX_SELECTED_CARDS ||
      state.selected.some((selection) => selection.id === id)
    )
      return;
    const group = findGroup(state.groups, id);
    if (!group) return;
    state.selected.push({ id, lb: maxLimitBreak(group) });
    els.search.value = "";
    els.searchResults.hidden = true;
    commit();
  }

  function removeCard(id) {
    state.selected = state.selected.filter((selection) => selection.id !== id);
    if (state.activeDetailId === id) state.activeDetailId = null;
    commit();
  }

  function renderSelected() {
    els.selectedCount.textContent = state.selected.length;
    if (!state.selected.length) {
      els.selectedCards.className = "selected-cards empty-state";
      els.selectedCards.textContent =
        "Search for a card above. Global cards are shown by default; enable Future cards to include supports currently available only in JP.";
      return;
    }
    els.selectedCards.className = "selected-cards";
    els.selectedCards.innerHTML = state.selected
      .map((selection) => {
        const group = findGroup(state.groups, selection.id);
        const card = currentCard(selection);
        const lbOptions = [...group.lbs.keys()]
          .sort((a, b) => a - b)
          .map(
            (lb) =>
              `<option value="${lb}" ${lb === selection.lb ? "selected" : ""}>${lbLabel(lb)}</option>`,
          )
          .join("");
        return `<div class="selected-card" data-card-type="${card.type}">${thumbMarkup(card)}<div style="min-width:0">${titleMarkup(card)}<div class="name-row"><div class="selected-title" title="${htmlEscape(card.char_name)}">${htmlEscape(card.char_name)}</div>${rarityMarkup(card)}${futureMarkup(card)}</div><div class="selected-meta"><span class="type-tag">${htmlEscape(typeLabel(card))}</span><select data-lb-id="${card.id}">${lbOptions}</select></div></div><button class="remove-card" data-remove-id="${card.id}" type="button" title="Remove">×</button></div>`;
      })
      .join("");
  }

  function evaluatedCards() {
    const options = settings();
    const rows = state.selected.map((selection) => {
      const card = currentCard(selection);
      return {
        card,
        ev: calculateCardEV(card, options),
        flags: uniqueModelWarnings(card, options.profile),
      };
    });
    const key =
      options.rankMetric === "allPlacement" ? "allPlacementScore" : "specialtyScore";
    rows.sort((a, b) => b.ev[key] - a.ev[key]);
    return rows;
  }

  function facilityUniqueMeta(card, ev) {
    if (!hasFacilityLevelUnique(card)) return "";
    return ` · Facility Lv${fmt(ev.facilityLevel, 0)} unique modeled`;
  }

  function renderDetails(row) {
    if (!row) {
      els.resultDetails.innerHTML = "";
      return;
    }
    const { card, ev, flags } = row;
    const warning = flags.length
      ? `<div class="warning-box"><strong>★ Unique not fully modeled:</strong> ${htmlEscape(flags.join(", "))}. The displayed value may omit or inherit an upstream approximation for that effect; treat it as provisional.</div>`
      : "";
    const specialtyCells = STAT_NAMES.map(
      (name, i) =>
        `<div class="stat-cell"><span>${name}</span><strong>${fmt(ev.specialtyVector[i])}</strong></div>`,
    ).join("");
    const allPlacementCells = STAT_NAMES.map(
      (name, i) =>
        `<div class="stat-cell"><span>${name}</span><strong>${fmt(ev.allPlacementVector[i])}</strong></div>`,
    ).join("");
    const specialtyHeading = ev.hasSpecialty
      ? `<div class="detail-ev-heading"><strong>Per-turn Specialty EV by stat</strong><span>Appearance-weighted average contribution on the card's own training.</span></div><div class="stat-vector">${specialtyCells}</div>`
      : `<div class="detail-ev-heading"><strong>No specialty training</strong><span>Friend and group supports have no preferred training, so all of their output is all-placement.</span></div>`;
    els.resultDetails.innerHTML = `<div class="detail-card" data-card-type="${card.type}"><div class="detail-top"><div>${titleMarkup(card)}<div class="name-row"><div class="detail-title">${htmlEscape(card.char_name)}</div>${rarityMarkup(card)}${futureMarkup(card)}</div><div class="search-meta">${htmlEscape(typeLabel(card))} · ${lbLabel(card.limit_break)} · #${card.id} · Specialty Priority ${fmt(card.specialty_rate, 0)} · Specialty Rate ${pct(ev.appearance.specialty)}${facilityUniqueMeta(card, ev)}</div></div><div class="formula-chip">#${card.id}</div></div>${specialtyHeading}<div class="detail-ev-heading"><strong>Per-turn All-placement EV by stat</strong><span>Adds what the card contributes on the other training rooms it appears in.</span></div><div class="stat-vector">${allPlacementCells}</div>${warning}</div>`;
  }

  function renderResults() {
    if (!state.selected.length) {
      els.results.hidden = true;
      els.resultsEmpty.hidden = false;
      els.resultDetails.innerHTML = "";
      return;
    }
    els.results.hidden = false;
    els.resultsEmpty.hidden = true;
    const options = settings();
    const rows = evaluatedCards();
    if (
      !state.activeDetailId ||
      !rows.some((row) => row.card.id === state.activeDetailId)
    )
      state.activeDetailId = rows[0]?.card.id;
    const bestMetric =
      options.rankMetric === "allPlacement" ? "allPlacementScore" : "specialtyScore";
    els.resultsBody.innerHTML = rows
      .map((row, index) => {
        const { card, ev, flags } = row;
        const best = (metric) =>
          index === 0 && metric === bestMetric ? " best" : "";
        return `<tr data-detail-id="${card.id}" class="${state.activeDetailId === card.id ? "active" : ""}" data-card-type="${card.type}"><td class="rank">${index + 1}</td><td><div class="result-support" data-card-type="${card.type}">${thumbMarkup(card, true)}<div>${titleMarkup(card, "result-titleline")}<div class="name-row"><div class="result-name">${htmlEscape(card.char_name)}${flags.length ? '<span class="warn-dot" title="Unique effect not fully modeled">★</span>' : ""}</div>${rarityMarkup(card)}${futureMarkup(card)}</div><div class="result-sub">${htmlEscape(typeLabel(card))} · ${lbLabel(card.limit_break)} · #${card.id}</div></div></div></td><td><div class="metric-main">${fmt(card.specialty_rate, 0)}</div><div class="metric-sub">得意率</div></td><td><div class="metric-main">${pct(ev.appearance.specialty)}</div><div class="metric-sub">preferred training appearance</div></td><td><div class="metric-main">+${fmt(ev.rainbowScore)}</div><div class="metric-sub">extra weighted stats</div></td><td class="${best("specialtyScore").trim()}"><div class="metric-main">${fmt(ev.specialtyScore)}</div><div class="metric-sub">weighted stats / turn</div></td><td class="${best("allPlacementScore").trim()}"><div class="metric-main">${fmt(ev.allPlacementScore)}</div><div class="metric-sub">every room it appears on</div></td></tr>`;
      })
      .join("");
    renderDetails(rows.find((row) => row.card.id === state.activeDetailId) || rows[0]);
  }

  function renderAll() {
    renderSelected();
    renderResults();
  }

  /**
   * Persist and re-render. Card selection reaches the other views through their
   * observer on the selected-cards container, so only an actual settings change
   * broadcasts — otherwise every add and remove would render them twice.
   */
  function commit({ settingsChanged = false } = {}) {
    persistState();
    if (settingsChanged) renderResults();
    else renderAll();
    if (settingsChanged) emitSettingsChanged(document);
  }

  els.search.addEventListener("input", renderSearch);
  els.search.addEventListener("focus", renderSearch);
  els.includeFuture.addEventListener("change", () => {
    persistState();
    renderSearch();
  });
  document.addEventListener("click", (event) => {
    const add = event.target.closest("[data-add-id]");
    if (add) addCard(Number(add.dataset.addId));
    const remove = event.target.closest("[data-remove-id]");
    if (remove) removeCard(Number(remove.dataset.removeId));
    const detail = event.target.closest("[data-detail-id]");
    if (detail) {
      state.activeDetailId = Number(detail.dataset.detailId);
      renderResults();
    }
    if (!event.target.closest(".search-wrap")) els.searchResults.hidden = true;
  });
  els.selectedCards.addEventListener("change", (event) => {
    const select = event.target.closest("[data-lb-id]");
    if (!select) return;
    const item = state.selected.find(
      (selection) => selection.id === Number(select.dataset.lbId),
    );
    if (item) item.lb = Number(select.value);
    commit();
  });

  function onSettingsChanged() {
    commit({ settingsChanged: true });
  }
  els.trainingProfile.addEventListener("input", () => {
    applyProfileDefaults(els.trainingProfile.value);
    onSettingsChanged();
  });
  document
    .querySelectorAll(
      "#motivation, #sp-weight, #facility-level, #supports-on-training, #deck-types, #fans, #max-energy, #current-energy, #passive-bond, #rank-metric, #include-initial-stats, #include-event-stats",
    )
    .forEach((el) => el.addEventListener("input", onSettingsChanged));
  els.facilityPace.addEventListener("input", () => {
    updateFacilityPaceSummary();
    onSettingsChanged();
  });
  document
    .querySelectorAll("[data-growth-index], [data-stat-weight-index]")
    .forEach((el) => el.addEventListener("input", onSettingsChanged));

  function setGlobalSpec(value) {
    syncSpecUI(value);
    onSettingsChanged();
  }
  els.globalSpec.addEventListener("input", () => setGlobalSpec(els.globalSpec.value));
  els.globalSpecRange.addEventListener("input", () =>
    setGlobalSpec(els.globalSpecRange.value),
  );
  document.querySelectorAll("[data-spec-preset]").forEach((button) =>
    button.addEventListener("click", () => setGlobalSpec(button.dataset.specPreset)),
  );

  els.resetSettings.addEventListener("click", () => {
    applySettingValues(document, DEFAULT_SETTING_VALUES);
    // The profile's own Specialty Priority, SP value, and facility settings
    // come from the preset rather than from the defaults map.
    applyProfileDefaults(els.trainingProfile.value);
    onSettingsChanged();
  });
  els.resetCards.addEventListener("click", () => {
    state.selected = [];
    state.activeDetailId = null;
    commit();
  });

  els.shareButton?.addEventListener("click", async () => {
    const setStatus = (message) => {
      if (!els.shareStatus) return;
      els.shareStatus.textContent = message;
      setTimeout(() => {
        els.shareStatus.textContent = "";
      }, 4000);
    };
    let url;
    try {
      url = `${location.origin}${location.pathname}${location.search}#${encodeShareState(persistState())}`;
    } catch (error) {
      console.error("Share link could not be built", error);
      setStatus("Link failed");
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setStatus("Link copied");
    } catch {
      // Clipboard access can be refused; the address bar is the fallback, and
      // the hash is consumed and cleared on the next load either way.
      location.hash = url.slice(url.indexOf("#") + 1);
      setStatus("Link is in the address bar");
    }
  });

  loadCards()
    .then((payload) => {
      state.payload = payload;
      state.groups = buildGroups(payload.cards);
      state.selected = restoreSelected(state.groups, stored?.selected);
      persistState();
      const date = payload.generated_at
        ? new Date(payload.generated_at).toLocaleDateString()
        : "current build";
      const globalCount = Number(
        payload.card_count || state.groups.filter((g) => !g.sample.future).length,
      );
      const futureCount = Number(
        payload.future_card_count || state.groups.filter((g) => g.sample.future).length,
      );
      const uniqueCoverage = Number(payload.unique_metadata_count || 0);
      const coverageNote = uniqueCoverage
        ? ` · ${uniqueCoverage} unique records`
        : " · unique metadata unavailable";
      els.sourcePill.textContent = `${globalCount} Global${futureCount ? ` · ${futureCount} future` : ""} · uniques through ${GLOBAL_UNIQUE_COVERAGE}${coverageNote} · synced ${date}`;
      els.sourcePill.classList.add("ready");
      renderAll();
      emitSettingsChanged(document);
    })
    .catch((error) => {
      console.error(error);
      els.sourcePill.textContent = "Support data failed to load";
      els.sourcePill.style.color = "var(--danger)";
      els.selectedCards.className = "selected-cards empty-state";
      els.selectedCards.textContent =
        "The generated card dataset is missing. Run the sync script or GitHub Pages workflow.";
    });
}

if (typeof document !== "undefined") initBrowser();
