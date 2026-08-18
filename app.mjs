import {
  GLOBAL_UNIQUE_CONTEXT,
  GLOBAL_UNIQUE_COVERAGE,
  UNIQUE_PROFILE_COVERAGE,
  facilityTrainingBonus,
  hasFacilityLevelUnique,
  resolveUniqueModifiers,
  uniqueModelWarnings,
} from "./unique-model.mjs";

export {
  GLOBAL_UNIQUE_CONTEXT,
  GLOBAL_UNIQUE_COVERAGE,
  UNIQUE_PROFILE_COVERAGE,
  facilityTrainingBonus,
  hasFacilityLevelUnique,
  uniqueModelWarnings,
};

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
export const STORAGE_KEY = "uma-stat-output:v1";

export function clampFacilityLevel(value) {
  return Math.max(1, Math.min(5, Number(value) || 1));
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
  const specialtyWeight =
    (BASE_SPECIALTY_WEIGHT +
      Number(card.specialty_rate || 0) +
      Number(globalSpecialty || 0) +
      unique.conditionalSpecialtyRate) *
    Number(card.unique_specialty || 1) *
    (Number(card.fs_specialty || 1) - unique.flattenedSpecialtyFactorDelta);
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
  const unique = resolveUniqueModifiers(card, trainingType, options);

  let trainingBonus =
    facilityTrainingBonus(card, facilityLevel) + unique.trainingDelta;
  let motivationBonus = Number(card.mb || 1) + unique.motivationDelta;
  let friendshipBonus = 1;
  if (rainbow) {
    trainingBonus +=
      Number(card.fs_training || 0) + unique.rainbowTrainingDelta;
    motivationBonus +=
      Number(card.fs_motivation || 0) + unique.rainbowMotivationDelta;
    friendshipBonus =
      Number(card.fs_bonus || 1) *
      (Number(card.unique_fs_bonus || 1) + unique.friendshipDelta);
  }

  const result = new Array(6).fill(0);
  for (let stat = 0; stat < 6; stat++) {
    if (!gains[stat]) continue;
    let base =
      Number(gains[stat]) +
      Number(card.stat_bonus?.[stat] || 0) +
      Number(unique.conditionalStatBonus[stat] || 0);
    if (rainbow)
      base +=
        Number(card.fs_stats?.[stat] || 0) +
        Number(unique.rainbowStatBonusDelta[stat] || 0);
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
  const uniqueOptions = { ...options, facilityLevel };
  const appearance = calculateAppearance(card, globalSpecialty, uniqueOptions);
  const rainbowMarginal = calculateMarginalTraining(card, card.type, {
    ...uniqueOptions,
    gains: profile.gains[card.type],
    motivation,
    growth,
    rainbow: true,
  });
  const specialtyVector = rainbowMarginal.map(
    (value) => value * appearance.specialty,
  );
  const offVector = new Array(6).fill(0);

  for (let trainingType = 0; trainingType < 5; trainingType++) {
    if (trainingType === card.type) continue;
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
    rainbowMarginal,
    specialtyVector,
    offVector,
    allPlacementVector,
    rainbowScore: weightedSum(rainbowMarginal, spWeight),
    specialtyScore: weightedSum(specialtyVector, spWeight),
    allPlacementScore: weightedSum(allPlacementVector, spWeight),
  };
}

export function supportImageUrl(id) {
  return `https://raw.githubusercontent.com/Euophrys/umamusume-tierlist/main/public/cardImages/support_card_s_${id}.png`;
}

export function portraitImageUrl(card) {
  return supportImageUrl(card.id);
}

if (typeof document !== "undefined") import("./app-ui.mjs");
