import {
  STAT_NAMES,
  calculateAppearance,
  calculateMarginalTraining,
  weightedSum,
} from "./app.mjs";

export const GRAND_LIVE_RUN = {
  trainingTurns: 56,
  bondPerTurn: 20,
  deckBondTarget: 75 * 6,
  scenarioMultiplier: 1.4,
  unbondedGains: [
    [8,0,4,0,0,2],
    [0,8,0,6,0,2],
    [0,4,9,0,0,2],
    [2,0,2,7,0,2],
    [2,0,0,0,6,3],
  ],
  bondedGains: [
    [11,0,5,0,0,2],
    [0,9,0,6,0,2],
    [0,4,10,0,0,2],
    [3,0,2,10,0,2],
    [3,0,0,0,9,3],
  ],
};

function eventInfo(card) {
  if (Array.isArray(card.event_stats) && card.event_stats.length >= 8) {
    return {bond: Number(card.event_stats[7] || 0), source: "upstream event data"};
  }
  if (Number(card.rarity) >= 2) return {bond: 5, source: "rarity fallback"};
  return {bond: 0, source: "no event estimate"};
}

function adjustedForRamp(card, rainbowClicks) {
  const adjusted = {
    ...card,
    stat_bonus: [...(card.stat_bonus || [0,0,0,0,0,0])],
    fs_stats: [...(card.fs_stats || [0,0,0,0,0,0])],
  };
  const step = Number(card.fs_ramp?.[0] || 0);
  const cap = Number(card.fs_ramp?.[1] || 0);
  if (step <= 0 || cap <= 0 || rainbowClicks <= 0) return adjusted;

  let current = 0;
  let total = 0;
  for (let remaining = rainbowClicks * 0.66; remaining > 0; remaining--) {
    total += current;
    current = Math.min(current + step, cap);
  }
  adjusted.unique_fs_bonus = 1 + total / rainbowClicks / 100;
  return adjusted;
}

function addScaled(target, values, scale) {
  for (let i = 0; i < 6; i++) target[i] += Number(values[i] || 0) * scale;
}

export function calculateCareerProjection(card, options = {}) {
  const globalSpecialty = Number(options.globalSpecialty ?? 20);
  const motivation = Number(options.motivation ?? 0.2);
  const growth = options.growth || [1,1,1,1,1,1];
  const spWeight = Number(options.spWeight ?? 1);
  const appearance = calculateAppearance(card, globalSpecialty);
  const event = eventInfo(card);

  // Mirrors Euophrys' deck-neutral bond baseline when no fixed deck is supplied:
  // five unknown supports contribute 75 bond of work each, plus the candidate.
  const bondNeeded = Math.max(
    0,
    GRAND_LIVE_RUN.deckBondTarget - Number(card.sb || 0) - event.bond,
  );
  const daysToBond = Math.min(
    GRAND_LIVE_RUN.trainingTurns,
    bondNeeded / GRAND_LIVE_RUN.bondPerTurn,
  );
  const rainbowDays = Math.max(0, GRAND_LIVE_RUN.trainingTurns - daysToBond);
  const offDenominator = Math.max(1, Number(card.offstat_appearance_denominator || 4));

  const beforeClicks = new Array(5).fill(0);
  const afterClicks = new Array(5).fill(0);
  for (let training = 0; training < 5; training++) {
    if (training === card.type) {
      beforeClicks[training] = appearance.specialty * daysToBond;
      afterClicks[training] = appearance.specialty * rainbowDays;
    } else {
      const chosenRate = appearance.eachOff / offDenominator;
      beforeClicks[training] = chosenRate * daysToBond;
      afterClicks[training] = chosenRate * rainbowDays;
    }
  }

  const rainbowClicks = afterClicks[card.type];
  const adjusted = adjustedForRamp(card, rainbowClicks);
  const vector = new Array(6).fill(0);

  for (let training = 0; training < 5; training++) {
    const before = calculateMarginalTraining(adjusted, training, {
      gains: GRAND_LIVE_RUN.unbondedGains[training],
      motivation,
      growth,
      rainbow: false,
    });
    addScaled(
      vector,
      before,
      beforeClicks[training] * GRAND_LIVE_RUN.scenarioMultiplier,
    );

    const after = calculateMarginalTraining(adjusted, training, {
      gains: GRAND_LIVE_RUN.bondedGains[training],
      motivation,
      growth,
      rainbow: training === card.type,
    });
    addScaled(
      vector,
      after,
      afterClicks[training] * GRAND_LIVE_RUN.scenarioMultiplier,
    );
  }

  return {
    vector,
    score: weightedSum(vector, spWeight),
    daysToBond,
    rainbowDays,
    rainbowClicks,
    appearance,
    eventSource: event.source,
  };
}

