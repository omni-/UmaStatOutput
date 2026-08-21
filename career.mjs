import {
  calculateAppearance,
  calculateMarginalTraining,
  weightedSum,
  normalizeStatWeights,
  averageFacilityLevel,
  DEFAULT_PASSIVE_BOND_PER_TURN,
  MIN_SEGMENT_TURNS,
  effectiveStartingBond,
  effectiveStartingStats,
  facilityLevelAtTurn,
  hasTrainingSpecialty,
  typeLabel,
  GLOBAL_UNIQUE_CONTEXT,
  RAINBOW_BOND_THRESHOLD,
  hasFacilityLevelUnique,
  modelConfidenceMark,
  turnsPerFacilityLevel,
  uniqueModelWarnings,
  STAT_NAMES,
  TRAINING_PROFILES,
} from "./app.mjs";
import {
  RENDER_DELAY_MS,
  cardImageMarkup,
  htmlEscape as esc,
  lbLabel,
  rarityLabel as rarity,
  readSelectedCards,
  revealResultsPanel,
} from "./view-model.mjs";
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

// Upstream event vectors are laid out [Speed, Stamina, Power, Guts, Wit, SP,
// Energy, Bond]. Euophrys's README documents Energy and SP the other way round;
// the README is wrong and their own consuming code is not, so do not "fix" this.
const EVENT_ENERGY = 6;
const EVENT_BOND = 7;

// Flat stand-ins for cards with no upstream event entry, matching the upstream
// calculator so a missing row is not scored as a confident zero. The card's
// eventSource carries which branch produced the numbers.
const RARITY_FALLBACK_STATS = { 2: 7, 3: 9 };

/**
 * Resolves a card's one-time support-event contribution for a whole run.
 *
 * The stat and energy rewards are what Euophrys records as the best reasonable
 * event route, so they are an optimistic path value rather than an expectation
 * over every branch; events with random outcomes and skill rewards are not
 * represented at all. Callers surface that assumption rather than burying it.
 */
export function supportEventInfo(card) {
  const stats = new Array(6).fill(0);
  const effectSize = Number(card.effect_size_up ?? 1) || 1;
  if (Array.isArray(card.event_stats) && card.event_stats.length >= 8) {
    for (let stat = 0; stat < 6; stat++)
      stats[stat] = Number(card.event_stats[stat] || 0) * effectSize;
    return {
      stats,
      bond: Number(card.event_stats[EVENT_BOND] || 0),
      energy:
        Number(card.event_stats[EVENT_ENERGY] || 0) *
        (Number(card.energy_up ?? 1) || 1),
      source: "upstream event data",
    };
  }
  const fallback = RARITY_FALLBACK_STATS[Number(card.rarity)];
  if (fallback === undefined)
    return { stats, bond: 0, energy: 0, source: "no event estimate" };
  for (let stat = 0; stat < 5; stat++) stats[stat] = fallback * effectSize;
  return { stats, bond: 5, energy: 0, source: "rarity fallback" };
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
  const includeEventStats = options.includeEventStats !== false;
  const facilityPace = Number(options.facilityPace ?? profile.facilityPace ?? 100);
  const passiveBondPerTurn = Math.max(
    0,
    Number(options.passiveBondPerTurn ?? DEFAULT_PASSIVE_BOND_PER_TURN),
  );
  const specialty = hasTrainingSpecialty(card);
  const cardType = Number(card.type);
  const event = supportEventInfo(card);
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
    // Too close to the threshold to integrate over: take the crossing as done
    // so the loop cannot stall on a segment that moves nothing.
    if (turnsToBond <= MIN_SEGMENT_TURNS) {
      bond = RAINBOW_BOND_THRESHOLD;
      bondedAtTurn = bondedAtTurn === null ? turn : bondedAtTurn;
      continue;
    }

    const duration = Math.min(
      run.trainingTurns - turn,
      MAX_SEGMENT_TURNS,
      nextFacilityTurn - turn,
      nextGainsTurn - turn,
      turnsToBond,
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
        scenarioMultiplier:
          rainbowing && onSpecialty ? run.scenarioMultiplier : 1,
        bond,
        friendshipTrainings,
        facilityLevel: facilityLevelAtTurn(midpoint, facilityPace),
      });
      addScaled(trainingVector, marginal, probability * duration);
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
  // Event rewards land once per run, so they are added flat: no appearance
  // rate, facility level, friendship bonus, scenario multiplier, motivation or
  // growth applies to them.
  const eventVector = event.stats;
  const vector = trainingVector.map(
    (value, stat) =>
      value +
      (includeInitialStats ? initialVector[stat] : 0) +
      (includeEventStats ? eventVector[stat] : 0),
  );

  return {
    vector,
    trainingVector,
    initialVector,
    eventVector,
    score: weightedSum(vector, spWeight, statWeights),
    trainingScore: weightedSum(trainingVector, spWeight, statWeights),
    initialScore: weightedSum(initialVector, spWeight, statWeights),
    eventScore: weightedSum(eventVector, spWeight, statWeights),
    includesInitialStats: includeInitialStats,
    includesEventStats: includeEventStats,
    eventEnergy: event.energy,
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
    trainingTurns: run.trainingTurns,
    facilityPace,
    baseGainsSwitchTurn: switchTurn,
    turnsPerFacilityLevel: turnsPerFacilityLevel(facilityPace),
    beforeFacilityLevel,
    afterFacilityLevel,
    averageFriendshipTrainings,
  };
}

function title(card) {
  return card.title
    ? `<div class="career-titleline">[${esc(card.title)}]</div>`
    : "";
}
function portrait(card) {
  return cardImageMarkup(card, { small: true });
}

