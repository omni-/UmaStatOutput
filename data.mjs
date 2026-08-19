// Every view needs the same generated dataset, so the fetch is shared: the
// first caller starts it and the rest await the same promise.
let pending = null;

export function loadCards(fetchImpl) {
  if (pending) return pending;
  const request = fetchImpl || globalThis.fetch;
  pending = Promise.resolve()
    .then(() => request("./data/cards.json", { cache: "no-cache" }))
    .then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    })
    .catch((error) => {
      pending = null;
      throw error;
    });
  return pending;
}

export function resetCardCache() {
  pending = null;
}
