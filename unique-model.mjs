export const GLOBAL_UNIQUE_COVERAGE = "Grand Concert / 1.5 Anniversary";

export const UNIQUE_PROFILE_COVERAGE = {
  "unity-late": GLOBAL_UNIQUE_COVERAGE,
  "gl-late": GLOBAL_UNIQUE_COVERAGE,
  "gl-summer": GLOBAL_UNIQUE_COVERAGE,
};

export const GLOBAL_UNIQUE_CONTEXT = {
  bond: 80,
  deckTypes: 5,
  fans: 200000,
  currentEnergy: 50,
  maxEnergy: 100,
  totalBond: 450,
  supportsOnTraining: 1,
  friendshipTrainings: 5,
};

const SUPPORTED_SPECIAL_TYPES = new Set([
  101, 102, 103, 104, 106, 107, 108, 109, 110, 111,
]);

const FLATTENED_TRAINING_TYPES = new Set([
  1, 2, 3, 4, 5, 6, 7, 8, 14, 19, 30, 32,
]);

const OUTSIDE_METRIC_TYPES = new Map([
  [9, "initial Speed from the unique is outside the training-output metric"],
  [10, "initial Stamina from the unique is outside the training-output metric"],
  [11, "initial Power from the unique is outside the training-output metric"],
  [12, "initial Guts from the unique is outside the training-output metric"],
  [13, "initial Wit from the unique is outside the training-output metric"],
  [15, "race-bonus value from the unique is outside the training-output metric"],
  [18, "hint-rate value from the unique is outside the training-output metric"],
  [25, "energy-gain value from the unique is outside the current action-economy model"],
  [26, "event-effect-size value from the unique is outside the training-output metric"],
  [27, "failure-rate value from the unique is outside the current risk model"],
  [28, "energy-cost value from the unique is outside the current action-economy model"],
  [31, "Wit energy-recovery value from the unique is outside the current action-economy model"],
  [105, "deck-composition initial stats are outside the training-output metric"],
  [112, "failure-protection value is outside the current training-output model"],
]);

const TYPE_101_SUPPORTED_BONUSES = new Set([1, 2, 3, 4, 5, 6, 7, 8, 19, 30, 41]);
const TYPE_101_STAT_INDEX = new Map([
  [3, 0],
  [4, 1],
  [5, 2],
  [6, 3],
  [7, 4],
  [30, 5],
]);
const TYPE_101_OUTSIDE_BONUSES = new Map([
  [31, "Wit energy recovery from the bond-gated unique is outside the current action-economy model"],
]);

function n(value, fallback = 0) {
  const result = Number(value);
  return Number.isFinite(result) ? result : fallback;
}

function effects(card) {
  return Array.isArray(card?.special_uniques) ? card.special_uniques : [];
}

function hasMetadata(card) {
  return Array.isArray(card?.special_uniques);
}

function context(options = {}) {
  return {
    bond: n(options.bond, GLOBAL_UNIQUE_CONTEXT.bond),
    deckTypes: n(options.deckTypes, GLOBAL_UNIQUE_CONTEXT.deckTypes),
    fans: n(options.fans, GLOBAL_UNIQUE_CONTEXT.fans),
    currentEnergy: n(options.currentEnergy, GLOBAL_UNIQUE_CONTEXT.currentEnergy),
    maxEnergy: n(options.maxEnergy, GLOBAL_UNIQUE_CONTEXT.maxEnergy),
    totalBond: n(options.totalBond, GLOBAL_UNIQUE_CONTEXT.totalBond),
    supportsOnTraining: n(
      options.supportsOnTraining,
      GLOBAL_UNIQUE_CONTEXT.supportsOnTraining,
    ),
    friendshipTrainings: n(
      options.friendshipTrainings,
      GLOBAL_UNIQUE_CONTEXT.friendshipTrainings,
    ),
    facilityLevel: Math.max(1, Math.min(5, n(options.facilityLevel, 3))),
  };
}

function type101BonusPairs(effect) {
  return [
    [n(effect?.value_1), n(effect?.value_2)],
    [n(effect?.value_3), n(effect?.value_4)],
  ].filter(([bonusType, value]) => bonusType > 0 && value !== 0);
}

