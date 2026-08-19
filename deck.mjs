import {
  GLOBAL_UNIQUE_CONTEXT,
  RAINBOW_BOND_THRESHOLD,
  TRAINING_PROFILES,
  calculateAppearance,
  effectiveStartingBond,
  effectiveStartingStats,
  facilityLevelAtTurn,
  hasTrainingSpecialty,
  normalizeStatWeights,
  roomProbability,
  trainingValue,
  turnsPerFacilityLevel,
  weightedSum,
} from "./app.mjs";
import { DEFAULT_PASSIVE_BOND_PER_TURN } from "./app.mjs";
import { RUN_PROFILES, baseGainsSwitchTurn } from "./career.mjs";

export const MAX_DECK_SIZE = 6;
const TRAINING_COUNT = 5;
const BOND_PER_SELECTED_TRAINING = 5;

// The deck model re-enumerates placements whenever the deck's structure
// changes (a card bonds, facilities level, base gains switch) and at least this
// often, so slow-moving context like fan count cannot drift far inside a slice.
const MAX_SEGMENT_TURNS = 8;

function eventBond(card) {
  if (Array.isArray(card.event_stats) && card.event_stats.length >= 8)
    return Number(card.event_stats[7] || 0);
  return Number(card.rarity) >= 2 ? 5 : 0;
}

function deckTypeCount(cards) {
  return new Set(cards.map((card) => Number(card.type))).size;
}

/**
 * Every way the deck can be spread across the five training rooms, folded into
 * the expected output of the room the player would actually pick.
 *
 * Room values are memoized per (room, membership mask), so the enumeration only
 * multiplies out probabilities and takes a maximum.
 */
function enumerateTurn(cards, states, options) {
  const count = cards.length;
  const masks = 1 << count;
  const scenarioMultiplier = Number(options.scenarioMultiplier ?? 1);
  const spWeight = Number(options.spWeight ?? 1.2);
  const statWeights = normalizeStatWeights(options.statWeights);
  const roomVectors = [];
  const roomScores = [];

  for (let room = 0; room < TRAINING_COUNT; room++) {
    const vectors = new Array(masks);
    const scores = new Array(masks);
    for (let mask = 0; mask < masks; mask++) {
      const entries = [];
      let rainbowInRoom = false;
      for (let index = 0; index < count; index++) {
        if (!(mask & (1 << index))) continue;
        const rainbow =
          states[index].rainbowCapable && Number(cards[index].type) === room;
        if (rainbow) rainbowInRoom = true;
        entries.push({
          card: cards[index],
          rainbow,
          bond: states[index].bond,
          friendshipTrainings: states[index].friendshipTrainings,
        });
      }
      const vector = trainingValue(entries, {
        ...options,
        trainingType: room,
        gains: options.gains[room],
      });
      const scale = rainbowInRoom ? scenarioMultiplier : 1;
      const scaled = vector.map((value) => value * scale);
      vectors[mask] = scaled;
      scores[mask] = weightedSum(scaled, spWeight, statWeights);
    }
    roomVectors.push(vectors);
    roomScores.push(scores);
  }

  const expectedVector = new Array(6).fill(0);
  const selection = new Array(count).fill(0);
  const specialtySelection = new Array(count).fill(0);
  const roomMasks = new Array(TRAINING_COUNT).fill(0);
  let expectedScore = 0;

  const walk = (index, probability) => {
    if (probability <= 0) return;
    if (index === count) {
      let bestRoom = 0;
      let bestScore = -Infinity;
      for (let room = 0; room < TRAINING_COUNT; room++) {
        const score = roomScores[room][roomMasks[room]];
        if (score > bestScore) {
          bestScore = score;
          bestRoom = room;
        }
      }
      const vector = roomVectors[bestRoom][roomMasks[bestRoom]];
      for (let stat = 0; stat < 6; stat++)
        expectedVector[stat] += vector[stat] * probability;
      expectedScore += bestScore * probability;
      const chosenMask = roomMasks[bestRoom];
      for (let card = 0; card < count; card++) {
        if (!(chosenMask & (1 << card))) continue;
        selection[card] += probability;
        if (states[card].rainbowCapable && Number(cards[card].type) === bestRoom)
          specialtySelection[card] += probability;
      }
      return;
    }
    const bit = 1 << index;
    for (let room = 0; room < TRAINING_COUNT; room++) {
      const chance = states[index].roomChance[room];
      if (chance <= 0) continue;
      roomMasks[room] |= bit;
      walk(index + 1, probability * chance);
      roomMasks[room] &= ~bit;
    }
    walk(index + 1, probability * states[index].noneChance);
  };

  walk(0, 1);
  return { expectedVector, expectedScore, selection, specialtySelection };
}

