import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateAppearance,
  calculateCardEV,
  calculateMarginalTraining,
} from "../app.mjs";
import { GRAND_LIVE_RUN, calculateCareerProjection } from "../career.mjs";
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
test("global specialty priority raises preferred appearance and lowers each off-type appearance", () => {
  const a = calculateAppearance(card, 0),
    b = calculateAppearance(card, 20);
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
    [10.90888, 0, 4.1287, 0, 0, 1.65148],
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
    [5.69305, 0, 2.0858, 0, 0, 1.0429],
  );
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
test("bond timing and whole-run output are numerically pinned", () => {
  const r = calculateCareerProjection(card, {
    globalSpecialty: 20,
    motivation: 0.2,
    growth: [1, 1, 1, 1, 1, 1],
    spWeight: 1,
  });
  assert.equal(r.daysToBond, 20.25);
  assert.equal(r.rainbowDays, 35.75);
  assert.ok(Math.abs(r.rainbowClicks - 286 / 23) < 1e-12);
  assert.deepEqual(
    r.vector.map((value) => Number(value.toFixed(9))),
    [
      241.7651615, 13.371602808, 98.880157011, 15.780475091, 8.374373641,
      45.617886609,
    ],
  );
  assert.ok(Math.abs(r.score - 423.78965665942025) < 1e-12);
});
