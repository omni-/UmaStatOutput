import {
  DEFAULT_PASSIVE_BOND_PER_TURN,
  GLOBAL_UNIQUE_CONTEXT,
  TRAINING_PROFILES,
  clampFacilityLevel,
} from "./app.mjs";

export const SETTINGS_EVENT = "uma-settings-changed";

export const RANK_METRICS = {
  specialty: "Specialty EV",
  allPlacement: "All-placement EV",
};

export const SETTING_IDS = [
  "global-spec",
  "training-profile",
  "motivation",
  "sp-weight",
  "facility-level",
  "facility-pace",
  "include-initial-stats",
  "supports-on-training",
  "deck-types",
  "fans",
  "max-energy",
  "current-energy",
  "passive-bond",
  "rank-metric",
];

export const INDEXED_SETTING_IDS = [
  ...[0, 1, 2, 3, 4].map((index) => `growth-${index}`),
  ...[0, 1, 2, 3, 4].map((index) => `stat-weight-${index}`),
];

export const ALL_SETTING_IDS = [...SETTING_IDS, ...INDEXED_SETTING_IDS];

/** Raw control values, used for persistence and for share links. */
export function collectSettingValues(root) {
  const result = {};
  for (const id of ALL_SETTING_IDS) {
    const element = root?.querySelector?.(`#${id}`);
    if (!element) continue;
    result[id] =
      element.type === "checkbox" ? Boolean(element.checked) : String(element.value);
  }
  return result;
}

/**
 * Writes stored or shared values back into the controls. A value a control
 * cannot represent — an option from another build, a hand-edited link — is
 * dropped rather than left blanking the control while the model quietly uses
 * its default.
 */
export function applySettingValues(root, values) {
  if (!values || typeof values !== "object") return;
  for (const id of ALL_SETTING_IDS) {
    if (!(id in values)) continue;
    const element = root?.querySelector?.(`#${id}`);
    if (!element) continue;
    if (element.type === "checkbox") {
      element.checked = Boolean(values[id]);
      continue;
    }
    const previous = element.value;
    element.value = String(values[id]);
    if (element.value !== String(values[id])) element.value = previous;
  }
}

/**
 * What Reset restores. Everything the environment panel exposes belongs here,
 * so a new control cannot quietly become un-resettable.
 */
export const DEFAULT_SETTING_VALUES = {
  "training-profile": "gl-late",
  motivation: "0.2",
  "rank-metric": "specialty",
  "supports-on-training": "1",
  "deck-types": String(GLOBAL_UNIQUE_CONTEXT.deckTypes),
  fans: String(GLOBAL_UNIQUE_CONTEXT.fans),
  "max-energy": String(GLOBAL_UNIQUE_CONTEXT.maxEnergy),
  "current-energy": String(GLOBAL_UNIQUE_CONTEXT.currentEnergy),
  "passive-bond": String(DEFAULT_PASSIVE_BOND_PER_TURN),
  "include-initial-stats": true,
  ...Object.fromEntries([0, 1, 2, 3, 4].map((index) => [`growth-${index}`, "0"])),
  ...Object.fromEntries(
    [0, 1, 2, 3, 4].map((index) => [`stat-weight-${index}`, "1"]),
  ),
};

function value(root, id, fallback) {
  const element = root?.querySelector?.(`#${id}`);
  if (!element) return fallback;
  const raw = element.value;
  const parsed = Number(raw);
  return raw === "" || raw === undefined || !Number.isFinite(parsed)
    ? fallback
    : parsed;
}

function text(root, id, fallback) {
  const element = root?.querySelector?.(`#${id}`);
  return element && element.value ? String(element.value) : fallback;
}

function checked(root, id, fallback) {
  const element = root?.querySelector?.(`#${id}`);
  return element ? element.checked !== false : fallback;
}

function indexedValues(root, prefix, count, transform) {
  return new Array(count)
    .fill(0)
    .map((_, index) => transform(value(root, `${prefix}-${index}`, null), index));
}

/**
 * One settings object shared by the per-click table, the run projection, and
 * the deck model, so no view can silently disagree with another about the
 * environment it is scoring.
 */
export function readSharedSettings(root) {
  const profileKey = text(root, "training-profile", "gl-late");
  const profile = TRAINING_PROFILES[profileKey] || TRAINING_PROFILES["gl-late"];
  const growth = indexedValues(root, "growth", 5, (raw) =>
    1 + (raw === null ? 0 : raw) / 100,
  );
  growth.push(1);
  const statWeights = indexedValues(root, "stat-weight", 5, (raw) =>
    raw === null ? 1 : raw,
  );
  return {
    profile: TRAINING_PROFILES[profileKey] ? profileKey : "gl-late",
    globalSpecialty: value(root, "global-spec", profile.globalSpecialty),
    motivation: value(root, "motivation", 0.2),
    spWeight: value(root, "sp-weight", profile.spWeight ?? 1.2),
    facilityLevel: clampFacilityLevel(
      value(root, "facility-level", profile.facilityLevel ?? 5),
    ),
    facilityPace: value(root, "facility-pace", profile.facilityPace ?? 100),
    includeInitialStats: checked(root, "include-initial-stats", true),
    supportsOnTraining: Math.max(
      1,
      Math.min(
        5,
        value(root, "supports-on-training", GLOBAL_UNIQUE_CONTEXT.supportsOnTraining),
      ),
    ),
    deckTypes: Math.max(1, Math.min(6, value(root, "deck-types", GLOBAL_UNIQUE_CONTEXT.deckTypes))),
    fans: Math.max(0, value(root, "fans", GLOBAL_UNIQUE_CONTEXT.fans)),
    maxEnergy: Math.max(1, value(root, "max-energy", GLOBAL_UNIQUE_CONTEXT.maxEnergy)),
    currentEnergy: Math.max(
      0,
      value(root, "current-energy", GLOBAL_UNIQUE_CONTEXT.currentEnergy),
    ),
    passiveBondPerTurn: Math.max(
      0,
      value(root, "passive-bond", DEFAULT_PASSIVE_BOND_PER_TURN),
    ),
    rankMetric:
      text(root, "rank-metric", "specialty") in RANK_METRICS
        ? text(root, "rank-metric", "specialty")
        : "specialty",
    growth,
    statWeights,
  };
}

export function emitSettingsChanged(root) {
  root?.dispatchEvent?.(new CustomEvent(SETTINGS_EVENT));
}
