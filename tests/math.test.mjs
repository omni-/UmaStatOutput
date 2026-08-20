import test from "node:test";
import assert from "node:assert/strict";
import {
  TRAINING_PROFILES,
  averageFacilityLevel,
  calculateAppearance,
  calculateCardEV,
  calculateMarginalTraining,
  effectiveStartingBond,
  effectiveStartingStats,
  facilityLevelAtTurn,
  facilityTrainingBonus,
  GLOBAL_UNIQUE_CONTEXT,
  remoteSupportImageUrl,
  specialUniqueUnlocked,
  supportImageUrl,
  trainingValue,
  turnsPerFacilityLevel,
  typeLabel,
  uniqueModelWarnings,
} from "../app.mjs";
import {
  GRAND_LIVE_RUN,
  GRAND_LIVE_SUMMER_RUN,
  UNITY_CUP_RUN,
  baseGainsSwitchTurn,
  bondSourceLabel,
  calculateCareerProjection,
} from "../career.mjs";
import { calculateDeckProjection } from "../deck.mjs";
import { resolveUniqueModifiers } from "../unique-model.mjs";

const card = {
  id: 99999,
  type: 0,
  rarity: 3,
  specialty_rate: 80,
  unique_specialty: 1.2,
  fs_specialty: 1,
  tb: 1.15,
  mb: 1.3,
  fs_bonus: 1.2,
  unique_fs_bonus: 1,
  stat_bonus: [1, 0, 0, 0, 0, 0],
  fs_stats: [0, 0, 0, 0, 0, 0],
  fs_training: 0,
  fs_motivation: 0,
  fs_ramp: [0, 0],
  sb: 35,
  offstat_appearance_denominator: 4,
  event_stats: [20, 0, 10, 0, 0, 30, 0, 10],
  special_uniques: [],
};

test("appearance formula reproduces Euophrys Kitasan example", () => {
  const r = calculateAppearance(card, 0);
  assert.equal(r.specialtyWeight, 216);
  assert.ok(Math.abs(r.specialty - 216 / 666) < 1e-12);
});

test("Grand Live +20 appearance rate is numerically pinned", () => {
  const r = calculateAppearance(card, 20);
  assert.equal(r.specialtyWeight, 240);
  assert.equal(r.denominator, 690);
  assert.ok(Math.abs(r.specialty - 8 / 23) < 1e-12);
});

test("Grand Live profile defaults to +20 Specialty Priority", () => {
  const r = calculateCardEV(card);
  assert.ok(Math.abs(r.appearance.specialty - 8 / 23) < 1e-12);
});

test("Unity Cup late-run preset uses requested environment defaults", () => {
  const profile = TRAINING_PROFILES["unity-late"];
  assert.equal(profile.globalSpecialty, 0);
  assert.equal(profile.spWeight, 1);
  assert.equal(profile.facilityLevel, 5);
  assert.equal(profile.facilityPace, 50);
  assert.deepEqual(profile.gains[0], [12, 0, 5, 0, 0, 4]);
  assert.ok(profile.facilityPace < TRAINING_PROFILES["gl-late"].facilityPace);
});

test("global specialty priority raises preferred appearance and lowers each off-type appearance", () => {
  const a = calculateAppearance(card, 0);
  const b = calculateAppearance(card, 20);
  assert.ok(b.specialty > a.specialty);
  assert.ok(b.eachOff < a.eachOff);
});

test("appearance probabilities sum to one", () => {
  const r = calculateAppearance(card, 20);
  assert.ok(Math.abs(r.specialty + r.eachOff * 4 + r.none - 1) < 1e-12);
});

test("card EV returns positive specialty output", () => {
  const r = calculateCardEV(card, {
    globalSpecialty: 20,
    profile: "gl-late",
    motivation: 0.2,
    growth: [1, 1, 1, 1, 1, 1],
    spWeight: 1,
    facilityLevel: 5,
  });
  assert.ok(r.rainbowScore > 0);
  assert.ok(r.allPlacementScore >= r.specialtyScore);
});

test("known rainbow marginal vector is numerically pinned", () => {
  const vector = calculateMarginalTraining(card, 0, {
    gains: [11, 0, 5, 0, 0, 2],
    motivation: 0.2,
    growth: [1, 1, 1, 1, 1, 1],
    rainbow: true,
  });
  assert.deepEqual(
    vector.map((value) => Number(value.toFixed(6))),
    [8.70888, 0, 3.1287, 0, 0, 1.25148],
  );
});

test("known pre-bond marginal vector is numerically pinned", () => {
  const vector = calculateMarginalTraining(card, 0, {
    gains: GRAND_LIVE_RUN.unbondedGains[0],
    motivation: 0.2,
    growth: [1, 1, 1, 1, 1, 1],
    rainbow: false,
  });
  assert.deepEqual(
    vector.map((value) => Number(value.toFixed(6))),
    [4.09305, 0, 1.2858, 0, 0, 0.6429],
  );
});