function type101Modifiers(card, bond) {
  const flattened = {
    friendship: 0,
    motivation: 0,
    training: 0,
    specialty: 0,
    stats: new Array(6).fill(0),
  };
  const active = {
    friendship: 0,
    motivation: 0,
    training: 0,
    specialty: 0,
    stats: new Array(6).fill(0),
  };

  for (const effect of effects(card)) {
    if (Number(effect?.type) !== 101) continue;
    const destination = bond >= n(effect.value, 80) ? active : null;
    for (const [bonusType, value] of type101BonusPairs(effect)) {
      const statIndex = TYPE_101_STAT_INDEX.get(bonusType);
      if (statIndex !== undefined) {
        flattened.stats[statIndex] += value;
        if (destination) destination.stats[statIndex] += value;
      } else if (bonusType === 41) {
        for (let stat = 0; stat < 5; stat++) {
          flattened.stats[stat] += value;
          if (destination) destination.stats[stat] += value;
        }
      } else if (bonusType === 1) {
        flattened.friendship += value / 100;
        if (destination) destination.friendship += value / 100;
      } else if (bonusType === 2) {
        flattened.motivation += value / 100;
        if (destination) destination.motivation += value / 100;
      } else if (bonusType === 8) {
        flattened.training += value / 100;
        if (destination) destination.training += value / 100;
      } else if (bonusType === 19) {
        flattened.specialty += value / 100;
        if (destination) destination.specialty += value;
      }
    }
  }

  // Euophrys flattens type 101 into friendship-only fields. Remove only the
  // portion that is actually present, so raw-only fixtures are not over-corrected.
  const baked = {
    friendship: Math.min(
      flattened.friendship,
      Math.max(0, n(card?.unique_fs_bonus, 1) - 1),
    ),
    motivation: Math.min(
      flattened.motivation,
      Math.max(0, n(card?.fs_motivation)),
    ),
    training: Math.min(
      flattened.training,
      Math.max(0, n(card?.fs_training)),
    ),
    specialty: Math.min(
      flattened.specialty,
      Math.max(0, n(card?.fs_specialty, 1) - 1),
    ),
    stats: flattened.stats.map((value, stat) =>
      Math.min(value, Math.max(0, n(card?.fs_stats?.[stat]))),
    ),
  };

  return { active, baked };
}

export function specialUniqueTypes(card) {
  return effects(card)
    .map((effect) => Number(effect?.type))
    .filter(Number.isFinite);
}

export function hasFacilityLevelUnique(card) {
  return effects(card).some((effect) => Number(effect?.type) === 111);
}

export function facilityTrainingBonus(card, facilityLevel = 3) {
  let result = n(card?.tb, 1);
  for (const effect of effects(card)) {
    if (Number(effect?.type) !== 111) continue;
    const perLevel = n(effect.value_1, 5) / 100;
    result += Math.max(1, Math.min(5, n(facilityLevel, 3))) * perLevel - 0.15;
  }
  return result;
}