function initCareerView() {
  const body = document.querySelector("#career-body");
  const wrap = document.querySelector("#career-results");
  const selectedRoot = document.querySelector("#selected-cards");
  if (!body || !wrap || !selectedRoot) return;

  let payload = null;

  function readSettings() {
    const growth = [0,1,2,3,4].map(i =>
      1 + Number(document.querySelector(`#growth-${i}`)?.value || 0) / 100
    );
    growth.push(1);
    return {
      globalSpecialty: Number(document.querySelector("#global-spec")?.value || 0),
      motivation: Number(document.querySelector("#motivation")?.value ?? 0.2),
      spWeight: Number(document.querySelector("#sp-weight")?.value ?? 1),
      growth,
    };
  }

  function selectedCards() {
    if (!payload) return [];
    const byIdLb = new Map(payload.cards.map(card => [`${card.id}:${card.limit_break}`, card]));
    const cards = [];
    selectedRoot.querySelectorAll("select[data-lb-id]").forEach(select => {
      const id = Number(select.dataset.lbId);
      const lb = Number(select.value);
      const card = byIdLb.get(`${id}:${lb}`);
      if (card) cards.push(card);
    });
    return cards;
  }

  function render() {
    const cards = selectedCards();
    if (!cards.length) {
      wrap.hidden = true;
      body.innerHTML = "";
      return;
    }

    const options = readSettings();
    const rows = cards.map(card => ({
      card,
      career: calculateCareerProjection(card, options),
    })).sort((a,b) => b.career.score - a.career.score);

    body.innerHTML = rows.map((row, index) => {
      const {card, career} = row;
      const rarity = ({1:"R",2:"SR",3:"SSR"})[card.rarity] || `R${card.rarity}`;
      const stats = career.vector
        .map(value => `<td><strong>${Number(value).toFixed(1)}</strong></td>`)
        .join("");
      return `<tr>
        <td class="rank">${index + 1}</td>
        <td>
          <div class="career-card-name">${rarity} ${card.char_name}</div>
          <div class="career-card-meta">LB${card.limit_break} · bond phase ≈ ${career.daysToBond.toFixed(1)} turns · rainbows ≈ ${career.rainbowClicks.toFixed(1)}</div>
        </td>
        ${stats}
        <td class="${index === 0 ? "best" : ""}">
          <div class="metric-main">${career.score.toFixed(1)}</div>
          <div class="metric-sub">SP × ${options.spWeight.toFixed(1)}</div>
        </td>
      </tr>`;
    }).join("");
    wrap.hidden = false;
  }

  fetch("./data/cards.json", {cache: "no-cache"})
    .then(response => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    })
    .then(data => {
      payload = data;
      render();
      new MutationObserver(render).observe(selectedRoot, {
        childList: true,
        subtree: true,
        attributes: true,
      });
      selectedRoot.addEventListener("change", render);
      [
        "#global-spec",
        "#global-spec-range",
        "#motivation",
        "#sp-weight",
        "#growth-grid",
      ].forEach(selector => {
        const el = document.querySelector(selector);
        if (el) el.addEventListener("input", () => queueMicrotask(render));
      });
      document.querySelectorAll("[data-spec-preset]").forEach(button =>
        button.addEventListener("click", () => queueMicrotask(render))
      );
      document.querySelector("#reset-settings")?.addEventListener("click", () =>
        queueMicrotask(render)
      );
    })
    .catch(error => {
      console.error("Career projection data failed to load", error);
      wrap.hidden = false;
      body.innerHTML = `<tr><td colspan="9" class="career-error">Career projection data failed to load.</td></tr>`;
    });
}

if (typeof document !== "undefined") initCareerView();