test("marginal value is measured against the same click without the card", () => {
  const gains = [11, 0, 5, 0, 0, 2];
  const options = { gains, motivation: 0.2, growth: [1, 1, 1, 1, 1, 1] };
  const marginal = calculateMarginalTraining(card, 0, options);
  const withCard = trainingValue([{ card, rainbow: false }], {
    ...options,
    trainingType: 0,
  });
  const withoutCard = trainingValue([], { ...options, trainingType: 0 });

  // The empty room still gets the trainee's own mood multiplier, so the card is
  // never credited with output that happens without it.
  assert.equal(withoutCard[0], gains[0] * 1.2);
  assert.ok(Math.abs(marginal[0] - (withCard[0] - withoutCard[0])) < 1e-12);
});

test("uma growth scales the card's own contribution, not the base gain", () => {
  const options = { gains: [11, 0, 5, 0, 0, 2], motivation: 0.2, rainbow: true };
  const flat = calculateMarginalTraining(card, 0, options);
  const grown = calculateMarginalTraining(card, 0, {
    ...options,
    growth: [1.2, 1, 1, 1, 1, 1],
  });
  assert.ok(Math.abs(grown[0] - flat[0] * 1.2) < 1e-12);
});

test("a busier training raises the crowd multiplier on both sides", () => {
  const options = { gains: [11, 0, 5, 0, 0, 2], motivation: 0.2, rainbow: true };
  const solo = calculateMarginalTraining(card, 0, {
    ...options,
    supportsOnTraining: 1,
  });
  const crowded = calculateMarginalTraining(card, 0, {
    ...options,
    supportsOnTraining: 3,
  });
  assert.ok(crowded[0] > solo[0]);

  // A support with no bonuses at all is worth exactly the 5% it adds to the
  // crowd multiplier, whichever side of it the other bodies sit on.
  const inert = {
    ...card,
    tb: 1,
    mb: 1,
    fs_bonus: 1,
    unique_fs_bonus: 1,
    stat_bonus: [0, 0, 0, 0, 0, 0],
  };
  const baseValue = 11 * 1.2;
  for (const supportsOnTraining of [1, 2, 5]) {
    const vector = calculateMarginalTraining(inert, 0, {
      ...options,
      supportsOnTraining,
    });
    assert.ok(Math.abs(vector[0] - baseValue * 0.05) < 1e-12);
  }
});

test("friendship specialty priority only applies while the card is bonded", () => {
  const friendshipSpecialty = { ...card, fs_specialty: 1.35 };
  const unbonded = calculateAppearance(friendshipSpecialty, 20, { bond: 0 });
  const bonded = calculateAppearance(friendshipSpecialty, 20, { bond: 100 });
  assert.ok(unbonded.specialty < bonded.specialty);
  assert.equal(unbonded.friendshipSpecialtyActive, false);
  assert.equal(bonded.friendshipSpecialtyActive, true);
  assert.ok(
    Math.abs(unbonded.specialtyWeight - bonded.specialtyWeight / 1.35) < 1e-9,
  );
  // A card without the friendship multiplier is unaffected by bond.
  assert.equal(
    calculateAppearance(card, 20, { bond: 0 }).specialty,
    calculateAppearance(card, 20, { bond: 100 }).specialty,
  );
});

test("facility-level unique is driven by raw type 111, not support id", () => {
  const smaru = {
    ...card,
    id: 987654,
    tb: 1.15,
    special_uniques: [{ type: 111, value: 8, value_1: 5 }],
  };
  assert.ok(Math.abs(facilityTrainingBonus(smaru, 1) - 1.05) < 1e-12);
  assert.ok(Math.abs(facilityTrainingBonus(smaru, 3) - 1.15) < 1e-12);
  assert.ok(Math.abs(facilityTrainingBonus(smaru, 5) - 1.25) < 1e-12);
  const lv3 = calculateCardEV(smaru, { profile: "gl-late", facilityLevel: 3 });
  const lv5 = calculateCardEV(smaru, { profile: "gl-late", facilityLevel: 5 });
  assert.ok(lv5.rainbowScore > lv3.rainbowScore);
  assert.ok(lv5.specialtyScore > lv3.specialtyScore);
});

test("deck-diversity unique is driven by type 103", () => {
  const digitalLike = {
    ...card,
    id: 888888,
    special_uniques: [{ type: 103, value: 5, value_1: 15 }],
  };
  const off = calculateCardEV(digitalLike, { deckTypes: 4 });
  const on = calculateCardEV(digitalLike, { deckTypes: 5 });
  assert.ok(on.rainbowScore > off.rainbowScore);
});