export function resolveUniqueModifiers(card, trainingType, options = {}) {
  const uniqueContext = context(options);
  const rainbow = Boolean(options.rainbow);
  const type101 = type101Modifiers(card, uniqueContext.bond);
  let trainingDelta = type101.active.training;
  let rainbowTrainingDelta = -type101.baked.training;
  let motivationDelta = type101.active.motivation;
  let rainbowMotivationDelta = -type101.baked.motivation;
  let friendshipDelta =
    type101.active.friendship - type101.baked.friendship;

  for (const effect of effects(card)) {
    const type = Number(effect?.type);
    switch (type) {
      case 102: {
        rainbowTrainingDelta -= 0.2;
        if (
          uniqueContext.bond >= n(effect.value, 80) &&
          Number(trainingType) !== Number(card.type)
        )
          trainingDelta += n(effect.value_1, 20) / 100;
        break;
      }
      case 103:
        if (uniqueContext.deckTypes >= n(effect.value))
          trainingDelta += n(effect.value_1) / 100;
        break;
      case 104: {
        const fansPerPoint = Math.max(1, n(effect.value, 10000));
        const maxPoints = Math.max(0, n(effect.value_1, 20));
        trainingDelta +=
          Math.min(maxPoints, Math.floor(Math.max(0, uniqueContext.fans) / fansPerPoint)) /
          100;
        break;
      }
      case 106:
        if (rainbow) {
          const maxTrainings = Math.max(0, n(effect.value, 5));
          const step = Math.max(0, n(effect.value_2, 3));
          friendshipDelta +=
            Math.min(maxTrainings, Math.max(0, uniqueContext.friendshipTrainings)) *
            step /
            100;
        }
        break;
      case 107:
        if (rainbow) {
          const energyFloor = n(effect.value_2, 30);
          const maxBonus = n(effect.value_3, 15);
          const minBonus = n(effect.value_4, 5);
          const energy = Math.max(energyFloor, uniqueContext.currentEnergy);
          const percent = Math.max(
            minBonus,
            maxBonus - Math.floor((energy - energyFloor) * 0.15),
          );
          friendshipDelta += percent / 100 - 0.07;
        }
        break;
      case 108: {
        const baselineEnergy = n(effect.value_1, 100);
        const energyStep = 4;
        const bonusPerStep = 3;
        const basePercent = n(effect.value_3, 5);
        const capPercent = n(effect.value_4, 20);
        const steps = Math.max(
          0,
          Math.floor((uniqueContext.maxEnergy - baselineEnergy) / energyStep),
        );
        const actual =
          Math.min(capPercent, basePercent + steps * bonusPerStep) / 100;
        trainingDelta += actual - 0.12;
        break;
      }
      case 109: {
        const bondPerPoint = Math.max(1, n(effect.value_1, 30));
        const actual =
          Math.min(20, Math.floor(Math.max(0, uniqueContext.totalBond) / bondPerPoint)) /
          100;
        trainingDelta += actual - 0.15;
        break;
      }
      case 110:
        trainingDelta +=
          Math.max(1, Math.min(5, uniqueContext.supportsOnTraining)) *
          n(effect.value_1, 5) /
          100;
        break;
    }
  }

  return {
    trainingDelta,
    rainbowTrainingDelta,
    motivationDelta,
    rainbowMotivationDelta,
    friendshipDelta,
    conditionalStatBonus: type101.active.stats,
    rainbowStatBonusDelta: type101.baked.stats.map((value) => -value),
    conditionalSpecialtyRate: type101.active.specialty,
    flattenedSpecialtyFactorDelta: type101.baked.specialty,
    context: uniqueContext,
  };
}

function type101Warnings(effect) {
  const warnings = [];
  for (const key of ["value_1", "value_3"]) {
    const bonusType = Number(effect?.[key]);
    if (!Number.isFinite(bonusType) || bonusType <= 0) continue;
    if (TYPE_101_SUPPORTED_BONUSES.has(bonusType)) continue;
    warnings.push(
      TYPE_101_OUTSIDE_BONUSES.get(bonusType) ||
        `bond-gated bonus type ${bonusType} is not modeled`,
    );
  }
  return warnings;
}

export function uniqueModelWarnings(card, profileKey = "gl-late") {
  if (!hasMetadata(card))
    return ["raw unique metadata was unavailable for this support"];

  const warnings = [];
  const coverage =
    UNIQUE_PROFILE_COVERAGE[profileKey] || GLOBAL_UNIQUE_COVERAGE;
  for (const effect of effects(card)) {
    const type = Number(effect?.type);
    if (!Number.isFinite(type)) {
      warnings.push("an unrecognized unique effect is present");
      continue;
    }
    if (type === 101) {
      warnings.push(...type101Warnings(effect));
      continue;
    }
    if (SUPPORTED_SPECIAL_TYPES.has(type) || FLATTENED_TRAINING_TYPES.has(type))
      continue;
    const outside = OUTSIDE_METRIC_TYPES.get(type);
    if (outside) {
      warnings.push(outside);
      continue;
    }
    warnings.push(`unique type ${type} is not certified for ${coverage}`);
  }
  return [...new Set(warnings)];
}

export function averageFriendshipTrainingsForCareer(card, rainbowClicks) {
  const ramp = effects(card).find((effect) => Number(effect?.type) === 106);
  if (!ramp || rainbowClicks <= 0) return 0;
  const maxTrainings = Math.max(0, n(ramp.value, 5));
  const fullClicks = Math.floor(rainbowClicks);
  const fractional = Math.max(0, rainbowClicks - fullClicks);
  let weightedCount = 0;
  let weight = 0;
  for (let click = 0; click < fullClicks; click++) {
    weightedCount += Math.min(click, maxTrainings);
    weight += 1;
  }
  if (fractional > 0) {
    weightedCount += Math.min(fullClicks, maxTrainings) * fractional;
    weight += fractional;
  }
  return weight > 0 ? weightedCount / weight : 0;
}
