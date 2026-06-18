const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8080";

function currentLang() {
  const lang = localStorage.getItem("ghosttalk_lang") || "uk";
  return lang === "uk" ? "uk-UA,uk;q=0.9,en;q=0.8" : "en-US,en;q=0.9";
}

async function request(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      "Accept-Language": currentLang(),
      ...(options.headers || {}),
    },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data;
}

export const apiBase = API_BASE;

export const createSession = (payload) =>
  request("/api/sessions", { method: "POST", body: JSON.stringify(payload) });

export const getSession = (code) => request(`/api/sessions/${code}`);

export const patchSession = (code, payload, facilitatorToken) =>
  request(`/api/sessions/${code}`, {
    method: "PATCH",
    headers: { "X-Facilitator-Token": facilitatorToken },
    body: JSON.stringify(payload),
  });

export const joinSession = (code) =>
  request(`/api/sessions/${code}/join`, { method: "POST", body: "{}" });

export const listCards = (code, includeHidden = false, facilitatorToken = "") =>
  request(`/api/sessions/${code}/cards${includeHidden ? "?include_hidden=1" : ""}`, {
    headers: facilitatorToken ? { "X-Facilitator-Token": facilitatorToken } : {},
  });

export const createCard = (code, payload, participantToken) =>
  request(`/api/sessions/${code}/cards`, {
    method: "POST",
    headers: { "X-Participant-Token": participantToken },
    body: JSON.stringify(payload),
  });

export const voteCard = (cardId, participantToken) =>
  request(`/api/cards/${cardId}/vote`, {
    method: "POST",
    headers: { "X-Participant-Token": participantToken },
    body: "{}",
  });

export const patchCard = (cardId, payload, facilitatorToken) =>
  request(`/api/cards/${cardId}`, {
    method: "PATCH",
    headers: { "X-Facilitator-Token": facilitatorToken },
    body: JSON.stringify(payload),
  });

export const getSummary = (code) => request(`/api/sessions/${code}/summary`);

export const saveSummary = (code, payload, facilitatorToken) =>
  request(`/api/sessions/${code}/summary`, {
    method: "POST",
    headers: { "X-Facilitator-Token": facilitatorToken },
    body: JSON.stringify(payload),
  });

export function getEventsUrl(code) {
  return `${API_BASE}/api/sessions/${code}/events`;
}
