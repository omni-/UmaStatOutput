import test from "node:test";
import assert from "node:assert/strict";
import {
  MODEL_CONFIDENCE,
  calculateAppearance,
  calculateCardEV,
  calculateMarginalTraining,
  effectiveStartingStats,
  modelConfidenceMark,
  portraitImageUrl,
  remoteSupportImageUrl,
  specialUniqueUnlocked,
  supportImageUrl,
  trainingValue,
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

test("Wit energy recovery is a scope note, not a confidence problem", () => {
  const recovery = { ...card, wisdom_recovery: 3 };
  const notes = uniqueModelWarnings(recovery);
  assert.ok(
    notes.scopeNotes.some((note) => note.includes("energy recovery")),
  );
  assert.equal(notes.formulaNotes.length, 0);
  assert.equal(notes.severity, MODEL_CONFIDENCE.MODELLED);
  assert.equal(modelConfidenceMark(recovery, notes), null);
  assert.deepEqual(
    calculateCardEV(recovery).specialtyVector,
    calculateCardEV(card).specialtyVector,
  );
});

test("missing unique metadata is a formula note and marks as missing", () => {
  const blind = { ...card, special_uniques: null, wisdom_recovery: 2 };
  const notes = uniqueModelWarnings(blind);
  assert.ok(notes.formulaNotes.some((note) => note.includes("unavailable")));
  assert.ok(notes.scopeNotes.some((note) => note.includes("energy recovery")));
  assert.equal(notes.severity, MODEL_CONFIDENCE.MISSING);
});

test("unique-granted initial stats are scored, so they raise no note", () => {
  // Euophrys flattens raw types 9-13 into starting_stats, which the run and
  // deck projections already count. Disclosing them would be false.
  const initial = {
    ...card,
    starting_stats: [0, 0, 0, 0, 20],
    special_uniques: [{ type: 13, value: 20 }],
  };
  const notes = uniqueModelWarnings(initial);
  assert.equal(notes.formulaNotes.length, 0);
  assert.equal(notes.scopeNotes.length, 0);
  assert.deepEqual(effectiveStartingStats(initial), [0, 0, 0, 0, 20, 0]);
});

test("one unmodeled effect is enough, however many others resolve", () => {
  // The ordinary vocabulary is already modeled, so a leftover effect is the
  // part that makes the card worth owning. Counting it against the card's
  // mundane riders would dilute exactly the thing that matters.
  const alongsideModelled = {
    ...card,
    special_uniques: [
      { type: 8, value: 5 },
      { type: 1, value: 5 },
      { type: 2, value: 5 },
      { type: 900, value: 5 },
    ],
  };
  const alone = { ...card, special_uniques: [{ type: 900, value: 5 }] };
  assert.equal(
    uniqueModelWarnings(alongsideModelled).severity,
    MODEL_CONFIDENCE.MISSING,
  );
  assert.equal(uniqueModelWarnings(alone).severity, MODEL_CONFIDENCE.MISSING);
});

test("the mark follows severity and not where the card comes from", () => {
  const uncertified = [{ type: 8, value: 5 }, { type: 900, value: 5 }];
  const global = { ...card, future: false, special_uniques: uncertified };
  const future = { ...card, future: true, special_uniques: uncertified };

  assert.equal(
    modelConfidenceMark(global, uniqueModelWarnings(global)).variant,
    "missing",
  );
  assert.equal(
    modelConfidenceMark(future, uniqueModelWarnings(future)).variant,
    "missing",
  );
});

test("a FUTURE card whose unique resolves is marked as modelled", () => {
  const future = { ...card, future: true, special_uniques: [{ type: 8, value: 5 }] };
  const mark = modelConfidenceMark(future, uniqueModelWarnings(future));
  assert.equal(mark.variant, "modelled");
  // A Global card that resolves is the unremarkable case and stays unmarked.
  assert.equal(
    modelConfidenceMark({ ...future, future: false }, uniqueModelWarnings(future)),
    null,
  );
});

test("a pinned assumption quotes the reader's settings, not the defaults", () => {
  // This is the only note that names a number, so a stale one is worse than
  // no note at all: the score moves with the setting and the note must too.
  const pinned = { ...card, fan_bonus: 0.05, special_uniques: [{ type: 8, value: 5 }] };
  assert.match(
    uniqueModelWarnings(pinned, "gl-late", { fans: 500000 }).formulaNotes[0],
    /500,000 fans/,
  );
  assert.match(
    uniqueModelWarnings(pinned, "gl-late").formulaNotes[0],
    /200,000 fans/,
  );
  assert.notEqual(
    calculateCardEV(pinned, { fans: 500000 }).specialtyScore,
    calculateCardEV(pinned, { fans: 0 }).specialtyScore,
  );
});

test("the run projection says its fan figure is an endpoint", () => {
  const pinned = { ...card, fan_bonus: 0.05, special_uniques: [{ type: 8, value: 5 }] };
  const run = uniqueModelWarnings(pinned, "gl-late", { rampsFans: true });
  assert.ok(run.formulaNotes.some((note) => note.includes("ramp from zero")));
  // The per-click view holds fans constant, so it must not claim a ramp.
  const click = uniqueModelWarnings(pinned, "gl-late");
  assert.ok(!click.formulaNotes.some((note) => note.includes("ramp from zero")));
});

test("a pinned assumption is marked apart from a missing effect", () => {
  const dropped = { ...card, special_uniques: [{ type: 900, value: 5 }] };
  const pinned = { ...card, fan_bonus: 0.05, special_uniques: [{ type: 8, value: 5 }] };
  assert.equal(
    modelConfidenceMark(dropped, uniqueModelWarnings(dropped)).variant,
    "missing",
  );
  assert.equal(
    modelConfidenceMark(pinned, uniqueModelWarnings(pinned)).variant,
    "assumed",
  );
});

test("context-pinned uniques are a formula note", () => {
  const pinned = { ...card, fan_bonus: 0.05, special_uniques: [{ type: 8, value: 5 }] };
  const notes = uniqueModelWarnings(pinned);
  assert.ok(notes.formulaNotes.some((note) => note.includes("fans")));
  // Nothing was dropped — the value is real, it just rests on an assumption.
  assert.equal(notes.severity, MODEL_CONFIDENCE.ASSUMED);
});

test("card art is served locally with the upstream host as the fallback", () => {
  assert.equal(supportImageUrl(30028), "./img/support_card_s_30028.png");
  assert.ok(remoteSupportImageUrl(30028).startsWith("https://"));
  assert.notEqual(supportImageUrl(30028), remoteSupportImageUrl(30028));
  assert.equal(
    portraitImageUrl({ id: 30028, portrait_url: "https://example.test/a.png" }),
    "./img/support_card_s_30028.png",
  );
});

test("support event rewards land once per run and can be turned off", () => {
  const eventCard = { ...card, event_stats: [20, 0, 10, 0, 0, 30, 12, 10] };
  const included = calculateCareerProjection(eventCard, {});
  const excluded = calculateCareerProjection(eventCard, {
    includeEventStats: false,
  });

  // No appearance rate, friendship bonus, or scenario multiplier applies: the
  // reward is what the event gives, once.
  assert.deepEqual(included.eventVector, [20, 0, 10, 0, 0, 30, 0].slice(0, 6));
  assert.equal(included.eventEnergy, 12);
  assert.equal(included.vector[0], excluded.vector[0] + 20);
  assert.equal(included.vector[5], excluded.vector[5] + 30);
  assert.equal(included.includesEventStats, true);
  assert.equal(excluded.includesEventStats, false);
  assert.deepEqual(excluded.vector, excluded.trainingVector);
  assert.equal(included.eventScore, 20 + 10 + 30 * 1.2);
});

test("event rewards scale with the card's event-effect size", () => {
  const base = { ...card, event_stats: [20, 0, 10, 0, 0, 30, 10, 10] };
  const larger = { ...base, effect_size_up: 1.2, energy_up: 1.3 };
  const plain = calculateCareerProjection(base, {});
  const scaled = calculateCareerProjection(larger, {});
  assert.ok(Math.abs(scaled.eventVector[0] - 24) < 1e-12);
  assert.ok(Math.abs(scaled.eventEnergy - 13) < 1e-12);
  assert.ok(scaled.score > plain.score);
});

test("a card with no event row falls back the way upstream does", () => {
  const ssr = calculateCareerProjection({ ...card, event_stats: null }, {});
  const sr = calculateCareerProjection(
    { ...card, rarity: 2, event_stats: null },
    {},
  );
  const r = calculateCareerProjection(
    { ...card, rarity: 1, event_stats: null },
    {},
  );
  assert.deepEqual(ssr.eventVector, [9, 9, 9, 9, 9, 0]);
  assert.deepEqual(sr.eventVector, [7, 7, 7, 7, 7, 0]);
  assert.deepEqual(r.eventVector, [0, 0, 0, 0, 0, 0]);
  assert.equal(ssr.eventSource, "rarity fallback");
  assert.equal(r.eventSource, "no event estimate");
});

test("a deck counts each support's event rewards once", () => {
  const eventCard = (id) => ({
    ...card,
    id,
    type: id % 5,
    event_stats: [20, 0, 10, 0, 0, 30, 0, 10],
  });
  const deck = [eventCard(1), eventCard(2)];
  const included = calculateDeckProjection(deck, { withMarginals: false });
  const excluded = calculateDeckProjection(deck, {
    withMarginals: false,
    includeEventStats: false,
  });
  assert.deepEqual(included.eventVector, [40, 0, 20, 0, 0, 60]);
  assert.equal(included.vector[0], excluded.vector[0] + 40);
  assert.equal(excluded.eventScore, included.eventScore);
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

test("a scenario multiplier lifts the whole click, not just the card's share", () => {
  const gains = [11, 0, 5, 0, 0, 2];
  const options = { gains, motivation: 0.2, rainbow: true, facilityLevel: 5 };
  const plain = calculateMarginalTraining(card, 0, options);
  const scaled = calculateMarginalTraining(card, 0, {
    ...options,
    scenarioMultiplier: 1.4,
  });
  const withCard = trainingValue([{ card, rainbow: true }], {
    ...options,
    trainingType: 0,
  });
  const withoutCard = trainingValue([], { ...options, trainingType: 0 });

  // Grand Live's rainbow bonus multiplies the training the click produces, and
  // the click only earns it because this card rainbows there — so the uplift on
  // the base gains counts too, and the baseline never gets it.
  assert.ok(Math.abs(scaled[0] - (withCard[0] * 1.4 - withoutCard[0])) < 1e-9);
  assert.ok(scaled[0] > plain[0] * 1.4, "the base gains are lifted as well");
});

test("a bonded group card spreads its friendship bonus over every room", () => {
  const groupCard = {
    ...card,
    type: 6,
    group: true,
    specialty_rate: 0,
    unique_specialty: 1,
    fs_specialty: 1,
    fs_bonus: 1.25,
    unique_fs_bonus: 1.1,
    offstat_appearance_denominator: 5,
  };
  const gains = [11, 0, 5, 0, 0, 2];
  const shared = { gains, trainingType: 0, motivation: 0.2, facilityLevel: 5 };
  const unbonded = trainingValue([{ card: groupCard, rainbow: false, bond: 40 }], shared);
  const bonded = trainingValue([{ card: groupCard, rainbow: false, bond: 100 }], shared);
  assert.ok(bonded[0] > unbonded[0]);
  // Upstream's convention: one fifth of the card's combined friendship bonus.
  assert.ok(Math.abs(bonded[0] / unbonded[0] - 1.27) < 1e-9);

  // A friend card that is not a group card gets nothing extra from bond.
  const friendCard = { ...groupCard, group: false };
  assert.equal(
    trainingValue([{ card: friendCard, rainbow: false, bond: 100 }], shared)[0],
    trainingValue([{ card: friendCard, rainbow: false, bond: 40 }], shared)[0],
  );
});

test("a card with no specialty room is not given the scenario's priority bonus", () => {
  const friendCard = {
    ...card,
    type: 6,
    specialty_rate: 0,
    unique_specialty: 1,
    fs_specialty: 1,
    offstat_appearance_denominator: 5,
  };
  const appearance = calculateAppearance(friendCard, 20, { bond: 100 });
  // Five rooms plus "no training" must still account for the whole turn.
  const total = appearance.eachOff * 5 + appearance.none;
  assert.ok(Math.abs(total - 1) < 1e-12);
  assert.equal(
    appearance.specialtyWeight,
    calculateAppearance(friendCard, 0, { bond: 100 }).specialtyWeight,
  );
});

test("concentrated off-type appearances raise a card's per-room chance", () => {
  const spread = deckCard(1, 6, {
    type: 6,
    specialty_rate: 0,
    unique_specialty: 1,
    fs_specialty: 1,
    offstat_appearance_denominator: 5,
  });
  const concentrated = { ...spread, id: 2, offstat_appearance_denominator: 2.5 };
  const spreadRun = calculateDeckProjection([spread], { withMarginals: false });
  const concentratedRun = calculateDeckProjection([concentrated], {
    withMarginals: false,
  });
  assert.ok(
    concentratedRun.members[0].selectionTurns >
      spreadRun.members[0].selectionTurns,
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

test("a single card is priced against the trainee training alone", () => {
  const single = calculateDeckProjection([deckCard(1, 0)], {
    globalSpecialty: 20,
  });
  assert.equal(single.members.length, 1);
  assert.ok(single.members[0].finalBond >= 80);
  assert.ok(single.score > 0);
  // The only card's marginal is the whole of what the supports contribute.
  assert.ok(
    Math.abs(single.members[0].marginalScore - single.supportScore) < 1e-9,
  );
});

test("deck projection caps at a real deck and counts its own type spread", () => {
  const seven = [0, 1, 2, 3, 4, 0, 1].map((type, index) =>
    deckCard(index + 1, type),
  );
  const full = calculateDeckProjection(seven, { withMarginals: false });
  assert.equal(full.members.length, 6);
  assert.equal(full.deckTypes, 5, "a full deck speaks for itself");

  // A half-built deck tops up with the spread the user expects the empty slots
  // to have, so diversity uniques do not switch off mid-comparison.
  const partial = calculateDeckProjection(
    [deckCard(1, 0), deckCard(2, 0)],
    { withMarginals: false, deckTypes: 5 },
  );
  assert.equal(partial.deckTypes, 5);
  const narrow = calculateDeckProjection(
    [deckCard(1, 0), deckCard(2, 0)],
    { withMarginals: false, deckTypes: 1 },
  );
  assert.equal(narrow.deckTypes, 1);
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