/**
 * Whole-run projection for a deck of up to six supports: what the deck produces
 * per turn once the player picks the best available room, and how much each
 * card is actually worth inside that deck.
 */
export function calculateDeckProjection(cards, options = {}) {
  const deck = cards.slice(0, MAX_DECK_SIZE);
  const profileKey =
    options.profile && RUN_PROFILES[options.profile] ? options.profile : "gl-late";
  const run = RUN_PROFILES[profileKey];
  const profile = TRAINING_PROFILES[profileKey] || TRAINING_PROFILES["gl-late"];
  const globalSpecialty = Number(
    options.globalSpecialty ?? profile.globalSpecialty,
  );
  const spWeight = Number(options.spWeight ?? profile.spWeight ?? 1.2);
  const statWeights = normalizeStatWeights(options.statWeights);
  const facilityPace = Number(options.facilityPace ?? profile.facilityPace ?? 100);
  const includeInitialStats = options.includeInitialStats !== false;
  const passiveBondPerTurn = Math.max(
    0,
    Number(options.passiveBondPerTurn ?? DEFAULT_PASSIVE_BOND_PER_TURN),
  );
  const switchTurn = baseGainsSwitchTurn(run, facilityPace);
  const deckTypes = deck.length ? deckTypeCount(deck) : Number(options.deckTypes ?? 5);

  const bonds = deck.map((card) =>
    Math.min(100, effectiveStartingBond(card) + eventBond(card)),
  );
  const bondedAt = deck.map((card, index) =>
    bonds[index] >= RAINBOW_BOND_THRESHOLD && hasTrainingSpecialty(card) ? 0 : null,
  );
  const trainingVector = new Array(6).fill(0);
  const selectionTurns = new Array(deck.length).fill(0);
  const rainbowTurns = new Array(deck.length).fill(0);
  let turn = 0;

  // An empty deck still runs: it is the trainee training alone, which is the
  // baseline the supports' contribution is measured against.
  while (turn < run.trainingTurns) {
    const facilityLevel = facilityLevelAtTurn(turn, facilityPace);
    const turnsPerLevel = turnsPerFacilityLevel(facilityPace);
    const nextFacilityTurn =
      facilityLevel >= 5 ? Infinity : facilityLevel * turnsPerLevel;
    const nextGainsTurn = turn < switchTurn ? switchTurn : Infinity;
    const runProgress = Math.max(0, Math.min(1, turn / run.trainingTurns));
    const context = {
      ...options,
      deckTypes,
      fans: Number(options.fans ?? GLOBAL_UNIQUE_CONTEXT.fans) * runProgress,
      // Deck-bond uniques see the deck this projection actually knows about,
      // with the unselected slots held at a plain bonded value.
      totalBond:
        bonds.reduce((total, bond) => total + bond, 0) +
        75 * Math.max(0, MAX_DECK_SIZE - deck.length),
      facilityLevel,
      scenarioMultiplier: run.scenarioMultiplier,
      spWeight,
      statWeights,
      gains: turn >= switchTurn ? run.bondedGains : run.unbondedGains,
    };

    const states = deck.map((card, index) => {
      const appearance = calculateAppearance(card, globalSpecialty, {
        ...context,
        bond: bonds[index],
        friendshipTrainings: rainbowTurns[index],
      });
      const bond = bonds[index];
      const friendshipTrainings = rainbowTurns[index];
      const roomChance = new Array(TRAINING_COUNT)
        .fill(0)
        .map((_, room) => roomProbability(card, appearance, room));
      return {
        appearance,
        bond,
        friendshipTrainings,
        roomChance,
        noneChance: Math.max(
          0,
          1 - roomChance.reduce((total, chance) => total + chance, 0),
        ),
        rainbowCapable:
          hasTrainingSpecialty(card) && bond >= RAINBOW_BOND_THRESHOLD,
      };
    });

    const turnResult = enumerateTurn(deck, states, context);

    const bondRates = deck.map(
      (card, index) =>
        BOND_PER_SELECTED_TRAINING * turnResult.selection[index] +
        passiveBondPerTurn,
    );
    let duration = Math.min(
      run.trainingTurns - turn,
      MAX_SEGMENT_TURNS,
      nextFacilityTurn - turn,
      nextGainsTurn - turn,
    );
    for (let index = 0; index < deck.length; index++) {
      if (bonds[index] >= RAINBOW_BOND_THRESHOLD || bondRates[index] <= 0) continue;
      const turnsToBond =
        (RAINBOW_BOND_THRESHOLD - bonds[index]) / bondRates[index];
      if (turnsToBond > 0) duration = Math.min(duration, turnsToBond);
    }
    if (!(duration > 0)) break;

    for (let stat = 0; stat < 6; stat++)
      trainingVector[stat] += turnResult.expectedVector[stat] * duration;
    for (let index = 0; index < deck.length; index++) {
      selectionTurns[index] += turnResult.selection[index] * duration;
      rainbowTurns[index] += turnResult.specialtySelection[index] * duration;
      bonds[index] = Math.min(100, bonds[index] + bondRates[index] * duration);
    }
    turn += duration;
    for (let index = 0; index < deck.length; index++)
      if (
        bondedAt[index] === null &&
        bonds[index] >= RAINBOW_BOND_THRESHOLD &&
        hasTrainingSpecialty(deck[index])
      )
        bondedAt[index] = turn;
  }

  const initialVector = deck.reduce((total, card) => {
    const initial = effectiveStartingStats(card);
    return total.map((value, stat) => value + initial[stat]);
  }, new Array(6).fill(0));
  const vector = trainingVector.map(
    (value, stat) => value + (includeInitialStats ? initialVector[stat] : 0),
  );
  const score = weightedSum(vector, spWeight, statWeights);

  const members = deck.map((card, index) => ({
    card,
    selectionTurns: selectionTurns[index],
    rainbowTurns: rainbowTurns[index],
    finalBond: bonds[index],
    daysToBond: bondedAt[index] === null ? run.trainingTurns : bondedAt[index],
  }));

  const baseline =
    deck.length > 0
      ? calculateDeckProjection([], {
          ...options,
          deckTypes,
          withMarginals: false,
        })
      : null;

  if (options.withMarginals !== false && deck.length > 1) {
    for (let index = 0; index < deck.length; index++) {
      const without = calculateDeckProjection(
        deck.filter((_, other) => other !== index),
        { ...options, withMarginals: false },
      );
      members[index].marginalScore = score - without.score;
      members[index].marginalVector = vector.map(
        (value, stat) => value - without.vector[stat],
      );
    }
  }

  return {
    vector,
    trainingVector,
    initialVector,
    score,
    trainingScore: weightedSum(trainingVector, spWeight, statWeights),
    initialScore: weightedSum(initialVector, spWeight, statWeights),
    includesInitialStats: includeInitialStats,
    baselineScore: baseline ? baseline.score : 0,
    supportScore: baseline ? score - baseline.score : 0,
    members,
    deckTypes,
    trainingTurns: run.trainingTurns,
    runLabel: run.label,
    profileKey,
  };
}
