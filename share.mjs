// Shareable state travels in the URL hash so a comparison can be linked to
// someone else instead of living only in this browser's localStorage.
const PREFIX = "s=";

function toBase64Url(text) {
  return btoa(text).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function fromBase64Url(text) {
  const padded = text.replaceAll("-", "+").replaceAll("_", "/");
  return atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
}

export function encodeShareState(state) {
  const payload = {
    c: (state?.selected || []).map(({ id, lb }) => [Number(id), Number(lb)]),
    s: state?.settings || {},
    f: state?.includeFuture ? 1 : 0,
  };
  return PREFIX + toBase64Url(JSON.stringify(payload));
}

export function decodeShareState(hash) {
  const raw = String(hash || "").replace(/^#/, "");
  if (!raw.startsWith(PREFIX)) return null;
  try {
    const payload = JSON.parse(fromBase64Url(raw.slice(PREFIX.length)));
    if (!payload || typeof payload !== "object") return null;
    const selected = Array.isArray(payload.c)
      ? payload.c
          .map((entry) => ({ id: Number(entry?.[0]), lb: Number(entry?.[1]) }))
          .filter((entry) => Number.isFinite(entry.id))
      : [];
    return {
      selected,
      settings:
        payload.s && typeof payload.s === "object" && !Array.isArray(payload.s)
          ? payload.s
          : {},
      includeFuture: Boolean(payload.f),
    };
  } catch {
    return null;
  }
}