test("Mr CB type 101 stat/SP unique is fully modeled without a card-id exception", () => {
  const mrCb = {
    ...card,
    id: 30097,
    type: 4,
    fs_stats: [0, 0, 0, 0, 1, 1],
    special_uniques: [
      { type: 101, value: 80, value_1: 7, value_2: 1, value_3: 30, value_4: 1 },
    ],
  };
  assert.deepEqual(uniqueModelWarnings(mrCb, "gl-late"), []);
});

test("type 101 SP bonus activates at its bond threshold on every placement", () => {
  const spUnique = {
    ...card,
    id: 910101,
    stat_bonus: [0, 0, 0, 0, 0, 0],
    fs_stats: [0, 0, 0, 0, 0, 0],
    tb: 1,
    mb: 1,
    fs_bonus: 1,
    special_uniques: [
      { type: 101, value: 80, value_1: 30, value_2: 1 },
    ],
  };
  const withoutUnique = { ...spUnique, special_uniques: [] };
  const calculate = (candidate, trainingType, bond) =>
    calculateMarginalTraining(candidate, trainingType, {
      gains: TRAINING_PROFILES["gl-late"].gains[trainingType],
      motivation: 0,
      rainbow: false,
      bond,
    });

  assert.deepEqual(calculate(spUnique, 0, 79), calculate(withoutUnique, 0, 79));
  const specialtyBefore = calculate(spUnique, 0, 79);
  const specialtyAfter = calculate(spUnique, 0, 80);
  const offBefore = calculate(spUnique, 1, 79);
  const offAfter = calculate(spUnique, 1, 80);
  assert.ok(specialtyAfter[5] > specialtyBefore[5]);
  assert.ok(offAfter[5] > offBefore[5]);
  assert.ok(Math.abs(specialtyAfter[5] - specialtyBefore[5] - 1.05) < 1e-12);
  assert.ok(Math.abs(offAfter[5] - offBefore[5] - 1.05) < 1e-12);
});

test("type 101 stat bonus augments an existing training component only", () => {
  const powerUnique = {
    ...card,
    id: 910102,
    stat_bonus: [0, 0, 0, 0, 0, 0],
    fs_stats: [0, 0, 0, 0, 0, 0],
    tb: 1,
    mb: 1,
    special_uniques: [
      { type: 101, value: 80, value_1: 5, value_2: 1 },
    ],
  };
  const speedBefore = calculateMarginalTraining(powerUnique, 0, {
    gains: TRAINING_PROFILES["gl-late"].gains[0],
    motivation: 0,
    rainbow: false,
    bond: 79,
  });
  const speedAfter = calculateMarginalTraining(powerUnique, 0, {
    gains: TRAINING_PROFILES["gl-late"].gains[0],
    motivation: 0,
    rainbow: false,
    bond: 80,
  });
  const witAfter = calculateMarginalTraining(powerUnique, 4, {
    gains: TRAINING_PROFILES["gl-late"].gains[4],
    motivation: 0,
    rainbow: false,
    bond: 80,
  });

  assert.ok(Math.abs(speedAfter[2] - speedBefore[2] - 1.05) < 1e-12);
  assert.equal(witAfter[2], 0);
});

test("type 101 resolves every supported ordinary bonus family", () => {
  const allFamilies = {
    ...card,
    id: 910105,
    unique_fs_bonus: 1.1,
    fs_motivation: 0.2,
    fs_training: 0.15,
    fs_specialty: 1.3,
    fs_stats: [2, 2, 2, 2, 2, 0],
    special_uniques: [
      { type: 101, value: 80, value_1: 1, value_2: 10, value_3: 2, value_4: 20 },
      { type: 101, value: 80, value_1: 8, value_2: 15, value_3: 19, value_4: 30 },
      { type: 101, value: 80, value_1: 41, value_2: 2 },
    ],
  };
  const before = resolveUniqueModifiers(allFamilies, 0, { bond: 79 });
  const after = resolveUniqueModifiers(allFamilies, 0, { bond: 80 });

  assert.equal(before.trainingDelta, 0);
  assert.equal(before.motivationDelta, 0);
  assert.equal(before.conditionalSpecialtyFactor, 0);
  assert.deepEqual(before.conditionalStatBonus, [0, 0, 0, 0, 0, 0]);
  assert.ok(Math.abs(after.trainingDelta - 0.15) < 1e-12);
  assert.ok(Math.abs(after.motivationDelta - 0.2) < 1e-12);
  assert.ok(Math.abs(after.friendshipDelta) < 1e-12);
  assert.ok(Math.abs(after.conditionalSpecialtyFactor - 0.3) < 1e-12);
  assert.deepEqual(after.conditionalStatBonus, [2, 2, 2, 2, 2, 0]);

  const rawOnly = { ...allFamilies, fs_specialty: 1 };
  const flattenedBefore = calculateAppearance(allFamilies, 0, { bond: 79 });
  const rawBefore = calculateAppearance(rawOnly, 0, { bond: 79 });
  const flattenedAfter = calculateAppearance(allFamilies, 0, { bond: 80 });
  const rawAfter = calculateAppearance(rawOnly, 0, { bond: 80 });
  assert.deepEqual(flattenedBefore, rawBefore);
  assert.deepEqual(flattenedAfter, rawAfter);
  assert.ok(flattenedAfter.specialty > flattenedBefore.specialty);

  // Specialty Priority from a unique is a multiplier on the whole weight, not
  // extra weight points added to the base: a 30 here means ×1.3.
  assert.ok(
    Math.abs(flattenedAfter.specialtyWeight - flattenedBefore.specialtyWeight * 1.3) <
      1e-9,
  );
});

