const API_BASE = import.meta.env.VITE_API_BASE || "";

function currentLang() {
  const lang = localStorage.getItem("ghosttalk_lang") || "uk";
  return lang === "uk" ? "uk-UA,uk;q=0.9,en;q=0.8" : "en-US,en;q=0.9";
}

async function request(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: "same-origin",
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

export const joinSession = (code, payload = {}) =>
  request(`/api/sessions/${code}/join`, { method: "POST", body: JSON.stringify(payload) });

export const getJoinCaptcha = (code) =>
  request(`/api/sessions/${code}/captcha`, { method: "POST", body: "{}" });

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

export const getSummary = (code, facilitatorToken) =>
  request(`/api/sessions/${code}/summary`, {
    headers: facilitatorToken ? { "X-Facilitator-Token": facilitatorToken } : {},
  });

export const saveSummary = (code, payload, facilitatorToken) =>
  request(`/api/sessions/${code}/summary`, {
    method: "POST",
    headers: { "X-Facilitator-Token": facilitatorToken },
    body: JSON.stringify(payload),
  });

export const createVideoToken = (code, payload, headers = {}) =>
  request(`/api/sessions/${code}/video-token`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

export const clearSessionAccess = (role, code) =>
  request(`/api/session-access/${role}/${code}`, { method: "DELETE", body: "{}" });

export const listVoiceTemplates = () => request("/api/v1/voice-templates");

export const updateAnonymousAudio = (roomId, payload, participantToken) =>
  request(`/api/v1/rooms/${roomId}/participants/me/anonymous-audio`, {
    method: "PUT",
    headers: { "X-Participant-Token": participantToken },
    body: JSON.stringify(payload),
  });

export const getAnonymousAudioStatus = (roomId, participantToken) =>
  request(`/api/v1/rooms/${roomId}/participants/me/anonymous-audio/status`, {
    headers: { "X-Participant-Token": participantToken },
  });

export const getAuditEvents = (code, params = {}) => {
  const search = new URLSearchParams();
  if (params.limit) search.set("limit", String(params.limit));
  if (params.beforeId) search.set("before_id", String(params.beforeId));
  const suffix = search.size ? `?${search.toString()}` : "";
  return request(`/api/sessions/${code}/audit${suffix}`);
};

export function getEventsUrl(code) {
  return `${API_BASE}/api/sessions/${code}/events`;
}

export async function transcribeAudio(blob, language = "uk", filename = "recording.webm") {
  const form = new FormData();
  form.append("audio", blob, filename);
  form.append("language", language);
  const res = await fetch(`${API_BASE}/api/transcribe`, { method: "POST", body: form, credentials: "same-origin" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.warn("[anonymity] transcribe http error", {
      status: res.status,
      error: data.error || "",
      filename,
      language,
      mimeType: blob?.type || "",
      size: blob?.size || 0,
    });
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  console.debug("[anonymity] transcribe ok", {
    filename,
    language,
    mimeType: blob?.type || "",
    size: blob?.size || 0,
    textLength: String(data.text || "").length,
  });
  return data.text;
}

export async function synthesizeSpeech(text, voice) {
  const res = await fetch(`${API_BASE}/api/synthesize`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, voice }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    console.warn("[anonymity] synthesize http error", {
      status: res.status,
      error: data.error || "",
      voice,
      textLength: String(text || "").length,
    });
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  console.debug("[anonymity] synthesize ok", {
    voice,
    textLength: String(text || "").length,
  });
  return res.arrayBuffer();
}
