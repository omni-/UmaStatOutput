export const STAT_NAMES = ["Speed", "Stamina", "Power", "Guts", "Wit", "SP"];
export const TYPE_NAMES = ["Speed", "Stamina", "Power", "Guts", "Wit"];
export const RARITY_NAMES = { 1: "R", 2: "SR", 3: "SSR" };

export const TRAINING_PROFILES = {
  "gl-late": {
    label: "Grand Live · late-run",
    globalSpecialty: 20,
    spWeight: 1.2,
    facilityLevel: 5,
    facilityPace: 100,
    gains: [
      [11, 0, 5, 0, 0, 2],
      [0, 9, 0, 6, 0, 2],
      [0, 4, 10, 0, 0, 2],
      [3, 0, 2, 10, 0, 2],
      [3, 0, 0, 0, 9, 3],
    ],
  },
  "gl-summer": {
    label: "Grand Live · summer",
    globalSpecialty: 20,
    spWeight: 1.2,
    facilityLevel: 5,
    facilityPace: 100,
    gains: [
      [12, 0, 6, 0, 0, 2],
      [0, 12, 0, 8, 0, 2],
      [0, 6, 13, 0, 0, 2],
      [3, 0, 3, 11, 0, 2],
      [4, 0, 0, 0, 10, 3],
    ],
  },
  "unity-late": {
    label: "Unity Cup · late-run",
    globalSpecialty: 0,
    spWeight: 1,
    facilityLevel: 5,
    facilityPace: 50,
    // Euophrys Aoharu/Unity Cup bonded-training values.
    gains: [
      [12, 0, 5, 0, 0, 4],
      [0, 12, 0, 7, 0, 4],
      [0, 5, 13, 0, 0, 4],
      [4, 0, 3, 10, 0, 4],
      [3, 0, 0, 0, 10, 5],
    ],
  },
};

const BASE_SPECIALTY_WEIGHT = 100;
const OFF_TRAINING_WEIGHT = 100;
const NO_TRAINING_WEIGHT = 50;
const SUPPORT_COUNT_BONUS = 0.05;
const STORAGE_KEY = "uma-stat-output:v1";

// Euophrys currently flattens Maruzensky 30107's facility-level unique into a
// fixed +15% Training Effectiveness (equivalent to facility Lv3). Keep the
// upstream number as the baseline, then replace only that baked approximation
// with the selected/estimated facility level.
const FACILITY_LEVEL_TRAINING_UNIQUES = {
  30107: { bakedLevel: 3, trainingBonusPerLevel: 0.05 },
};

function clampFacilityLevel(value) {
  return Math.max(1, Math.min(5, Number(value) || 1));
}

export function hasFacilityLevelUnique(card) {
  return Boolean(FACILITY_LEVEL_TRAINING_UNIQUES[Number(card?.id)]);
}

export function facilityTrainingBonus(card, facilityLevel = 3) {
  const upstream = Number(card.tb || 1);
  const unique = FACILITY_LEVEL_TRAINING_UNIQUES[Number(card.id)];
  if (!unique) return upstream;
  return (
    upstream +
    (clampFacilityLevel(facilityLevel) - unique.bakedLevel) *
      unique.trainingBonusPerLevel
  );
}

// The pace is a percentage of the "two core facilities" Grand Live model.
// At 100%, four clicks per facility means a level-up about every 8 training
// turns. Lower values stretch those milestones for slower-leveling scenarios.
export function turnsPerFacilityLevel(facilityPace = 100) {
  const pace = Math.max(25, Math.min(100, Number(facilityPace) || 100));
  return 8 * (100 / pace);
}

export function facilityLevelAtTurn(turn, facilityPace = 100) {
  const turnsPerLevel = turnsPerFacilityLevel(facilityPace);
  return Math.min(
    5,
    1 + Math.floor(Math.max(0, Number(turn) || 0) / turnsPerLevel),
  );
}

export function averageFacilityLevel(startTurn, endTurn, facilityPace = 100) {
  const start = Math.max(0, Number(startTurn) || 0);
  const end = Math.max(start, Number(endTurn) || 0);
  if (end <= start) return facilityLevelAtTurn(start, facilityPace);

  const turnsPerLevel = turnsPerFacilityLevel(facilityPace);
  let cursor = start;
  let weighted = 0;

  while (cursor < end) {
    const level = facilityLevelAtTurn(cursor, facilityPace);
    if (level >= 5) {
      weighted += (end - cursor) * 5;
      break;
    }
    const nextThreshold = level * turnsPerLevel;
    const segmentEnd = Math.min(end, nextThreshold);
    weighted += (segmentEnd - cursor) * level;
    cursor = segmentEnd;
  }

  return weighted / (end - start);
}

