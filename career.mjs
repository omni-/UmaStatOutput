import {
  calculateAppearance,
  calculateMarginalTraining,
  weightedSum,
  averageFacilityLevel,
  hasFacilityLevelUnique,
  turnsPerFacilityLevel,
  RARITY_NAMES,
  TYPE_NAMES,
  TRAINING_PROFILES,
  portraitImageUrl,
  supportImageUrl,
} from "./app.mjs";
import { averageFriendshipTrainingsForCareer } from "./unique-model.mjs";

export const GRAND_LIVE_RUN = {
  label: "Grand Live",
  trainingTurns: 56,
  bondPerTurn: 20,
  deckBondTarget: 75 * 6,
  scenarioMultiplier: 1.4,
  unbondedGains: [
    [8, 0, 4, 0, 0, 2],
    [0, 8, 0, 6, 0, 2],
    [0, 4, 9, 0, 0, 2],
    [2, 0, 2, 7, 0, 2],
    [2, 0, 0, 0, 6, 3],
  ],
  bondedGains: [
    [11, 0, 5, 0, 0, 2],
    [0, 9, 0, 6, 0, 2],
    [0, 4, 10, 0, 0, 2],
    [3, 0, 2, 10, 0, 2],
    [3, 0, 0, 0, 9, 3],
  ],
};

export const UNITY_CUP_RUN = {
  label: "Unity Cup",
  trainingTurns: 56,
  bondPerTurn: 20,
  deckBondTarget: 75 * 6,
  scenarioMultiplier: 1,
  unbondedGains: [
    [8, 0, 4, 0, 0, 4],
    [0, 8, 0, 6, 0, 4],
    [0, 4, 9, 0, 0, 4],
    [3, 0, 3, 6, 0, 4],
    [2, 0, 0, 0, 6, 5],
  ],
  bondedGains: [
    [12, 0, 5, 0, 0, 4],
    [0, 12, 0, 7, 0, 4],
    [0, 5, 13, 0, 0, 4],
    [4, 0, 3, 10, 0, 4],
    [3, 0, 0, 0, 10, 5],
  ],
};

export const RUN_PROFILES = {
  "gl-late": GRAND_LIVE_RUN,
  "gl-summer": GRAND_LIVE_RUN,
  "unity-late": UNITY_CUP_RUN,
};

function eventInfo(card) {
  if (Array.isArray(card.event_stats) && card.event_stats.length >= 8)
    return {
      bond: Number(card.event_stats[7] || 0),
      source: "upstream event data",
    };
  if (Number(card.rarity) >= 2)
    return { bond: 5, source: "rarity fallback" };
  return { bond: 0, source: "no event estimate" };
}

function addScaled(target, values, scale) {
  for (let i = 0; i < 6; i++)
    target[i] += Number(values[i] || 0) * scale;
}

export function calculateCareerProjection(card, options = {}) {
  const profileKey =
    options.profile && RUN_PROFILES[options.profile]
      ? options.profile
      : "gl-late";
  const run = RUN_PROFILES[profileKey];
  const profile = TRAINING_PROFILES[profileKey] || TRAINING_PROFILES["gl-late"];
  const globalSpecialty = Number(
    options.globalSpecialty ?? profile.globalSpecialty,
  );
  const motivation = Number(options.motivation ?? 0.2);
  const growth = options.growth || [1, 1, 1, 1, 1, 1];
  const spWeight = Number(options.spWeight ?? profile.spWeight ?? 1.2);
  const facilityPace = Number(
    options.facilityPace ?? profile.facilityPace ?? 100,
  );
  const appearance = calculateAppearance(card, globalSpecialty);
  const event = eventInfo(card);
  const bondNeeded = Math.max(
    0,
    run.deckBondTarget - Number(card.sb || 0) - event.bond,
  );
  const daysToBond = Math.min(run.trainingTurns, bondNeeded / run.bondPerTurn);
  const rainbowDays = Math.max(0, run.trainingTurns - daysToBond);
  const offDenominator = Math.max(
    1,
    Number(card.offstat_appearance_denominator || 4),
  );
  const beforeClicks = new Array(5).fill(0);
  const afterClicks = new Array(5).fill(0);

  for (let training = 0; training < 5; training++) {
    if (training === card.type) {
      beforeClicks[training] = appearance.specialty * daysToBond;
      afterClicks[training] = appearance.specialty * rainbowDays;
    } else {
      const chosenRate = appearance.eachOff / offDenominator;
      beforeClicks[training] = chosenRate * daysToBond;
      afterClicks[training] = chosenRate * rainbowDays;
    }
  }

  const rainbowClicks = afterClicks[card.type];
  const averageFriendshipTrainings = averageFriendshipTrainingsForCareer(
    card,
    rainbowClicks,
  );
  const beforeFacilityLevel = averageFacilityLevel(0, daysToBond, facilityPace);
  const afterFacilityLevel = averageFacilityLevel(
    daysToBond,
    run.trainingTurns,
    facilityPace,
  );
  const vector = new Array(6).fill(0);

  for (let training = 0; training < 5; training++) {
    const before = calculateMarginalTraining(card, training, {
      ...options,
      gains: run.unbondedGains[training],
      motivation,
      growth,
      rainbow: false,
      bond: 0,
      friendshipTrainings: 0,
      facilityLevel: beforeFacilityLevel,
    });
    addScaled(vector, before, beforeClicks[training]);

    const after = calculateMarginalTraining(card, training, {
      ...options,
      gains: run.bondedGains[training],
      motivation,
      growth,
      rainbow: training === card.type,
      bond: 80,
      friendshipTrainings: averageFriendshipTrainings,
      facilityLevel: afterFacilityLevel,
    });
    const scenarioScale = training === card.type ? run.scenarioMultiplier : 1;
    addScaled(vector, after, afterClicks[training] * scenarioScale);
  }

  return {
    vector,
    score: weightedSum(vector, spWeight),
    daysToBond,
    rainbowDays,
    rainbowClicks,
    appearance,
    eventSource: event.source,
    profileKey,
    runLabel: run.label,
    facilityPace,
    turnsPerFacilityLevel: turnsPerFacilityLevel(facilityPace),
    beforeFacilityLevel,
    afterFacilityLevel,
    averageFriendshipTrainings,
  };
}

