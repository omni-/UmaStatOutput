import {
  GLOBAL_UNIQUE_CONTEXT,
  GLOBAL_UNIQUE_COVERAGE,
  UNIQUE_PROFILE_COVERAGE,
  facilityTrainingBonus,
  effectiveStartingBond,
  effectiveStartingStats,
  hasFacilityLevelUnique,
  specialUniqueUnlocked,
  resolveUniqueModifiers,
  uniqueModelWarnings,
} from "./unique-model.mjs";

export {
  GLOBAL_UNIQUE_CONTEXT,
  GLOBAL_UNIQUE_COVERAGE,
  UNIQUE_PROFILE_COVERAGE,
  facilityTrainingBonus,
  effectiveStartingBond,
  effectiveStartingStats,
  hasFacilityLevelUnique,
  specialUniqueUnlocked,
  resolveUniqueModifiers,
  uniqueModelWarnings,
};

export const STAT_NAMES = ["Speed", "Stamina", "Power", "Guts", "Wit", "SP"];
export const TYPE_NAMES = ["Speed", "Stamina", "Power", "Guts", "Wit"];
export const FRIEND_TYPE = 6;
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

// Each support sharing a training multiplies its output by (1 + 0.05 × N).
export const SUPPORT_COUNT_BONUS = 0.05;

// Bond at which a card starts friendship ("rainbow") training. The same
// threshold gates the friendship Specialty Priority multiplier, which is a
// bonded-state effect rather than a permanent one.
export const RAINBOW_BOND_THRESHOLD = 80;

// Bond that arrives from outings, dates, and scenario turns rather than from
// standing on the training the player picked.
export const DEFAULT_PASSIVE_BOND_PER_TURN = 0.5;

export const STORAGE_KEY = "uma-stat-output:v2";

export function clampFacilityLevel(value) {
  return Math.max(1, Math.min(5, Number(value) || 1));
}

export function crowdMultiplier(supportCount) {
  return 1 + SUPPORT_COUNT_BONUS * Math.max(0, Number(supportCount) || 0);
}

/** Cards with a training specialty are types 0–4; type 6 is friend/group. */
export function hasTrainingSpecialty(card) {
  const type = Number(card?.type);
  return Number.isInteger(type) && type >= 0 && type < 5;
}

export function isFriendCard(card) {
  return !hasTrainingSpecialty(card);
}

export function typeLabel(card) {
  if (hasTrainingSpecialty(card)) return TYPE_NAMES[Number(card.type)];
  return card?.group ? "Group" : "Friend";
}

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

export function calculateAppearance(card, globalSpecialty = 0, options = {}) {
  const unique = resolveUniqueModifiers(card, card.type, options);
  const bond = Number(options.bond ?? GLOBAL_UNIQUE_CONTEXT.bond);
  // The friendship Specialty Priority multiplier only exists while the card is
  // bonded, so an unbonded card appears at its base rate.
  const friendshipSpecialty =
    bond >= RAINBOW_BOND_THRESHOLD
      ? Number(card.fs_specialty || 1) - unique.flattenedSpecialtyFactorDelta
      : 1;
  const specialtyWeight =
    (BASE_SPECIALTY_WEIGHT +
      Number(card.specialty_rate || 0) +
      Number(globalSpecialty || 0) +
      unique.conditionalSpecialtyRate) *
    (Number(card.unique_specialty || 1) - unique.lockedSpecialtyFactorDelta) *
    friendshipSpecialty;
  const denominator =
    specialtyWeight + OFF_TRAINING_WEIGHT * 4 + NO_TRAINING_WEIGHT;
  return {
    specialtyWeight,
    denominator,
    specialty: specialtyWeight / denominator,
    eachOff: OFF_TRAINING_WEIGHT / denominator,
    none: NO_TRAINING_WEIGHT / denominator,
    friendshipSpecialtyActive: bond >= RAINBOW_BOND_THRESHOLD,
  };
}

/**
 * Chance this card lands on a given training room. Friend and group cards have
 * no specialty room, so every room is an off-type room for them.
 */
export function roomProbability(card, appearance, trainingType) {
  return hasTrainingSpecialty(card) && Number(card.type) === Number(trainingType)
    ? appearance.specialty
    : appearance.eachOff;
}

/**
 * Absolute output of one training click for the supports standing on it.
 *
 * `entries` is a list of `{ card, rainbow }`; an empty list is the same click
 * with no supports at all, which is the baseline a card's marginal value is
 * measured against. `extraSupports` adds unmodeled bodies to the room so the
 * crowd multiplier and per-support uniques see a realistic count.
 */