function formatOneTimeStat(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

// Spells out the raw event vector so the optimistic best-path assumption behind
// it is inspectable rather than folded anonymously into the totals.
function eventBreakdown(career) {
  if (!career.includesEventStats) return "";
  const parts = career.eventVector
    .map((value, stat) =>
      value
        ? `${value > 0 ? "+" : "−"}${formatOneTimeStat(Math.abs(value))} ${STAT_NAMES[stat]}`
        : "",
    )
    .filter(Boolean);
  if (career.eventEnergy)
    parts.push(
      `${career.eventEnergy > 0 ? "+" : "−"}${formatOneTimeStat(Math.abs(career.eventEnergy))} energy (unscored)`,
    );
  if (!parts.length) return "";
  return ` · events ${parts.join(", ")}`;
}

/** Human-readable description of where a card's bond timing came from. */
export function bondSourceLabel(career) {
  const start = `bond ${career.startingBond.toFixed(0)} start`;
  if (career.eventSource === "no event estimate")
    return `${start} · no support event on record`;
  const eventLabel =
    career.eventSource === "rarity fallback" ? "estimated event bond" : "event bond";
  return `${start} + ${career.eventBond.toFixed(0)} ${eventLabel}`;
}

function initCareerView() {
  const body = document.querySelector("#career-body");
  const wrap = document.querySelector("#career-results");
  const runChip = document.querySelector("#career-run-chip");
  const selectedRoot = document.querySelector("#selected-cards");
  if (!body || !wrap || !selectedRoot) return;
  let payload = null;

  function render() {
    const cards = readSelectedCards(payload, selectedRoot);
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
        flags: uniqueModelWarnings(card, options.profile, {
          ...options,
          rampsFans: true,
        }),
      }))
      .sort((a, b) => b.career.score - a.career.score);
    // The scenario is one setting shared by every row, so it belongs in the
    // heading rather than repeated down the table.
    if (runChip)
      runChip.textContent = `${rows[0].career.runLabel} · ${rows[0].career.trainingTurns} turns`;
    body.innerHTML = rows
      .map((row, index) => {
        const { card, career, flags } = row;
        const stats = career.vector
          .map((value, stat) => {
            const initial = career.includesInitialStats
              ? career.initialVector[stat]
              : 0;
            const eventStat = career.includesEventStats
              ? career.eventVector[stat]
              : 0;
            const initialLabel = initial
              ? `<span class="career-initial"> (+${formatOneTimeStat(initial)} initial)</span>`
              : "";
            const eventLabel = eventStat
              ? `<span class="career-initial"> (${eventStat > 0 ? "+" : "−"}${formatOneTimeStat(Math.abs(eventStat))} event)</span>`
              : "";
            return `<td class="career-stat"><strong>${Number(value).toFixed(1)}</strong>${initialLabel}${eventLabel}</td>`;
          })
          .join("");
        const facilityMeta = hasFacilityLevelUnique(card)
          ? ` · facility ≈ Lv${career.beforeFacilityLevel.toFixed(1)} → Lv${career.afterFacilityLevel.toFixed(1)}`
          : "";
        const initialMeta =
          career.includesInitialStats && career.initialScore
            ? `+${formatOneTimeStat(career.initialScore)} initial · `
            : "";
        const eventMeta =
          career.includesEventStats && career.eventScore
            ? `+${formatOneTimeStat(career.eventScore)} event · `
            : "";
        const bondMeta = career.hasSpecialty
          ? `bond ≈ T${career.daysToBond.toFixed(1)} · rainbows ${career.rainbowClicks.toFixed(1)}`
          : "no specialty training";
        // Every event stat already has its own annotation in the stat cells, so
        // the meta line carries only what has no column: a mark when the event
        // figures behind the timing were estimated. Event energy has no
        // exchange rate into the score, so quoting it in a ranking row invites
        // a comparison the model cannot make; it stays in the tooltip.
        const estimateMeta =
          career.eventSource === "no event estimate"
            ? " · no event data"
            : career.eventSource === "rarity fallback"
              ? " · est. event"
              : "";
        const metaTitle = `${career.runLabel} · ${bondSourceLabel(career)} · final bond ${career.finalBond.toFixed(0)}${eventBreakdown(career)}`;
        const mark = modelConfidenceMark(card, flags);
        const warnMark = mark
          ? `<span class="model-dot ${mark.variant}" title="${esc(mark.title)}">${mark.glyph}</span>`
          : "";
        return `<tr data-card-type="${card.type}"><td class="rank">${index + 1}</td><td><div class="career-support">${portrait(card)}<div class="career-support-copy">${title(card)}<div class="name-row"><div class="career-card-name">${esc(card.char_name)}${warnMark}</div><span class="rarity-chip">${rarity(card)}</span></div><div class="career-card-meta" title="${esc(metaTitle)}">${esc(typeLabel(card))} · ${lbLabel(card.limit_break)} · ${bondMeta}${facilityMeta}${estimateMeta}</div></div></div></td>${stats}<td class="${index === 0 ? "best" : ""}"><div class="metric-main">${career.score.toFixed(1)}</div><div class="metric-sub">${initialMeta}${eventMeta}SP × ${options.spWeight.toFixed(1)}</div></td></tr>`;
      })
      .join("");
    wrap.hidden = false;
  }

  // Each render integrates a whole run per selected card, and one interaction
  // can fire the observer and a listener together, so renders coalesce.
  let timer = null;
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
      console.error("Career projection data failed to load", error);
      revealResultsPanel();
      wrap.hidden = false;
      body.innerHTML = `<tr><td colspan="9" class="career-error">Career projection data failed to load.</td></tr>`;
    });
}

if (typeof document !== "undefined") initCareerView();