test("Mr CB type 101 grants post-bond SP on off-specialty career placements", () => {
  const mrCb = {
    ...card,
    id: 30097,
    type: 4,
    fs_stats: [0, 0, 0, 0, 1, 1],
    special_uniques: [
      { type: 101, value: 80, value_1: 7, value_2: 1, value_3: 30, value_4: 1 },
    ],
  };
  const oldFlattenedBehavior = { ...mrCb, special_uniques: [] };
  const offBefore = calculateMarginalTraining(mrCb, 0, {
    gains: GRAND_LIVE_RUN.bondedGains[0],
    rainbow: false,
    bond: 79,
  });
  const offAfter = calculateMarginalTraining(mrCb, 0, {
    gains: GRAND_LIVE_RUN.bondedGains[0],
    rainbow: false,
    bond: 80,
  });
  const fixedRun = calculateCareerProjection(mrCb);
  const buggyRun = calculateCareerProjection(oldFlattenedBehavior);

  assert.ok(offAfter[5] > offBefore[5]);
  assert.ok(fixedRun.vector[5] > buggyRun.vector[5]);
});

test("type 101 upstream stat flattening is removed before raw bonuses apply", () => {
  const rawOnly = {
    ...card,
    id: 910103,
    stat_bonus: [0, 0, 0, 0, 0, 0],
    fs_stats: [0, 0, 0, 0, 0, 0],
    special_uniques: [
      { type: 101, value: 80, value_1: 30, value_2: 1 },
    ],
  };
  const flattened = { ...rawOnly, fs_stats: [0, 0, 0, 0, 0, 1] };
  const calculate = (candidate, bond) =>
    calculateMarginalTraining(candidate, 0, {
      gains: TRAINING_PROFILES["gl-late"].gains[0],
      rainbow: true,
      bond,
    });

  assert.deepEqual(calculate(flattened, 80), calculate(rawOnly, 80));
  assert.deepEqual(calculate(flattened, 79), calculate(rawOnly, 79));
});

test("ordinary fs_stats remain friendship-only", () => {
  const friendshipOnly = {
    ...card,
    id: 910104,
    stat_bonus: [0, 0, 0, 0, 0, 0],
    fs_stats: [0, 0, 1, 0, 0, 0],
    special_uniques: [],
  };
  const withoutFriendshipStat = {
    ...friendshipOnly,
    fs_stats: [0, 0, 0, 0, 0, 0],
  };
  const calculate = (candidate, rainbow) =>
    calculateMarginalTraining(candidate, 0, {
      gains: TRAINING_PROFILES["gl-late"].gains[0],
      rainbow,
    });

  assert.ok(calculate(friendshipOnly, true)[2] > calculate(withoutFriendshipStat, true)[2]);
  assert.deepEqual(
    calculate(friendshipOnly, false),
    calculate(withoutFriendshipStat, false),
  );
});

test("type 112 is disclosed by mechanic rather than support id", () => {
  const festaLike = {
    ...card,
    id: 777777,
    special_uniques: [{ type: 112, value: 20 }],
  };
  assert.match(uniqueModelWarnings(festaLike, "gl-late")[0], /failure-protection/);
});

test("race bonus uniques are silently excluded from the training model", () => {
  const raceBonus = {
    ...card,
    id: 777778,
    special_uniques: [
      { type: 2, value: 15 },
      { type: 15, value: 5 },
    ],
  };
  assert.deepEqual(uniqueModelWarnings(raceBonus, "gl-late"), []);
});

test("unknown unique types retain scenario coverage warning", () => {
  const future = {
    ...card,
    id: 666666,
    future: true,
    special_uniques: [{ type: 120, value: 1 }],
  };
  assert.match(
    uniqueModelWarnings(future, "gl-late")[0],
    /not certified for Grand Concert \/ 1.5 Anniversary/,
  );
});

