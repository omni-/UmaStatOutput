import {
  calculateAppearance,
  calculateMarginalTraining,
  weightedSum,
  normalizeStatWeights,
  averageFacilityLevel,
  DEFAULT_PASSIVE_BOND_PER_TURN,
  effectiveStartingBond,
  effectiveStartingStats,
  facilityLevelAtTurn,
  hasTrainingSpecialty,
  typeLabel,
  GLOBAL_UNIQUE_CONTEXT,
  RAINBOW_BOND_THRESHOLD,
  hasFacilityLevelUnique,
  turnsPerFacilityLevel,
  uniqueModelWarnings,
  RARITY_NAMES,
  TRAINING_PROFILES,
  portraitImageUrl,
  remoteSupportImageUrl,
} from "./app.mjs";
import { averageFriendshipTrainingsForCareer } from "./unique-model.mjs";
import { loadCards } from "./data.mjs";
import { SETTINGS_EVENT, readSharedSettings } from "./settings.mjs";

// Bonded gains are the same table the per-click comparison uses, so the two
// views cannot drift apart. Only the early-run (low facility) phase is unique
// to the whole-run projection.
export const GRAND_LIVE_RUN = {
  label: "Grand Live",
  trainingTurns: 56,
  scenarioMultiplier: 1.4,
  unbondedGains: [
    [8, 0, 4, 0, 0, 2],
    [0, 8, 0, 6, 0, 2],
    [0, 4, 9, 0, 0, 2],
    [2, 0, 2, 7, 0, 2],
    [2, 0, 0, 0, 6, 3],
  ],
  bondedGains: TRAINING_PROFILES["gl-late"].gains,
};

export const UNITY_CUP_RUN = {
  label: "Unity Cup",
  trainingTurns: 56,
  scenarioMultiplier: 1,
  unbondedGains: [
    [8, 0, 4, 0, 0, 4],
    [0, 8, 0, 6, 0, 4],
    [0, 4, 9, 0, 0, 4],
    [3, 0, 3, 6, 0, 4],
    [2, 0, 0, 0, 6, 5],
  ],
  bondedGains: TRAINING_PROFILES["unity-late"].gains,
};

// Summer camp is a short window inside a Grand Live career rather than a
// whole-run training state, so there is no 56-turn summer gains table to
// project from. The projection deliberately falls back to late-run values; the
// label carries that substitution into the results table so it is not silent.
export const GRAND_LIVE_SUMMER_RUN = {
  ...GRAND_LIVE_RUN,
  label: "Grand Live (late-run gains)",
};

export const RUN_PROFILES = {
  "gl-late": GRAND_LIVE_RUN,
  "gl-summer": GRAND_LIVE_SUMMER_RUN,
  "unity-late": UNITY_CUP_RUN,
};

const BOND_PER_SELECTED_TRAINING = 5;

export { DEFAULT_PASSIVE_BOND_PER_TURN };

// Longest slice the projection integrates in one step. Appearance, facility
// level, and bond-gated uniques all move continuously through a run, so each
// slice is sampled at its midpoint and kept short enough that the drift inside
// it stays negligible.
const MAX_SEGMENT_TURNS = 2;

function eventInfo(card) {
  if (Array.isArray(card.event_stats) && card.event_stats.length >= 8)
    return {
      bond: Number(card.event_stats[7] || 0),
      source: "upstream event data",
    };
  if (Number(card.rarity) >= 2) return { bond: 5, source: "rarity fallback" };
  return { bond: 0, source: "no event estimate" };
}

function addScaled(target, values, scale) {
  for (let i = 0; i < 6; i++) target[i] += Number(values[i] || 0) * scale;
}

/**
 * Turn at which the run switches from early-run to late-run base training
 * values. Base gains grow with facility level, so the switch follows the
 * facility pace rather than the card's own bond.
 */