export function calculateAppearance(card, globalSpecialty = 0) {
  const specialtyWeight =
    (BASE_SPECIALTY_WEIGHT +
      Number(card.specialty_rate || 0) +
      Number(globalSpecialty || 0)) *
    Number(card.unique_specialty || 1) *
    Number(card.fs_specialty || 1);
  const denominator =
    specialtyWeight + OFF_TRAINING_WEIGHT * 4 + NO_TRAINING_WEIGHT;
  return {
    specialtyWeight,
    denominator,
    specialty: specialtyWeight / denominator,
    eachOff: OFF_TRAINING_WEIGHT / denominator,
    none: NO_TRAINING_WEIGHT / denominator,
  };
}

export function calculateMarginalTraining(card, trainingType, options = {}) {
  const gains =
    options.gains || TRAINING_PROFILES["gl-late"].gains[trainingType];
  const motivation = Number(options.motivation ?? 0.2);
  const growth = options.growth || [1, 1, 1, 1, 1, 1];
  const rainbow = Boolean(options.rainbow);
  const facilityLevel = Number(options.facilityLevel ?? 3);

  let trainingBonus = facilityTrainingBonus(card, facilityLevel);
  let motivationBonus = Number(card.mb || 1);
  let friendshipBonus = 1;
  if (rainbow) {
    trainingBonus += Number(card.fs_training || 0);
    motivationBonus += Number(card.fs_motivation || 0);
    friendshipBonus =
      Number(card.fs_bonus || 1) * Number(card.unique_fs_bonus || 1);
  }

  const result = new Array(6).fill(0);
  for (let stat = 0; stat < 6; stat++) {
    if (!gains[stat]) continue;
    let base = Number(gains[stat]) + Number(card.stat_bonus?.[stat] || 0);
    if (rainbow) base += Number(card.fs_stats?.[stat] || 0);
    const withCard =
      base *
      trainingBonus *
      (1 + motivation * motivationBonus) *
      friendshipBonus *
      (1 + SUPPORT_COUNT_BONUS) *
      Number(growth[stat] || 1);
    result[stat] = withCard - Number(gains[stat]);
  }
  return result;
}

export function weightedSum(vector, spWeight = 1.2) {
  return vector.reduce(
    (sum, value, index) => sum + value * (index === 5 ? spWeight : 1),
    0,
  );
}

export function calculateCardEV(card, options = {}) {
  const profile =
    TRAINING_PROFILES[options.profile || "gl-late"] ||
    TRAINING_PROFILES["gl-late"];
  const globalSpecialty = Number(
    options.globalSpecialty ?? profile.globalSpecialty,
  );
  const motivation = Number(options.motivation ?? 0.2);
  const growth = options.growth || [1, 1, 1, 1, 1, 1];
  const spWeight = Number(options.spWeight ?? profile.spWeight ?? 1.2);
  const facilityLevel = clampFacilityLevel(
    options.facilityLevel ?? profile.facilityLevel ?? 3,
  );
  const appearance = calculateAppearance(card, globalSpecialty);
  const rainbowMarginal = calculateMarginalTraining(card, card.type, {
    gains: profile.gains[card.type],
    motivation,
    growth,
    rainbow: true,
    facilityLevel,
  });
  const specialtyVector = rainbowMarginal.map(
    (value) => value * appearance.specialty,
  );
  const offVector = new Array(6).fill(0);

  for (let trainingType = 0; trainingType < 5; trainingType++) {
    if (trainingType === card.type) continue;
    const marginal = calculateMarginalTraining(card, trainingType, {
      gains: profile.gains[trainingType],
      motivation,
      growth,
      rainbow: false,
      facilityLevel,
    });
    for (let stat = 0; stat < 6; stat++) {
      offVector[stat] += marginal[stat] * appearance.eachOff;
    }
  }

  const allPlacementVector = specialtyVector.map(
    (value, index) => value + offVector[index],
  );
  return {
    appearance,
    facilityLevel,
    rainbowMarginal,
    specialtyVector,
    offVector,
    allPlacementVector,
    rainbowScore: weightedSum(rainbowMarginal, spWeight),
    specialtyScore: weightedSum(specialtyVector, spWeight),
    allPlacementScore: weightedSum(allPlacementVector, spWeight),
  };
}