test("type 108 max-energy scaling is mechanic-driven and removes upstream bake", () => {
  const pearl = {
    ...card,
    id: 818181,
    tb: 1.12,
    special_uniques: [
      { type: 108, value: 8, value_1: 100, value_2: 75, value_3: 5, value_4: 20 },
    ],
  };
  const baseline = calculateMarginalTraining(pearl, pearl.type, {
    gains: TRAINING_PROFILES["gl-late"].gains[pearl.type],
    rainbow: true,
    maxEnergy: 100,
  });
  const raised = calculateMarginalTraining(pearl, pearl.type, {
    gains: TRAINING_PROFILES["gl-late"].gains[pearl.type],
    rainbow: true,
    maxEnergy: 108,
  });
  assert.ok(raised[0] > baseline[0]);
});

test("type 102 undoes the upstream rainbow bake and applies off-specialty", () => {
  const bakushinLike = {
    ...card,
    id: 555555,
    type: 3,
    fs_training: 0.2,
    special_uniques: [{ type: 102, value: 80, value_1: 20 }],
  };
  const rainbow = resolveUniqueModifiers(bakushinLike, 3, { rainbow: true, bond: 80 });
  const off = resolveUniqueModifiers(bakushinLike, 1, { rainbow: false, bond: 80 });
  assert.equal(rainbow.rainbowTrainingDelta, -0.2);
  assert.equal(rainbow.trainingDelta, 0);
  assert.equal(off.trainingDelta, 0.2);
});

test("a special unique stays disabled until that limit break can reach its unlock level", () => {
  const locked = {
    ...card,
    rarity: 3,
    limit_break: 0,
    special_unique_level: 35,
    tb: 1.1,
    special_uniques: [{ type: 8, value: 10 }],
  };
  const baseline = { ...locked, tb: 1, special_uniques: [] };
  const unlocked = { ...locked, limit_break: 1 };
  const calculate = (candidate) =>
    calculateMarginalTraining(candidate, 0, {
      gains: TRAINING_PROFILES["gl-late"].gains[0],
      motivation: 0,
      rainbow: false,
    });

  assert.equal(specialUniqueUnlocked(locked), false);
  assert.equal(specialUniqueUnlocked(unlocked), true);
  assert.deepEqual(calculate(locked), calculate(baseline));
  assert.ok(calculate(unlocked)[0] > calculate(locked)[0]);

  const lockedDynamic = {
    ...locked,
    tb: 1.15,
    special_uniques: [{ type: 109, value_1: 30 }],
  };
  const dynamicBaseline = { ...lockedDynamic, tb: 1, special_uniques: [] };
  assert.deepEqual(calculate(lockedDynamic), calculate(dynamicBaseline));
  assert.ok(
    calculate({ ...lockedDynamic, limit_break: 1 })[0] >
      calculate(lockedDynamic)[0],
  );
});

test("locked starting stats, starting bond, and type-101 flattening are removed", () => {
  const lockedBond = {
    ...card,
    rarity: 3,
    limit_break: 0,
    special_unique_level: 35,
    sb: 30,
    special_uniques: [{ type: 14, value: 15 }],
  };
  const lockedType101 = {
    ...card,
    rarity: 3,
    limit_break: 0,
    special_unique_level: 35,
    stat_bonus: [0, 0, 0, 0, 0, 0],
    fs_stats: [0, 0, 0, 0, 0, 1],
    special_uniques: [
      { type: 101, value: 80, value_1: 30, value_2: 1 },
    ],
  };
  const lockedInitialStats = {
    ...card,
    rarity: 3,
    limit_break: 0,
    special_unique_level: 35,
    starting_stats: [25, 0, 20, 0, 0],
    special_uniques: [
      { type: 9, value: 20 },
      { type: 11, value: 20 },
    ],
  };
  const baseline = {
    ...lockedType101,
    fs_stats: [0, 0, 0, 0, 0, 0],
    special_uniques: [],
  };

  assert.equal(effectiveStartingBond(lockedBond), 15);
  assert.equal(effectiveStartingBond({ ...lockedBond, limit_break: 1 }), 30);
  assert.deepEqual(effectiveStartingStats(lockedInitialStats), [5, 0, 0, 0, 0, 0]);
  assert.deepEqual(
    effectiveStartingStats({ ...lockedInitialStats, limit_break: 1 }),
    [25, 0, 20, 0, 0, 0],
  );
  assert.deepEqual(
    calculateMarginalTraining(lockedType101, 0, {
      gains: TRAINING_PROFILES["gl-late"].gains[0],
      rainbow: true,
      bond: 100,
    }),
    calculateMarginalTraining(baseline, 0, {
      gains: TRAINING_PROFILES["gl-late"].gains[0],
      rainbow: true,
      bond: 100,
    }),
  );
});

