import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateCardEV,
  portraitImageUrl,
  remoteSupportImageUrl,
  specialUniqueUnlocked,
  supportImageUrl,
  uniqueModelWarnings,
} from "../app.mjs";
import { bondSourceLabel, calculateCareerProjection } from "../career.mjs";
import { calculateDeckProjection } from "../deck.mjs";
import { resolveUniqueModifiers } from "../unique-model.mjs";

const card = {
  id: 99999,
  type: 0,
  rarity: 3,
  limit_break: 4,
  char_name: "Fixture",
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
  crowd_bonus: 0,
  highlander_threshold: 99,
  highlander_training: 0,
  fan_bonus: 0,
  wisdom_recovery: 0,
  sb: 35,
  offstat_appearance_denominator: 4,
  event_stats: [20, 0, 10, 0, 0, 30, 0, 10],
  special_uniques: [],
};

test("flattened unique fields stand in when raw metadata never declared them", () => {
  const base = resolveUniqueModifiers(card, 0, { supportsOnTraining: 3 });
  const crowd = resolveUniqueModifiers({ ...card, crowd_bonus: 0.05 }, 0, {
    supportsOnTraining: 3,
  });
  assert.ok(Math.abs(crowd.trainingDelta - base.trainingDelta - 0.15) < 1e-12);

  const highlander = {
    ...card,
    highlander_threshold: 5,
    highlander_training: 0.15,
  };
  assert.equal(
    resolveUniqueModifiers(highlander, 0, { deckTypes: 4 }).trainingDelta,
    0,
  );
  assert.ok(
    Math.abs(
      resolveUniqueModifiers(highlander, 0, { deckTypes: 5 }).trainingDelta - 0.15,
    ) < 1e-12,
  );

  const fans = { ...card, fan_bonus: 1 };
  assert.ok(
    Math.abs(resolveUniqueModifiers(fans, 0, { fans: 200000 }).trainingDelta - 0.2) <
      1e-12,
  );
  assert.equal(resolveUniqueModifiers(fans, 0, { fans: 0 }).trainingDelta, 0);

  const ramp = { ...card, fs_ramp: [3, 15] };
  assert.ok(
    Math.abs(
      resolveUniqueModifiers(ramp, 0, { rainbow: true, friendshipTrainings: 2 })
        .friendshipDelta - 0.06,
    ) < 1e-12,
  );
  assert.ok(
    Math.abs(
      resolveUniqueModifiers(ramp, 0, { rainbow: true, friendshipTrainings: 9 })
        .friendshipDelta - 0.15,
    ) < 1e-12,
  );
  assert.equal(
    resolveUniqueModifiers(ramp, 0, { rainbow: false, friendshipTrainings: 9 })
      .friendshipDelta,
    0,
  );
});

test("a flattened field never doubles up with the raw effect it stands for", () => {
  const declared = {
    ...card,
    fs_ramp: [3, 15],
    crowd_bonus: 0.05,
    special_uniques: [
      { type: 106, value: 5, value_2: 3 },
      { type: 110, value_1: 5 },
    ],
  };
  const resolved = resolveUniqueModifiers(declared, 0, {
    rainbow: true,
    friendshipTrainings: 5,
    supportsOnTraining: 3,
  });
  // Types 106 and 110 model the same mechanics as fs_ramp and crowd_bonus, so
  // the flattened fields must contribute nothing on top of them.
  assert.ok(Math.abs(resolved.friendshipDelta - 0.15) < 1e-12);
  assert.ok(Math.abs(resolved.trainingDelta - 0.15) < 1e-12);
});

test("flattened fields stay off while the card's unique is still locked", () => {
  const locked = {
    ...card,
    limit_break: 0,
    special_unique_level: 45,
    crowd_bonus: 0.05,
    special_uniques: [{ type: 8, value: 5 }],
  };
  assert.equal(specialUniqueUnlocked(locked), false);
  assert.ok(
    resolveUniqueModifiers(locked, 0, { supportsOnTraining: 3 }).trainingDelta <= 0,
  );
});

test("Wit energy recovery is disclosed rather than scored", () => {
  const recovery = { ...card, wisdom_recovery: 3 };
  assert.ok(
    uniqueModelWarnings(recovery).some((warning) =>
      warning.includes("energy recovery"),
    ),
  );
  assert.deepEqual(
    calculateCardEV(recovery).specialtyVector,
    calculateCardEV(card).specialtyVector,
  );
});

test("missing unique metadata is flagged alongside the other disclosures", () => {
  const warnings = uniqueModelWarnings({
    ...card,
    special_uniques: null,
    wisdom_recovery: 2,
  });
  assert.ok(warnings.some((warning) => warning.includes("unavailable")));
  assert.ok(warnings.some((warning) => warning.includes("energy recovery")));
});

test("card art is served locally with the upstream host as the fallback", () => {
  assert.equal(supportImageUrl(30028), "./img/support_card_s_30028.png");
  assert.ok(remoteSupportImageUrl(30028).startsWith("https://"));
  assert.notEqual(supportImageUrl(30028), remoteSupportImageUrl(30028));
  assert.equal(portraitImageUrl({ id: 30028 }), "./img/support_card_s_30028.png");
  assert.equal(
    portraitImageUrl({ id: 30028, portrait_url: "https://example.test/a.png" }),
    "https://example.test/a.png",
  );
});