function esc(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
function lbLabel(lb) {
  return Number(lb) === 4 ? "MLB" : `LB${lb}`;
}
function rarity(card) {
  return RARITY_NAMES[card.rarity] || `R${card.rarity}`;
}
function title(card) {
  return card.title
    ? `<div class="career-titleline">[${esc(card.title)}]</div>`
    : "";
}
function portrait(card) {
  return `<div class="accent-card-thumb small portrait-card-thumb"><img class="card-thumb portrait-thumb" src="${esc(portraitImageUrl(card))}" alt="" loading="lazy" onerror="this.onerror=null;this.src='${esc(supportImageUrl(card.id))}'" /></div>`;
}

function initCareerView() {
  const body = document.querySelector("#career-body");
  const wrap = document.querySelector("#career-results");
  const selectedRoot = document.querySelector("#selected-cards");
  if (!body || !wrap || !selectedRoot) return;
  let payload = null;

  function readSettings() {
    const growth = [0, 1, 2, 3, 4].map(
      (i) => 1 + Number(document.querySelector(`#growth-${i}`)?.value || 0) / 100,
    );
    growth.push(1);
    return {
      globalSpecialty: Number(document.querySelector("#global-spec")?.value || 0),
      profile: document.querySelector("#training-profile")?.value || "gl-late",
      motivation: Number(document.querySelector("#motivation")?.value ?? 0.2),
      spWeight: Number(document.querySelector("#sp-weight")?.value ?? 1.2),
      facilityPace: Number(document.querySelector("#facility-pace")?.value ?? 100),
      growth,
    };
  }

  function selectedCards() {
    if (!payload) return [];
    const byIdLb = new Map(
      payload.cards.map((card) => [`${card.id}:${card.limit_break}`, card]),
    );
    const cards = [];
    selectedRoot.querySelectorAll("select[data-lb-id]").forEach((select) => {
      const card = byIdLb.get(
        `${Number(select.dataset.lbId)}:${Number(select.value)}`,
      );
      if (card) cards.push(card);
    });
    return cards;
  }

  function render() {
    const cards = selectedCards();
    if (!cards.length) {
      wrap.hidden = true;
      body.innerHTML = "";
      return;
    }
    const options = readSettings();
    const rows = cards
      .map((card) => ({ card, career: calculateCareerProjection(card, options) }))
      .sort((a, b) => b.career.score - a.career.score);
    body.innerHTML = rows
      .map((row, index) => {
        const { card, career } = row;
        const stats = career.vector
          .map((value) => `<td><strong>${Number(value).toFixed(1)}</strong></td>`)
          .join("");
        const facilityMeta = hasFacilityLevelUnique(card)
          ? ` · facility ≈ Lv${career.beforeFacilityLevel.toFixed(1)} → Lv${career.afterFacilityLevel.toFixed(1)}`
          : "";
        return `<tr data-card-type="${card.type}"><td class="rank">${index + 1}</td><td><div class="career-support">${portrait(card)}<div class="career-support-copy">${title(card)}<div class="name-row"><div class="career-card-name">${esc(card.char_name)}</div><span class="rarity-chip">${rarity(card)}</span></div><div class="career-card-meta">${TYPE_NAMES[card.type]} · ${lbLabel(card.limit_break)} · ${career.runLabel} · bond phase ≈ ${career.daysToBond.toFixed(1)} turns · rainbows ≈ ${career.rainbowClicks.toFixed(1)}${facilityMeta}</div></div></div></td>${stats}<td class="${index === 0 ? "best" : ""}"><div class="metric-main">${career.score.toFixed(1)}</div><div class="metric-sub">SP × ${options.spWeight.toFixed(1)}</div></td></tr>`;
      })
      .join("");
    wrap.hidden = false;
  }

  fetch("./data/cards.json", { cache: "no-cache" })
    .then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    })
    .then((data) => {
      payload = data;
      render();
      new MutationObserver(render).observe(selectedRoot, {
        childList: true,
        subtree: true,
        attributes: true,
      });
      selectedRoot.addEventListener("change", render);
      [
        "#global-spec",
        "#global-spec-range",
        "#training-profile",
        "#motivation",
        "#sp-weight",
        "#facility-pace",
        "#growth-grid",
      ].forEach((selector) => {
        const el = document.querySelector(selector);
        if (el) el.addEventListener("input", () => queueMicrotask(render));
      });
      document.querySelectorAll("[data-spec-preset]").forEach((button) =>
        button.addEventListener("click", () => queueMicrotask(render)),
      );
      document
        .querySelector("#reset-settings")
        ?.addEventListener("click", () => queueMicrotask(render));
      document
        .querySelector("#reset-cards")
        ?.addEventListener("click", () => queueMicrotask(render));
    })
    .catch((error) => {
      console.error("Career projection data failed to load", error);
      wrap.hidden = false;
      body.innerHTML = `<tr><td colspan="9" class="career-error">Career projection data failed to load.</td></tr>`;
    });
}

if (typeof document !== "undefined") initCareerView();