function conditionalFlags(card) {
  const flags = [];
  if ((card.fs_ramp?.[0] || 0) !== 0) flags.push("ramping friendship unique");
  if ((card.crowd_bonus || 0) !== 0)
    flags.push("crowd-size training unique");
  if ((card.highlander_training || 0) !== 0)
    flags.push("deck-diversity training unique");
  if ((card.fan_bonus || 0) !== 0)
    flags.push("fan-count training unique");
  return flags;
}

export function supportImageUrl(id) {
  return `https://raw.githubusercontent.com/Euophrys/umamusume-tierlist/main/public/cardImages/support_card_s_${id}.png`;
}

export function portraitImageUrl(card) {
  return supportImageUrl(card.id);
}

function fmt(value, digits = 2) {
  return Number(value).toFixed(digits);
}
function pct(value) {
  return `${(value * 100).toFixed(2)}%`;
}
function rarity(card) {
  return RARITY_NAMES[card.rarity] || `R${card.rarity}`;
}
function lbLabel(lb) {
  return Number(lb) === 4 ? "MLB" : `LB${lb}`;
}
function cardTitle(card) {
  return card.title ? `[${card.title}]` : "";
}
function htmlEscape(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function titleMarkup(card, className = "card-titleline") {
  return card.title
    ? `<div class="${className}">${htmlEscape(cardTitle(card))}</div>`
    : "";
}
function rarityMarkup(card) {
  return `<span class="rarity-chip">${htmlEscape(rarity(card))}</span>`;
}
function futureMarkup(card) {
  return card.future ? '<span class="future-chip">FUTURE</span>' : "";
}
function cardSearchText(card) {
  return `${card.char_name} ${card.title || ""} ${card.id} ${TYPE_NAMES[card.type]} ${rarity(card)}`.toLowerCase();
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
    resetSettings: document.querySelector("#reset-settings"),
  };
  const state = {
    payload: null,
    groups: [],
    selected: [],
    activeDetailId: null,
  };
  const stored = readStoredState();

  els.includeFuture.checked = Boolean(stored?.includeFuture);
  els.search.placeholder = "Search title, character, or support ID…";

  const growthNames = ["Speed", "Stamina", "Power", "Guts", "Wit"];
  els.growthGrid.innerHTML = growthNames
    .map(
      (name, i) =>
        `<div class="growth-field"><label for="growth-${i}">${name} %</label><input id="growth-${i}" data-growth-index="${i}" type="number" min="0" max="100" step="1" value="0" /></div>`,
    )
    .join("");

  function settings() {
    const growth = [0, 1, 2, 3, 4].map(
      (i) =>
        1 + Number(document.querySelector(`#growth-${i}`).value || 0) / 100,
    );
    growth.push(1);
    return {
      globalSpecialty: Number(els.globalSpec.value || 0),
      profile: els.trainingProfile.value,
      motivation: Number(els.motivation.value),
      spWeight: Number(els.spWeight.value || 1.2),
      facilityLevel: Number(els.facilityLevel.value || 5),
      facilityPace: Number(els.facilityPace.value || 100),
      growth,
    };
  }

  function persistedSettings() {
    return {
      globalSpecialty: Number(els.globalSpec.value || 0),
      profile: els.trainingProfile.value,
      motivation: Number(els.motivation.value),
      spWeight: Number(els.spWeight.value || 1.2),
      facilityLevel: Number(els.facilityLevel.value || 5),
      facilityPace: Number(els.facilityPace.value || 100),
      growth: [0, 1, 2, 3, 4].map((i) =>
        Number(document.querySelector(`#growth-${i}`).value || 0),
      ),
    };
  }

  function persistState() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          selected: state.selected.map(({ id, lb }) => ({ id, lb })),
          settings: persistedSettings(),
          includeFuture: els.includeFuture.checked,
        }),
      );
    } catch {}
  }

  function syncSpecUI(value) {
    els.globalSpec.value = value;
    els.globalSpecRange.value = Math.max(0, Math.min(100, Number(value)));
    document
      .querySelectorAll("[data-spec-preset]")
      .forEach((button) =>
        button.classList.toggle(
          "active",
          Number(button.dataset.specPreset) === Number(value),
        ),
      );
  }

  function updateFacilityPaceSummary() {
    const pace = Number(els.facilityPace.value || 100);
    const turns = turnsPerFacilityLevel(pace);
    const levelFiveTurn = Math.ceil(turns * 4);
    els.facilityPaceSummary.textContent =
      `${pace}% · ~${turns.toFixed(1)} turns / level · Lv5 ~ T${levelFiveTurn}`;
  }

  function applyProfileDefaults(profileKey) {
    const profile =
      TRAINING_PROFILES[profileKey] || TRAINING_PROFILES["gl-late"];
    syncSpecUI(profile.globalSpecialty);
    els.spWeight.value = String(profile.spWeight);
    els.facilityLevel.value = String(profile.facilityLevel);
    els.facilityPace.value = String(profile.facilityPace);
    updateFacilityPaceSummary();
  }

  function restoreSettings(saved) {
    const profileKey =
      saved?.profile && TRAINING_PROFILES[saved.profile]
        ? saved.profile
        : "gl-late";
    els.trainingProfile.value = profileKey;
    applyProfileDefaults(profileKey);

    if (!saved || typeof saved !== "object") return;
    if (Number.isFinite(Number(saved.globalSpecialty)))
      syncSpecUI(Number(saved.globalSpecialty));
    if (Number.isFinite(Number(saved.motivation)))
      els.motivation.value = String(saved.motivation);
    if (Number.isFinite(Number(saved.spWeight)))
      els.spWeight.value = String(saved.spWeight);
    if (Number.isFinite(Number(saved.facilityLevel)))
      els.facilityLevel.value = String(
        clampFacilityLevel(saved.facilityLevel),
      );
    if (Number.isFinite(Number(saved.facilityPace)))
      els.facilityPace.value = String(
        Math.max(25, Math.min(100, Number(saved.facilityPace))),
      );
    if (Array.isArray(saved.growth)) {
      saved.growth.slice(0, 5).forEach((value, i) => {
        const el = document.querySelector(`#growth-${i}`);
        if (el && Number.isFinite(Number(value))) el.value = String(value);
      });
    }
    updateFacilityPaceSummary();
  }

  restoreSettings(stored?.settings);

  function buildGroups(cards) {
    const map = new Map();
    for (const card of cards) {
      if (!map.has(card.id))
        map.set(card.id, { id: card.id, lbs: new Map(), sample: card });
      map.get(card.id).lbs.set(card.limit_break, card);
    }
    return [...map.values()].sort((a, b) => b.id - a.id);
  }

  function currentCard(sel) {
    const group = state.groups.find((g) => g.id === sel.id);
    return (
      group?.lbs.get(sel.lb) || group?.lbs.get(Math.max(...group.lbs.keys()))
    );
  }

  function restoreSelected(saved) {
    if (!Array.isArray(saved)) return [];
    const restored = [];
    for (const raw of saved) {
      const id = Number(raw?.id);
      const group = state.groups.find((g) => g.id === id);
      if (!group || restored.some((item) => item.id === id)) continue;
      const requestedLb = Number(raw?.lb);
      const lb = group.lbs.has(requestedLb)
        ? requestedLb
        : Math.max(...group.lbs.keys());
      restored.push({ id, lb });
      if (restored.length === 10) break;
    }
    return restored;
  }

  function portraitMarkup(card, small = false) {
    return `<div class="accent-card-thumb portrait-card-thumb${small ? " small" : ""}"><img class="card-thumb portrait-thumb" src="${htmlEscape(portraitImageUrl(card))}" alt="" loading="lazy" onerror="this.onerror=null;this.src='${htmlEscape(supportImageUrl(card.id))}'" /></div>`;
  }

  function renderSearch() {
    const query = els.search.value.trim().toLowerCase();
    if (!query || !state.payload) {
      els.searchResults.hidden = true;
      return;
    }
    const already = new Set(state.selected.map((s) => s.id));
    const matches = state.groups
      .filter(
        (group) =>
          !already.has(group.id) &&
          (!group.sample.future || els.includeFuture.checked) &&
          cardSearchText(group.sample).includes(query),
      )
      .slice(0, 20);

    if (!matches.length) {
      els.searchResults.innerHTML =
        '<div class="search-meta" style="padding:12px">No matching support cards.</div>';
      els.searchResults.hidden = false;
      return;
    }

    els.searchResults.innerHTML = matches
      .map((group) => {
        const card =
          group.lbs.get(Math.max(...group.lbs.keys())) || group.sample;
        const maxLb = Math.max(...group.lbs.keys());
        return `<button class="search-result" type="button" data-add-id="${card.id}" data-card-type="${card.type}"><div class="accent-card-thumb"><img class="card-thumb" src="${supportImageUrl(card.id)}" alt="" loading="lazy" /></div><div>${titleMarkup(card, "search-titleline")}<div class="name-row"><div class="search-name">${htmlEscape(card.char_name)}</div>${rarityMarkup(card)}${futureMarkup(card)}</div><div class="search-meta">${TYPE_NAMES[card.type]} · #${card.id} · LB0–${lbLabel(maxLb)}</div></div><div class="add-mark">＋</div></button>`;
      })
      .join("");
    els.searchResults.hidden = false;
  }

  function addCard(id) {
    if (
      state.selected.length >= 10 ||
      state.selected.some((s) => s.id === id)
    )
      return;
    const group = state.groups.find((g) => g.id === id);
    if (!group) return;
    state.selected.push({ id, lb: Math.max(...group.lbs.keys()) });
    els.search.value = "";
    els.searchResults.hidden = true;
    persistState();
    renderAll();
  }

  function removeCard(id) {
    state.selected = state.selected.filter((s) => s.id !== id);
    if (state.activeDetailId === id) state.activeDetailId = null;
    persistState();
    renderAll();
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
      .map((sel) => {
        const group = state.groups.find((g) => g.id === sel.id);
        const card = currentCard(sel);
        const lbOptions = [...group.lbs.keys()]
          .sort((a, b) => a - b)
          .map(
            (lb) =>
              `<option value="${lb}" ${lb === sel.lb ? "selected" : ""}>${lbLabel(lb)}</option>`,
          )
          .join("");
        return `<div class="selected-card" data-card-type="${card.type}">${portraitMarkup(card)}<div style="min-width:0">${titleMarkup(card)}<div class="name-row"><div class="selected-title" title="${htmlEscape(card.char_name)}">${htmlEscape(card.char_name)}</div>${rarityMarkup(card)}${futureMarkup(card)}</div><div class="selected-meta"><span class="type-tag">${TYPE_NAMES[card.type]}</span><select data-lb-id="${card.id}">${lbOptions}</select></div></div><button class="remove-card" data-remove-id="${card.id}" type="button" title="Remove">×</button></div>`;
      })
      .join("");
  }

  function evaluatedCards() {
    const opts = settings();
    const rows = state.selected.map((sel) => {
      const card = currentCard(sel);
      return {
        card,
        ev: calculateCardEV(card, opts),
        flags: conditionalFlags(card),
      };
    });
    rows.sort((a, b) => b.ev.specialtyScore - a.ev.specialtyScore);
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
      ? `<div class="warning-box"><strong>Conditional unique:</strong> ${htmlEscape(flags.join(", "))}. The isolated benchmark does not guess the trigger state for these dynamic modifiers, so treat this card's result as a baseline.</div>`
      : "";
    els.resultDetails.innerHTML = `<div class="detail-card" data-card-type="${card.type}"><div class="detail-top"><div>${titleMarkup(card)}<div class="name-row"><div class="detail-title">${htmlEscape(card.char_name)}</div>${rarityMarkup(card)}${futureMarkup(card)}</div><div class="search-meta">${TYPE_NAMES[card.type]} · ${lbLabel(card.limit_break)} · #${card.id} · Specialty Priority ${fmt(card.specialty_rate, 0)} · Specialty Rate ${pct(ev.appearance.specialty)}${facilityUniqueMeta(card, ev)}</div></div><div class="formula-chip">#${card.id}</div></div><div class="detail-ev-heading"><strong>Per-turn Specialty EV by stat</strong><span>Appearance-weighted average contribution across all turns.</span></div><div class="stat-vector">${STAT_NAMES.map((name, i) => `<div class="stat-cell"><span>${name}</span><strong>${fmt(ev.specialtyVector[i])}</strong></div>`).join("")}</div>${warning}</div>`;
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
    const rows = evaluatedCards();
    if (
      !state.activeDetailId ||
      !rows.some((r) => r.card.id === state.activeDetailId)
    )
      state.activeDetailId = rows[0]?.card.id;

    els.resultsBody.innerHTML = rows
      .map((row, index) => {
        const { card, ev, flags } = row;
        return `<tr data-detail-id="${card.id}" class="${state.activeDetailId === card.id ? "active" : ""}" data-card-type="${card.type}"><td class="rank">${index + 1}</td><td><div class="result-support" data-card-type="${card.type}"><div class="accent-card-thumb small"><img class="card-thumb" src="${supportImageUrl(card.id)}" alt="" /></div><div>${titleMarkup(card, "result-titleline")}<div class="name-row"><div class="result-name">${htmlEscape(card.char_name)}${flags.length ? '<span class="warn-dot" title="Context-dependent unique">◆</span>' : ""}</div>${rarityMarkup(card)}${futureMarkup(card)}</div><div class="result-sub">${TYPE_NAMES[card.type]} · ${lbLabel(card.limit_break)} · #${card.id}</div></div></div></td><td><div class="metric-main">${fmt(card.specialty_rate, 0)}</div><div class="metric-sub">得意率</div></td><td><div class="metric-main">${pct(ev.appearance.specialty)}</div><div class="metric-sub">preferred training appearance</div></td><td><div class="metric-main">+${fmt(ev.rainbowScore)}</div><div class="metric-sub">extra weighted stats</div></td><td class="${index === 0 ? "best" : ""}"><div class="metric-main">${fmt(ev.specialtyScore)}</div><div class="metric-sub">weighted stats / turn</div></td></tr>`;
      })
      .join("");
    renderDetails(
      rows.find((r) => r.card.id === state.activeDetailId) || rows[0],
    );
  }

  function renderAll() {
    renderSelected();
    renderResults();
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
      (s) => s.id === Number(select.dataset.lbId),
    );
    if (item) item.lb = Number(select.value);
    persistState();
    renderAll();
  });

  function onSettingsChanged() {
    persistState();
    renderResults();
  }

  els.trainingProfile.addEventListener("input", () => {
    applyProfileDefaults(els.trainingProfile.value);
    onSettingsChanged();
  });
  [els.motivation, els.spWeight, els.facilityLevel].forEach((el) =>
    el.addEventListener("input", onSettingsChanged),
  );
  els.facilityPace.addEventListener("input", () => {
    updateFacilityPaceSummary();
    persistState();
  });
  document
    .querySelectorAll("[data-growth-index]")
    .forEach((el) => el.addEventListener("input", onSettingsChanged));

  function setGlobalSpec(value, save = true) {
    syncSpecUI(value);
    if (save) persistState();
    renderResults();
  }

  els.globalSpec.addEventListener("input", () =>
    setGlobalSpec(els.globalSpec.value),
  );
  els.globalSpecRange.addEventListener("input", () =>
    setGlobalSpec(els.globalSpecRange.value),
  );
  document
    .querySelectorAll("[data-spec-preset]")
    .forEach((button) =>
      button.addEventListener("click", () =>
        setGlobalSpec(button.dataset.specPreset),
      ),
    );

  els.resetSettings.addEventListener("click", () => {
    els.trainingProfile.value = "gl-late";
    applyProfileDefaults("gl-late");
    els.motivation.value = "0.2";
    document.querySelectorAll("[data-growth-index]").forEach((el) => {
      el.value = 0;
    });
    persistState();
    renderResults();
  });

  els.resetCards.addEventListener("click", () => {
    state.selected = [];
    state.activeDetailId = null;
    persistState();
    renderAll();
  });

  fetch("./data/cards.json", { cache: "no-cache" })
    .then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    })
    .then((payload) => {
      state.payload = payload;
      state.groups = buildGroups(payload.cards);
      state.selected = restoreSelected(stored?.selected);
      persistState();
      const date = payload.generated_at
        ? new Date(payload.generated_at).toLocaleDateString()
        : "current build";
      const globalCount = Number(
        payload.card_count ||
          state.groups.filter((g) => !g.sample.future).length,
      );
      const futureCount = Number(
        payload.future_card_count ||
          state.groups.filter((g) => g.sample.future).length,
      );
      els.sourcePill.textContent = `${globalCount} Global${futureCount ? ` · ${futureCount} future` : ""} · synced ${date}`;
      els.sourcePill.classList.add("ready");
      renderAll();
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