export function baseGainsSwitchTurn(run, facilityPace = 100) {
  return Math.min(run.trainingTurns, 3 * turnsPerFacilityLevel(facilityPace));
}

function careerContextAt(turn, run, options) {
  const runProgress = Math.max(0, Math.min(1, turn / run.trainingTurns));
  return {
    fans: Number(options.fans ?? GLOBAL_UNIQUE_CONTEXT.fans) * runProgress,
    totalBond:
      Number(options.totalBond ?? GLOBAL_UNIQUE_CONTEXT.totalBond) * runProgress,
  };
}

export function calculateCareerProjection(card, options = {}) {
  const profileKey =
    options.profile && RUN_PROFILES[options.profile] ? options.profile : "gl-late";
  const run = RUN_PROFILES[profileKey];
  const profile = TRAINING_PROFILES[profileKey] || TRAINING_PROFILES["gl-late"];
  const globalSpecialty = Number(
    options.globalSpecialty ?? profile.globalSpecialty,
  );
  const motivation = Number(options.motivation ?? 0.2);
  const growth = options.growth || [1, 1, 1, 1, 1, 1];
  const spWeight = Number(options.spWeight ?? profile.spWeight ?? 1.2);
  const statWeights = normalizeStatWeights(options.statWeights);
  const includeInitialStats = options.includeInitialStats !== false;
  const facilityPace = Number(options.facilityPace ?? profile.facilityPace ?? 100);
  const passiveBondPerTurn = Math.max(
    0,
    Number(options.passiveBondPerTurn ?? DEFAULT_PASSIVE_BOND_PER_TURN),
  );
  const specialty = hasTrainingSpecialty(card);
  const cardType = Number(card.type);
  const event = eventInfo(card);
  const startingBond = effectiveStartingBond(card);
  const switchTurn = baseGainsSwitchTurn(run, facilityPace);
  const offSelectionDenominator = Math.max(
    1,
    Number(card.offstat_appearance_denominator || 4),
  );

  const trainingVector = new Array(6).fill(0);
  let bond = Math.min(100, startingBond + event.bond);
  let rainbowClicks = 0;
  let specialtyClicks = 0;
  let offClicks = 0;
  let bondedAtTurn = bond >= RAINBOW_BOND_THRESHOLD ? 0 : null;
  let turn = 0;

  const appearanceAt = (sampleTurn, bondValue) =>
    calculateAppearance(card, globalSpecialty, {
      ...options,
      ...careerContextAt(sampleTurn, run, options),
      bond: bondValue,
    });

  while (turn < run.trainingTurns) {
    const facilityLevel = facilityLevelAtTurn(turn, facilityPace);
    const turnsPerLevel = turnsPerFacilityLevel(facilityPace);
    const nextFacilityTurn =
      facilityLevel >= 5 ? Infinity : facilityLevel * turnsPerLevel;
    const nextGainsTurn = turn < switchTurn ? switchTurn : Infinity;
    const rainbowing = specialty && bond >= RAINBOW_BOND_THRESHOLD;
    const appearance = appearanceAt(turn, bond);
    const offRate = (appearance.eachOff * (specialty ? 4 : 5)) /
      offSelectionDenominator;
    const selectedRate = (specialty ? appearance.specialty : 0) + offRate;
    const bondRate =
      BOND_PER_SELECTED_TRAINING * selectedRate + passiveBondPerTurn;
    const turnsToBond =
      bond < RAINBOW_BOND_THRESHOLD && bondRate > 0
        ? (RAINBOW_BOND_THRESHOLD - bond) / bondRate
        : Infinity;

    const duration = Math.min(
      run.trainingTurns - turn,
      MAX_SEGMENT_TURNS,
      nextFacilityTurn - turn,
      nextGainsTurn - turn,
      turnsToBond > 0 ? turnsToBond : MAX_SEGMENT_TURNS,
    );
    if (!(duration > 0)) break;

    const midpoint = turn + duration / 2;
    const dynamicContext = careerContextAt(midpoint, run, options);
    const midAppearance = appearanceAt(midpoint, bond);
    const gains = turn >= switchTurn ? run.bondedGains : run.unbondedGains;
    const expectedRainbowClicks = rainbowing
      ? midAppearance.specialty * duration
      : 0;
    const friendshipTrainings = rainbowClicks + expectedRainbowClicks / 2;

    for (let training = 0; training < 5; training++) {
      const onSpecialty = specialty && training === cardType;
      const probability = onSpecialty
        ? midAppearance.specialty
        : midAppearance.eachOff / offSelectionDenominator;
      const marginal = calculateMarginalTraining(card, training, {
        ...options,
        ...dynamicContext,
        gains: gains[training],
        motivation,
        growth,
        rainbow: rainbowing && onSpecialty,
        bond,
        friendshipTrainings,
        facilityLevel: facilityLevelAtTurn(midpoint, facilityPace),
      });
      const scenarioScale =
        rainbowing && onSpecialty ? run.scenarioMultiplier : 1;
      addScaled(trainingVector, marginal, probability * duration * scenarioScale);
    }

    if (specialty) specialtyClicks += midAppearance.specialty * duration;
    offClicks +=
      (midAppearance.eachOff * (specialty ? 4 : 5) * duration) /
      offSelectionDenominator;
    rainbowClicks += expectedRainbowClicks;

    const midSelectedRate =
      (specialty ? midAppearance.specialty : 0) +
      (midAppearance.eachOff * (specialty ? 4 : 5)) / offSelectionDenominator;
    bond = Math.min(
      100,
      bond +
        (BOND_PER_SELECTED_TRAINING * midSelectedRate + passiveBondPerTurn) *
          duration,
    );
    turn += duration;
    if (bondedAtTurn === null && bond >= RAINBOW_BOND_THRESHOLD)
      bondedAtTurn = turn;
  }

  const daysToBond = bondedAtTurn === null ? run.trainingTurns : bondedAtTurn;
  const rainbowDays = specialty ? Math.max(0, run.trainingTurns - daysToBond) : 0;
  const beforeFacilityLevel = averageFacilityLevel(0, daysToBond, facilityPace);
  const afterFacilityLevel = averageFacilityLevel(
    daysToBond,
    run.trainingTurns,
    facilityPace,
  );
  const beforeAppearance = appearanceAt(
    0,
    Math.min(startingBond + event.bond, RAINBOW_BOND_THRESHOLD - 1),
  );
  const afterAppearance = appearanceAt(run.trainingTurns, bond);
  const averageFriendshipTrainings = averageFriendshipTrainingsForCareer(
    card,
    rainbowClicks,
  );
  const initialVector = effectiveStartingStats(card);
  const vector = trainingVector.map(
    (value, stat) => value + (includeInitialStats ? initialVector[stat] : 0),
  );

  return {
    vector,
    trainingVector,
    initialVector,
    score: weightedSum(vector, spWeight, statWeights),
    trainingScore: weightedSum(trainingVector, spWeight, statWeights),
    initialScore: weightedSum(initialVector, spWeight, statWeights),
    includesInitialStats: includeInitialStats,
    hasSpecialty: specialty,
    daysToBond,
    rainbowDays,
    rainbowClicks,
    specialtyClicks,
    offClicks,
    startingBond,
    eventBond: event.bond,
    passiveBondPerTurn,
    finalBond: bond,
    appearance: afterAppearance,
    beforeAppearance,
    afterAppearance,
    eventSource: event.source,
    profileKey,
    runLabel: run.label,
    facilityPace,
    baseGainsSwitchTurn: switchTurn,
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
  return `<div class="accent-card-thumb small portrait-card-thumb"><img class="card-thumb portrait-thumb" src="${esc(portraitImageUrl(card))}" alt="" loading="lazy" onerror="this.onerror=null;this.src='${esc(remoteSupportImageUrl(card.id))}'" /></div>`;
}

function formatInitialStat(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/** Human-readable description of where a card's bond timing came from. */
export function bondSourceLabel(career) {
  const eventLabel =
    career.eventSource === "upstream event data"
      ? "event bond"
      : career.eventSource === "rarity fallback"
        ? "estimated event bond"
        : "no event bond";
  return `bond ${career.startingBond.toFixed(0)} start + ${career.eventBond.toFixed(0)} ${eventLabel}`;
}

function initCareerView() {
  const body = document.querySelector("#career-body");
  const wrap = document.querySelector("#career-results");
  const selectedRoot = document.querySelector("#selected-cards");
  if (!body || !wrap || !selectedRoot) return;
  let payload = null;

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
    const options = readSharedSettings(document);
    const rows = cards
      .map((card) => ({
        card,
        career: calculateCareerProjection(card, options),
        flags: uniqueModelWarnings(card, options.profile),
      }))
      .sort((a, b) => b.career.score - a.career.score);
    body.innerHTML = rows
      .map((row, index) => {
        const { card, career, flags } = row;
        const stats = career.vector
          .map((value, stat) => {
            const initial = career.includesInitialStats
              ? career.initialVector[stat]
              : 0;
            const initialLabel = initial
              ? `<span class="career-initial"> (+${formatInitialStat(initial)} initial)</span>`
              : "";
            return `<td class="career-stat"><strong>${Number(value).toFixed(1)}</strong>${initialLabel}</td>`;
          })
          .join("");
        const facilityMeta = hasFacilityLevelUnique(card)
          ? ` · facility ≈ Lv${career.beforeFacilityLevel.toFixed(1)} → Lv${career.afterFacilityLevel.toFixed(1)}`
          : "";
        const initialMeta =
          career.includesInitialStats && career.initialScore
            ? `+${formatInitialStat(career.initialScore)} initial · `
            : "";
        const bondMeta = career.hasSpecialty
          ? `bond phase ≈ ${career.daysToBond.toFixed(1)} turns · rainbows ≈ ${career.rainbowClicks.toFixed(1)}`
          : "no specialty training · never rainbows";
        const warnMark = flags.length
          ? '<span class="warn-dot" title="Unique effect not fully modeled">★</span>'
          : "";
        return `<tr data-card-type="${card.type}"><td class="rank">${index + 1}</td><td><div class="career-support">${portrait(card)}<div class="career-support-copy">${title(card)}<div class="name-row"><div class="career-card-name">${esc(card.char_name)}${warnMark}</div><span class="rarity-chip">${rarity(card)}</span></div><div class="career-card-meta">${esc(typeLabel(card))} · ${lbLabel(card.limit_break)} · ${career.runLabel} · ${bondMeta}${facilityMeta}</div><div class="career-card-meta career-bond-source">${esc(bondSourceLabel(career))} · final bond ${career.finalBond.toFixed(0)}</div></div></div></td>${stats}<td class="${index === 0 ? "best" : ""}"><div class="metric-main">${career.score.toFixed(1)}</div><div class="metric-sub">${initialMeta}SP × ${options.spWeight.toFixed(1)}</div></td></tr>`;
      })
      .join("");
    wrap.hidden = false;
  }

  loadCards()
    .then((data) => {
      payload = data;
      render();
      new MutationObserver(render).observe(selectedRoot, {
        childList: true,
        subtree: true,
        attributes: true,
      });
      selectedRoot.addEventListener("change", render);
      document.addEventListener(SETTINGS_EVENT, render);
    })
    .catch((error) => {
      console.error("Career projection data failed to load", error);
      wrap.hidden = false;
      body.innerHTML = `<tr><td colspan="9" class="career-error">Career projection data failed to load.</td></tr>`;
    });
}

if (typeof document !== "undefined") initCareerView();
