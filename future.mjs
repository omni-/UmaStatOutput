const FUTURE_STORAGE_KEY = "uma-stat-output:future-cards";

function readPreference() {
  try {
    return localStorage.getItem(FUTURE_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function writePreference(enabled) {
  try {
    localStorage.setItem(FUTURE_STORAGE_KEY, enabled ? "1" : "0");
  } catch {}
}

function futureChip() {
  const chip = document.createElement("span");
  chip.className = "future-chip";
  chip.textContent = "FUTURE";
  chip.title = "Available in JP but not yet released on Global";
  return chip;
}

function initFutureCards() {
  const toggle = document.querySelector("#include-future"),
    search = document.querySelector("#card-search"),
    searchResults = document.querySelector("#search-results"),
    selectedRoot = document.querySelector("#selected-cards"),
    resultsBody = document.querySelector("#results-body"),
    sourcePill = document.querySelector("#source-pill");
  if (!toggle || !searchResults) return;

  toggle.checked = readPreference();
  let futureIds = new Set(),
    payload = null;

  function addChip(container) {
    if (!container || container.querySelector(":scope > .future-chip")) return;
    container.append(futureChip());
  }

  function decorate() {
    if (!payload) return;

    searchResults.querySelectorAll("[data-add-id]").forEach((row) => {
      const id = Number(row.dataset.addId),
        isFuture = futureIds.has(id);
      row.hidden = isFuture && !toggle.checked;
      if (isFuture) addChip(row.querySelector(".name-row"));
    });

    selectedRoot?.querySelectorAll(".selected-card").forEach((cardEl) => {
      const id = Number(cardEl.querySelector("[data-lb-id]")?.dataset.lbId || 0);
      if (futureIds.has(id)) addChip(cardEl.querySelector(".name-row"));
    });

    resultsBody?.querySelectorAll("tr[data-detail-id]").forEach((row) => {
      const id = Number(row.dataset.detailId || 0);
      if (futureIds.has(id)) addChip(row.querySelector(".name-row"));
    });
  }

  const observer = new MutationObserver(() => queueMicrotask(decorate));
  [searchResults, selectedRoot, resultsBody].filter(Boolean).forEach((root) =>
    observer.observe(root, { childList: true, subtree: true }),
  );

  toggle.addEventListener("change", () => {
    writePreference(toggle.checked);
    if (search.value.trim()) search.dispatchEvent(new Event("input", { bubbles: true }));
    queueMicrotask(decorate);
  });

  fetch("./data/cards.json", { cache: "no-cache" })
    .then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    })
    .then((data) => {
      payload = data;
      futureIds = new Set(
        data.cards.filter((card) => card.is_future).map((card) => Number(card.id)),
      );
      if (sourcePill && Number.isFinite(Number(data.global_card_count))) {
        const date = data.generated_at
            ? new Date(data.generated_at).toLocaleDateString()
            : "current build",
          futureCount = Number(data.future_card_count || 0);
        sourcePill.textContent = `${data.global_card_count} Global${futureCount ? ` + ${futureCount} future` : ""} supports · synced ${date}`;
      }
      decorate();
    })
    .catch((error) => console.error("Future-card metadata failed to load", error));
}

if (typeof document !== "undefined") initFutureCards();