test("Grand Live facility pace reaches Lv5 around turn 32", () => {
  assert.equal(turnsPerFacilityLevel(100), 8);
  assert.equal(facilityLevelAtTurn(0, 100), 1);
  assert.equal(facilityLevelAtTurn(7.99, 100), 1);
  assert.equal(facilityLevelAtTurn(8, 100), 2);
  assert.equal(facilityLevelAtTurn(24, 100), 4);
  assert.equal(facilityLevelAtTurn(32, 100), 5);
  assert.ok(averageFacilityLevel(0, 56, 100) > 3);
});

test("Unity Cup facility pace is materially slower", () => {
  assert.equal(turnsPerFacilityLevel(50), 16);
  assert.equal(facilityLevelAtTurn(16, 50), 2);
  assert.equal(facilityLevelAtTurn(32, 50), 3);
  assert.equal(facilityLevelAtTurn(48, 50), 4);
  assert.equal(facilityLevelAtTurn(56, 50), 4);
});

test("career projection splits Grand Live into bond and rainbow phases", () => {
  const r = calculateCareerProjection(card, { globalSpecialty: 20 });
  assert.equal(r.daysToBond + r.rainbowDays, GRAND_LIVE_RUN.trainingTurns);
  assert.ok(r.rainbowDays > 0);
  assert.ok(r.rainbowClicks > 0);
  assert.ok(r.vector.some((v) => v > 0));
});

test("starting and event bond bring a card online earlier", () => {
  const low = calculateCareerProjection({
    ...card,
    sb: 0,
    event_stats: [0, 0, 0, 0, 0, 0, 0, 0],
  });
  const high = calculateCareerProjection({
    ...card,
    sb: 45,
    event_stats: [0, 0, 0, 0, 0, 0, 0, 20],
  });
  assert.ok(high.daysToBond < low.daysToBond);
  assert.ok(high.rainbowDays > low.rainbowDays);
});

test("career projection discounts off-specialty appearances by selection rate", () => {
  const r = calculateCareerProjection(card, {
    globalSpecialty: 20,
    motivation: 0.2,
    growth: [1, 1, 1, 1, 1, 1],
    spWeight: 1,
  });
  const appearance = calculateAppearance(card, 20, { bond: 100 });
  const offSelectionDenominator = card.offstat_appearance_denominator;
  assert.ok(
    Math.abs(
      r.offClicks -
        (appearance.eachOff * 4 * GRAND_LIVE_RUN.trainingTurns) /
          offSelectionDenominator,
    ) < 1e-9,
  );
  assert.ok(
    r.offClicks < appearance.eachOff * 4 * GRAND_LIVE_RUN.trainingTurns,
  );
  assert.ok(
    Math.abs(
      r.specialtyClicks - appearance.specialty * GRAND_LIVE_RUN.trainingTurns,
    ) < 1e-9,
  );
  assert.equal(r.finalBond, 100);
  assert.ok(r.rainbowClicks < r.specialtyClicks);
  assert.ok(r.vector.every((value) => value >= 0));
});

test("bond timing follows how often the card is actually picked", () => {
  const options = { globalSpecialty: 20 };
  const preferred = calculateCareerProjection(
    { ...card, sb: 0, event_stats: [0, 0, 0, 0, 0, 0, 0, 0], specialty_rate: 80 },
    options,
  );
  const ignored = calculateCareerProjection(
    { ...card, sb: 0, event_stats: [0, 0, 0, 0, 0, 0, 0, 0], specialty_rate: 0 },
    options,
  );
  assert.ok(preferred.daysToBond < ignored.daysToBond);
  assert.ok(preferred.rainbowClicks > ignored.rainbowClicks);
});

test("a card that never reaches the bond threshold never rainbows", () => {
  const stranded = calculateCareerProjection(
    { ...card, sb: 0, event_stats: [0, 0, 0, 0, 0, 0, 0, 0] },
    { globalSpecialty: 20, passiveBondPerTurn: 0, offstatOnly: true },
  );
  const unreachable = calculateCareerProjection(
    {
      ...card,
      sb: 0,
      specialty_rate: -100,
      unique_specialty: 0,
      event_stats: [0, 0, 0, 0, 0, 0, 0, 0],
      offstat_appearance_denominator: 10000,
    },
    { globalSpecialty: 0, passiveBondPerTurn: 0 },
  );
  assert.ok(stranded.rainbowClicks > 0);
  assert.equal(unreachable.rainbowClicks, 0);
  assert.equal(unreachable.rainbowDays, 0);
  assert.equal(unreachable.daysToBond, GRAND_LIVE_RUN.trainingTurns);
  assert.ok(unreachable.finalBond < 80);
});