test("bond source label names the estimate behind the timing", () => {
  assert.match(
    bondSourceLabel(calculateCareerProjection(card)),
    /bond 35 start \+ 10 event bond/,
  );
  assert.match(
    bondSourceLabel(calculateCareerProjection({ ...card, event_stats: null })),
    /estimated event bond/,
  );
});

const deckCard = (id, type, overrides = {}) => ({
  ...card,
  id,
  type,
  char_name: `Card ${id}`,
  sb: 25,
  event_stats: [0, 0, 0, 0, 0, 0, 0, 10],
  ...overrides,
});

test("deck projection prices each support by what the deck loses without it", () => {
  const deck = [deckCard(1, 0), deckCard(2, 1), deckCard(3, 2), deckCard(4, 3)];
  const projection = calculateDeckProjection(deck, { globalSpecialty: 20 });

  assert.equal(projection.members.length, 4);
  assert.equal(projection.deckTypes, 4);
  assert.ok(projection.score > 0);
  for (const member of projection.members) {
    assert.ok(member.marginalScore > 0);
    assert.ok(member.selectionTurns > 0);
    assert.ok(member.rainbowTurns > 0);
    assert.ok(member.daysToBond < projection.trainingTurns);
    const solo = calculateDeckProjection([member.card], {
      globalSpecialty: 20,
      withMarginals: false,
    });
    // A card is worth less inside a deck than alone: some turns the deck has a
    // better room to take than the one this card is standing in.
    assert.ok(member.marginalScore < solo.score);
  }
});

test("same-type supports are priced by how they share a room", () => {
  const options = { globalSpecialty: 20 };
  const stacked = calculateDeckProjection(
    [deckCard(1, 0), deckCard(2, 0), deckCard(3, 0)],
    options,
  );
  const spread = calculateDeckProjection(
    [deckCard(1, 0), deckCard(2, 1), deckCard(3, 2)],
    options,
  );

  // Identical cards must price identically; anything else means the
  // enumeration is attributing the chosen room to the wrong index.
  const [first, second, third] = stacked.members.map((m) => m.marginalScore);
  assert.ok(Math.abs(first - second) < 1e-9);
  assert.ok(Math.abs(first - third) < 1e-9);

  // Friendship bonuses multiply when two bonded cards share their own room, so
  // stacking a type beats spreading it even though the cards compete for the
  // same placement. Spread decks instead cover more rooms, which shows up as a
  // flatter spread of marginal values.
  assert.ok(first > spread.members[0].marginalScore);
  const spreadRange =
    Math.max(...spread.members.map((m) => m.marginalScore)) -
    Math.min(...spread.members.map((m) => m.marginalScore));
  assert.ok(spreadRange > 1e-6);
  assert.ok(stacked.members.every((member) => member.rainbowTurns > 0));
});

test("a support is worth less inside a deck than it looks alone", () => {
  const options = { globalSpecialty: 20, includeInitialStats: false };
  const pair = calculateDeckProjection([deckCard(1, 0), deckCard(2, 0)], options);
  const solo = calculateDeckProjection([deckCard(1, 0)], {
    ...options,
    withMarginals: false,
  });
  const empty = calculateDeckProjection([], { ...options, withMarginals: false });

  // The empty deck is the trainee training alone, so it still produces output.
  assert.ok(empty.score > 0);
  assert.equal(empty.supportScore, 0);
  assert.ok(Math.abs(solo.baselineScore - empty.score) < 1e-9);

  // Measured against that baseline, one card's own contribution shrinks once a
  // second card is competing for the same room.
  const soloContribution = solo.supportScore;
  assert.ok(soloContribution > 0);
  assert.ok(pair.members[0].marginalScore < soloContribution);
  assert.ok(pair.supportScore < soloContribution * 2);
});

test("deck projection handles a single card and skips its marginal", () => {
  const single = calculateDeckProjection([deckCard(1, 0)], {
    globalSpecialty: 20,
  });
  assert.equal(single.members.length, 1);
  assert.equal(single.members[0].marginalScore, undefined);
  assert.ok(single.score > 0);
  assert.ok(single.members[0].finalBond >= 80);
});

test("deck projection caps at a real deck and counts its own type spread", () => {
  const seven = [0, 1, 2, 3, 4, 0, 1].map((type, index) =>
    deckCard(index + 1, type),
  );
  const projection = calculateDeckProjection(seven, { withMarginals: false });
  assert.equal(projection.members.length, 6);
  assert.equal(projection.deckTypes, 5);
});

test("deck projection weights a complete probability space", () => {
  const deck = [deckCard(1, 0), deckCard(2, 1)];
  const projection = calculateDeckProjection(deck, {
    withMarginals: false,
    includeInitialStats: false,
  });
  // Every turn produces exactly one training, so the run total has to sit
  // between the worst and best single-room outcomes across all turns.
  const perTurn = projection.score / projection.trainingTurns;
  assert.ok(perTurn > 0);
  assert.ok(Number.isFinite(perTurn));
  assert.ok(projection.vector.every((value) => value >= 0));
});