export function trainingValue(entries, options = {}) {
  const trainingType = Number(options.trainingType ?? 0);
  const gains =
    options.gains || TRAINING_PROFILES["gl-late"].gains[trainingType] || [];
  const motivation = Number(options.motivation ?? 0.2);
  const growth = options.growth || [1, 1, 1, 1, 1, 1];
  const facilityLevel = clampFacilityLevel(options.facilityLevel ?? 3);
  const supports =
    entries.length + Math.max(0, Number(options.extraSupports || 0));

  let trainingBonus = 1;
  let motivationBonus = 1;
  let friendshipBonus = 1;
  const statBonus = new Array(6).fill(0);

  for (const entry of entries) {
    const card = entry.card;
    const rainbow = Boolean(entry.rainbow);
    const unique = resolveUniqueModifiers(card, trainingType, {
      ...options,
      // Each support in the room carries its own bond and friendship-training
      // count, so bond-gated and ramping uniques resolve per card.
      ...(entry.bond === undefined ? {} : { bond: entry.bond }),
      ...(entry.friendshipTrainings === undefined
        ? {}
        : { friendshipTrainings: entry.friendshipTrainings }),
      facilityLevel,
      rainbow,
      supportsOnTraining: supports,
    });
    trainingBonus +=
      facilityTrainingBonus(card, facilityLevel) - 1 + unique.trainingDelta;
    motivationBonus += Number(card.mb || 1) - 1 + unique.motivationDelta;
    for (let stat = 0; stat < 6; stat++)
      statBonus[stat] +=
        Number(card.stat_bonus?.[stat] || 0) +
        Number(unique.conditionalStatBonus[stat] || 0);
    if (!rainbow) continue;
    trainingBonus += Number(card.fs_training || 0) + unique.rainbowTrainingDelta;
    motivationBonus +=
      Number(card.fs_motivation || 0) + unique.rainbowMotivationDelta;
    friendshipBonus *=
      Number(card.fs_bonus || 1) *
      (Number(card.unique_fs_bonus || 1) + unique.friendshipDelta);
    for (let stat = 0; stat < 6; stat++)
      statBonus[stat] +=
        Number(card.fs_stats?.[stat] || 0) +
        Number(unique.rainbowStatBonusDelta[stat] || 0);
  }

  const crowd = crowdMultiplier(supports);
  const result = new Array(6).fill(0);
  for (let stat = 0; stat < 6; stat++) {
    if (!gains[stat]) continue;
    result[stat] =
      (Number(gains[stat]) + statBonus[stat]) *
      trainingBonus *
      (1 + motivation * motivationBonus) *
      friendshipBonus *
      crowd *
      Number(growth[stat] || 1);
  }
  return result;
}

/**
 * What one card adds to a training click: the click with the card minus the
 * same click without it. The baseline keeps the trainee's own mood and growth
 * multipliers, which apply whether or not the card is present.
 */
export function calculateMarginalTraining(card, trainingType, options = {}) {
  const supports = Math.max(
    1,
    Number(options.supportsOnTraining ?? GLOBAL_UNIQUE_CONTEXT.supportsOnTraining),
  );
  const shared = {
    ...options,
    trainingType,
    gains: options.gains || TRAINING_PROFILES["gl-late"].gains[trainingType],
    extraSupports: supports - 1,
  };
  const withCard = trainingValue(
    [{ card, rainbow: Boolean(options.rainbow) }],
    shared,
  );
  const withoutCard = trainingValue([], shared);
  return withCard.map((value, stat) => value - withoutCard[stat]);
}

export function normalizeStatWeights(statWeights) {
  const source = Array.isArray(statWeights) ? statWeights : [];
  return new Array(5)
    .fill(1)
    .map((_, stat) =>
      Number.isFinite(Number(source[stat])) ? Number(source[stat]) : 1,
    );
}

export function weightedSum(vector, spWeight = 1.2, statWeights = null) {
  const weights = normalizeStatWeights(statWeights);
  return vector.reduce(
    (sum, value, index) =>
      sum + value * (index === 5 ? spWeight : weights[index]),
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
  const statWeights = normalizeStatWeights(options.statWeights);
  const facilityLevel = clampFacilityLevel(
    options.facilityLevel ?? profile.facilityLevel ?? 3,
  );
  const uniqueOptions = { ...options, facilityLevel };
  const appearance = calculateAppearance(card, globalSpecialty, uniqueOptions);
  const specialty = hasTrainingSpecialty(card);
  const rainbowMarginal = specialty
    ? calculateMarginalTraining(card, card.type, {
        ...uniqueOptions,
        gains: profile.gains[card.type],
        motivation,
        growth,
        rainbow: true,
      })
    : new Array(6).fill(0);
  const specialtyVector = rainbowMarginal.map(
    (value) => value * appearance.specialty,
  );
  const offVector = new Array(6).fill(0);

  for (let trainingType = 0; trainingType < 5; trainingType++) {
    if (specialty && trainingType === Number(card.type)) continue;
    const marginal = calculateMarginalTraining(card, trainingType, {
      ...uniqueOptions,
      gains: profile.gains[trainingType],
      motivation,
      growth,
      rainbow: false,
    });
    for (let stat = 0; stat < 6; stat++)
      offVector[stat] += marginal[stat] * appearance.eachOff;
  }

  const allPlacementVector = specialtyVector.map(
    (value, index) => value + offVector[index],
  );
  return {
    appearance,
    facilityLevel,
    hasSpecialty: specialty,
    rainbowMarginal,
    specialtyVector,
    offVector,
    allPlacementVector,
    rainbowScore: weightedSum(rainbowMarginal, spWeight, statWeights),
    specialtyScore: weightedSum(specialtyVector, spWeight, statWeights),
    allPlacementScore: weightedSum(allPlacementVector, spWeight, statWeights),
  };
}

export function remoteSupportImageUrl(id) {
  return `https://raw.githubusercontent.com/Euophrys/umamusume-tierlist/main/public/cardImages/support_card_s_${id}.png`;
}

/**
 * Card art is copied into the deploy artifact, so the page serves its own
 * images and only falls back to the upstream host when a file is missing.
 */
export function supportImageUrl(id) {
  return `./img/support_card_s_${id}.png`;
}

export function portraitImageUrl(card) {
  return card?.portrait_url ? String(card.portrait_url) : supportImageUrl(card.id);
}

if (typeof document !== "undefined") import("./app-ui.mjs");