test("base training values switch with facility pace, not with card bond", () => {
  assert.equal(baseGainsSwitchTurn(GRAND_LIVE_RUN, 100), 24);
  assert.equal(baseGainsSwitchTurn(GRAND_LIVE_RUN, 50), 48);
  const fast = calculateCareerProjection(card, { facilityPace: 100 });
  const slow = calculateCareerProjection(card, { facilityPace: 25 });
  assert.equal(fast.baseGainsSwitchTurn, 24);
  assert.equal(slow.baseGainsSwitchTurn, GRAND_LIVE_RUN.trainingTurns);
  assert.ok(fast.score > slow.score);
});

test("career projection reports where its bond timing came from", () => {
  const measured = calculateCareerProjection(card);
  const estimated = calculateCareerProjection({ ...card, event_stats: null });
  const none = calculateCareerProjection({
    ...card,
    rarity: 1,
    event_stats: null,
  });
  assert.equal(measured.eventSource, "upstream event data");
  assert.equal(measured.eventBond, 10);
  assert.equal(estimated.eventSource, "rarity fallback");
  assert.equal(estimated.eventBond, 5);
  assert.equal(none.eventSource, "no event estimate");
  assert.equal(none.eventBond, 0);
  assert.equal(measured.startingBond, 35);
});

test("stat weights change every ranking they feed", () => {
  const speedOnly = { statWeights: [1, 0, 0, 0, 0] };
  const full = calculateCardEV(card, {});
  const weighted = calculateCardEV(card, speedOnly);
  assert.ok(weighted.specialtyScore < full.specialtyScore);
  assert.ok(
    Math.abs(
      weighted.specialtyScore -
        (full.specialtyVector[0] + full.specialtyVector[5] * 1.2),
    ) < 1e-12,
  );
  const run = calculateCareerProjection(card, speedOnly);
  const unweighted = calculateCareerProjection(card, {});
  assert.ok(run.score < unweighted.score);
});

test("friend and group supports are scored on every room they appear on", () => {
  const tazuna = {
    ...card,
    id: 10021,
    type: 6,
    group: false,
    specialty_rate: 0,
    unique_specialty: 1,
    fs_specialty: 1,
    offstat_appearance_denominator: 5,
  };
  const ev = calculateCardEV(tazuna, {});
  assert.equal(ev.hasSpecialty, false);
  assert.equal(ev.specialtyScore, 0);
  assert.ok(ev.allPlacementScore > 0);
  assert.equal(typeLabel(tazuna), "Friend");
  assert.equal(typeLabel({ ...tazuna, group: true }), "Group");
  assert.equal(typeLabel(card), "Speed");

  const run = calculateCareerProjection(tazuna, {});
  assert.equal(run.hasSpecialty, false);
  assert.equal(run.rainbowClicks, 0);
  assert.ok(run.offClicks > 0);
  assert.ok(run.score > 0);
  assert.ok(
    uniqueModelWarnings(tazuna).some((warning) => warning.includes("friend")),
  );
});

test("career projection adds guaranteed initial stats to the run total", () => {
  const withoutInitial = calculateCareerProjection(
    { ...card, starting_stats: [0, 0, 0, 0, 0] },
    { includeEventStats: false },
  );
  const withInitial = calculateCareerProjection(
    { ...card, starting_stats: [30, 0, 15, 0, 0] },
    { includeEventStats: false },
  );

  assert.deepEqual(withInitial.initialVector, [30, 0, 15, 0, 0, 0]);
  assert.deepEqual(withInitial.trainingVector, withoutInitial.vector);
  assert.equal(withInitial.vector[0], withoutInitial.vector[0] + 30);
  assert.equal(withInitial.vector[2], withoutInitial.vector[2] + 15);
  assert.equal(withInitial.score, withoutInitial.score + 45);
  assert.equal(withInitial.initialScore, 45);
});

test("career projection treats missing initial stats as zero", () => {
  const result = calculateCareerProjection(card, { includeEventStats: false });

  assert.deepEqual(result.initialVector, [0, 0, 0, 0, 0, 0]);
  assert.deepEqual(result.vector, result.trainingVector);
  assert.equal(result.initialScore, 0);
  assert.equal(result.score, result.trainingScore);
});

test("career projection can exclude initial stats from totals", () => {
  const result = calculateCareerProjection(
    { ...card, starting_stats: [30, 0, 15, 0, 0] },
    { includeInitialStats: false, includeEventStats: false },
  );

  assert.deepEqual(result.initialVector, [30, 0, 15, 0, 0, 0]);
  assert.deepEqual(result.vector, result.trainingVector);
  assert.equal(result.score, result.trainingScore);
  assert.equal(result.initialScore, 45);
  assert.equal(result.includesInitialStats, false);
});

test("bond-100 uniques activate in late snapshots and after career bond progression", () => {
  const thresholdUnique = {
    ...card,
    tb: 1,
    fs_training: 0.2,
    special_uniques: [
      { type: 101, value: 100, value_1: 8, value_2: 20 },
    ],
  };
  const baseline = { ...thresholdUnique, fs_training: 0, special_uniques: [] };
  assert.equal(GLOBAL_UNIQUE_CONTEXT.bond, 100);
  assert.ok(
    calculateCardEV(thresholdUnique).allPlacementScore >
      calculateCardEV(baseline).allPlacementScore,
  );

  const career = calculateCareerProjection(thresholdUnique);
  const baselineCareer = calculateCareerProjection(baseline);
  assert.equal(career.finalBond, 100);
  assert.ok(career.score > baselineCareer.score);
});

test("fan and deck-bond uniques ramp during a career instead of starting maxed", () => {
  const noBonus = { ...card, tb: 1, special_uniques: [] };
  const alwaysTwenty = { ...noBonus, tb: 1.2 };
  const fanRamp = {
    ...noBonus,
    special_uniques: [{ type: 104, value: 10000, value_1: 20 }],
  };
  const noTrainingBonus = { ...card, tb: 1, special_uniques: [] };
  const alwaysFifteen = { ...noTrainingBonus, tb: 1.15 };
  const bondRamp = {
    ...noTrainingBonus,
    tb: 1.15,
    special_uniques: [{ type: 109, value_1: 30 }],
  };

  const baseFanScore = calculateCareerProjection(noBonus).score;
  const fanScore = calculateCareerProjection(fanRamp).score;
  assert.ok(fanScore > baseFanScore);
  assert.ok(fanScore < calculateCareerProjection(alwaysTwenty).score);

  const baseBondScore = calculateCareerProjection(noTrainingBonus).score;
  const bondScore = calculateCareerProjection(bondRamp).score;
  assert.ok(bondScore > baseBondScore);
  assert.ok(bondScore < calculateCareerProjection(alwaysFifteen).score);
});

test("faster facility progression raises a type-111 card's whole-run output", () => {
  const smaru = {
    ...card,
    id: 444444,
    tb: 1.15,
    unique_specialty: 1,
    specialty_rate: 35,
    special_uniques: [{ type: 111, value: 8, value_1: 5 }],
  };
  const slow = calculateCareerProjection(smaru, { profile: "gl-late", facilityPace: 50 });
  const fast = calculateCareerProjection(smaru, { profile: "gl-late", facilityPace: 100 });
  assert.ok(fast.score > slow.score);
  assert.ok(fast.afterFacilityLevel > slow.afterFacilityLevel);
});

test("Sirius type-106 career ramp uses raw unique metadata", () => {
  const sirius = {
    ...card,
    id: 333333,
    type: 4,
    unique_specialty: 1,
    special_uniques: [{ type: 106, value: 5, value_1: 1, value_2: 3 }],
  };
  const r = calculateCareerProjection(sirius, { profile: "gl-late" });
  assert.ok(r.averageFriendshipTrainings > 0);
  assert.ok(r.averageFriendshipTrainings <= 5);
});

test("Unity Cup career projection uses Unity Cup run values", () => {
  const r = calculateCareerProjection(card, {
    profile: "unity-late",
    globalSpecialty: 0,
    spWeight: 1,
    facilityPace: 50,
  });
  assert.equal(r.profileKey, "unity-late");
  assert.equal(r.runLabel, "Unity Cup");
  assert.equal(r.turnsPerFacilityLevel, 16);
  assert.equal(UNITY_CUP_RUN.scenarioMultiplier, 1);
  assert.deepEqual(UNITY_CUP_RUN.bondedGains[0], [12, 0, 5, 0, 0, 4]);
});

test("run bonded gains stay tied to the per-click training profiles", () => {
  assert.deepEqual(GRAND_LIVE_RUN.bondedGains, TRAINING_PROFILES["gl-late"].gains);
  assert.deepEqual(UNITY_CUP_RUN.bondedGains, TRAINING_PROFILES["unity-late"].gains);
});

test("summer profile projects with late-run gains under a label that says so", () => {
  const summer = calculateCareerProjection(card, { profile: "gl-summer" });
  const late = calculateCareerProjection(card, { profile: "gl-late" });

  assert.equal(summer.profileKey, "gl-summer");
  assert.equal(summer.runLabel, "Grand Live (late-run gains)");
  assert.notEqual(summer.runLabel, late.runLabel);
  assert.deepEqual(GRAND_LIVE_SUMMER_RUN.bondedGains, GRAND_LIVE_RUN.bondedGains);
  assert.equal(summer.score, late.score);
});
