import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import CardBoard from "../components/CardBoard";
import { clearSessionAccess, createCard, getEventsUrl, getJoinCaptcha, getSession, joinSession, listCards, transcribeAudio, voteCard } from "../api/client";
import { useI18n } from "../i18n.jsx";

const LOCALHOST_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const RECORDING_MIME_TYPES = [
  { mimeType: "audio/webm;codecs=opus", extension: "webm" },
  { mimeType: "audio/webm", extension: "webm" },
  { mimeType: "audio/mp4", extension: "mp4" },
  { mimeType: "audio/mp4;codecs=mp4a.40.2", extension: "mp4" },
  { mimeType: "audio/ogg;codecs=opus", extension: "ogg" },
];

function getSpeechRecognitionCtor() {
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function appendTextValue(setText, value) {
  setText((prev) => `${prev}${prev ? " " : ""}${value}`);
}

export default function ParticipantPage() {
  const { code = "" } = useParams();
  const sessionCode = code.toUpperCase();
  const { t, methodLabel } = useI18n();
  const [session, setSession] = useState(null);
  const [categories, setCategories] = useState([]);
  const [cards, setCards] = useState([]);
  const [token, setToken] = useState("");
  const [text, setText] = useState("");
  const [category, setCategory] = useState("");
  const [error, setError] = useState("");
  const [joinSecret, setJoinSecret] = useState("");
  const [captchaQuestion, setCaptchaQuestion] = useState("");
  const [captchaAnswer, setCaptchaAnswer] = useState("");
  const [needsJoinSecret, setNeedsJoinSecret] = useState(false);
  const [voiceState, setVoiceState] = useState("idle"); // idle | recording | processing
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const speechRecognitionRef = useRef(null);
  const stoppingSpeechRef = useRef(false);

  function isVoiceRecordingSupported() {
    return Boolean(navigator.mediaDevices?.getUserMedia) && typeof MediaRecorder !== "undefined";
  }

  function isSpeechRecognitionSupported() {
    return Boolean(getSpeechRecognitionCtor());
  }

  function needsSecureContextForMicrophone() {
    return !window.isSecureContext && !LOCALHOST_HOSTS.has(window.location.hostname);
  }

  function pickRecordingFormat() {
    if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") {
      return { mimeType: "", extension: "webm" };
    }
    return (
      RECORDING_MIME_TYPES.find((candidate) => MediaRecorder.isTypeSupported(candidate.mimeType))
      || { mimeType: "", extension: "webm" }
    );
  }

  function getVoiceErrorMessage(err) {
    if (needsSecureContextForMicrophone()) return t.voiceMicSecureContext || t.voiceMicError;
    if (!isVoiceRecordingSupported()) return t.voiceMicUnsupported || t.voiceMicError;
    switch (err?.name) {
      case "NotAllowedError":
      case "PermissionDeniedError":
      case "SecurityError":
        return t.voiceMicPermissionDenied || t.voiceMicError;
      case "NotFoundError":
      case "DevicesNotFoundError":
        return t.voiceMicNotFound || t.voiceMicError;
      case "NotReadableError":
      case "TrackStartError":
      case "AbortError":
        return t.voiceMicBusy || t.voiceMicError;
      default:
        return err?.message || t.voiceMicError || "Мікрофон недоступний";
    }
  }

  function fallbackVoiceInput(message) {
    if (message) setError(message);
    const spoken = window.prompt(t.mockVoicePrompt);
    if (spoken) appendTextValue(setText, spoken.trim());
  }

  useEffect(() => () => {
    speechRecognitionRef.current?.stop?.();
    recorderRef.current?.stop?.();
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const sessionRes = await getSession(sessionCode);
        if (!alive) return;
        setSession(sessionRes.session);
        setCategories(sessionRes.categories);
        setCategory(sessionRes.categories[0] || "ideas");
        setNeedsJoinSecret(Boolean(sessionRes.session?.has_join_secret));
        if (!sessionRes.session?.has_join_secret) {
          const captchaRes = await getJoinCaptcha(sessionCode);
          if (!alive) return;
          setCaptchaQuestion(captchaRes.question || "");
          const joinRes = await joinSession(sessionCode, { captcha_answer: captchaAnswer });
          if (!alive) return;
          setToken(joinRes.participant_token || "");
        } else {
          const captchaRes = await getJoinCaptcha(sessionCode);
          if (!alive) return;
          setCaptchaQuestion(captchaRes.question || "");
        }

        const cardsRes = await listCards(sessionCode);
        if (!alive) return;
        setCards(cardsRes.cards);
      } catch (err) {
        setError(err.message);
      }
    })();

    return () => {
      alive = false;
    };
  }, [sessionCode]);

  useEffect(() => {
    if (!sessionCode) return;
    const es = new EventSource(getEventsUrl(sessionCode));
    es.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === "session_updated") {
        setSession(msg.payload);
      }
      if (msg.type === "card_created") {
        setCards((prev) => [msg.payload, ...prev.filter((c) => c.id !== msg.payload.id)]);
      }
      if (msg.type === "card_updated" || msg.type === "card_voted") {
        setCards((prev) => prev.map((c) => (c.id === msg.payload.id ? msg.payload : c)));
      }
    };
    return () => es.close();
  }, [sessionCode]);

  const canVote = useMemo(() => Boolean(session?.voting_open) && !session?.ended_at, [session]);

  async function submitCard(e) {
    e.preventDefault();
    setError("");
    try {
      await createCard(sessionCode, { text, category }, token);
      setText("");
    } catch (err) {
      setError(err.message);
    }
  }

  async function onVote(cardId) {
    try {
      await voteCard(cardId, token);
    } catch (err) {
      setError(err.message);
    }
  }

  async function resetAccess() {
    try {
      await clearSessionAccess("participant", sessionCode);
      const captchaRes = await getJoinCaptcha(sessionCode);
      setCaptchaQuestion(captchaRes.question || "");
      const joinRes = await joinSession(sessionCode, {
        ...(joinSecret ? { join_secret: joinSecret } : {}),
        captcha_answer: captchaAnswer,
      });
      setToken(joinRes.participant_token || "");
      setError("");
    } catch (err) {
      setError(err.message);
    }
  }

  async function submitJoinSecret(e) {
    e.preventDefault();
    try {
      const joinRes = await joinSession(sessionCode, { join_secret: joinSecret });
      setToken(joinRes.participant_token || "");
      setError("");
    } catch (err) {
      setError(err.message);
    }
  }

  async function submitProtectedJoin(e) {
    e.preventDefault();
    try {
      const joinRes = await joinSession(sessionCode, {
        ...(needsJoinSecret ? { join_secret: joinSecret } : {}),
        captcha_answer: captchaAnswer,
      });
      setToken(joinRes.participant_token || "");
      setError("");
    } catch (err) {
      setError(err.message);
    }
  }

  async function toggleVoice() {
    if (voiceState === "recording") {
      stoppingSpeechRef.current = true;
      speechRecognitionRef.current?.stop?.();
      recorderRef.current?.stop();
      return;
    }
    setError("");
    if (needsSecureContextForMicrophone()) {
      fallbackVoiceInput(t.voiceMicSecureContext || t.voiceMicError);
      return;
    }
    if (isSpeechRecognitionSupported()) {
      const SpeechRecognition = getSpeechRecognitionCtor();
      const recognition = new SpeechRecognition();
      speechRecognitionRef.current = recognition;
      recognition.lang = "uk-UA";
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;
      recognition.onresult = (event) => {
        const transcript = event.results?.[0]?.[0]?.transcript?.trim();
        if (transcript) appendTextValue(setText, transcript);
      };
      recognition.onerror = (event) => {
        setVoiceState("idle");
        if (stoppingSpeechRef.current || event?.error === "aborted") return;
        fallbackVoiceInput(t.voiceTranscriptionUnavailable);
      };
      recognition.onend = () => {
        stoppingSpeechRef.current = false;
        speechRecognitionRef.current = null;
        setVoiceState("idle");
      };
      try {
        recognition.start();
        setVoiceState("recording");
        return;
      } catch (err) {
        speechRecognitionRef.current = null;
      }
    }
    if (!isVoiceRecordingSupported()) {
      fallbackVoiceInput(t.voiceMicUnsupported || t.voiceMicError);
      return;
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      fallbackVoiceInput(getVoiceErrorMessage(err));
      return;
    }
    chunksRef.current = [];
    const { mimeType, extension } = pickRecordingFormat();
    let recorder;
    try {
      recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    } catch (err) {
      stream.getTracks().forEach((track) => track.stop());
      fallbackVoiceInput(getVoiceErrorMessage(err));
      return;
    }
    recorderRef.current = recorder;
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
    recorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      setVoiceState("processing");
      try {
        const blobType = recorder.mimeType || mimeType || "audio/webm";
        const blob = new Blob(chunksRef.current, { type: blobType });
        const transcribed = await transcribeAudio(blob, "uk", `recording.${extension}`);
        if (transcribed) appendTextValue(setText, transcribed);
      } catch (err) {
        console.error("Voice transcription failed", err);
        fallbackVoiceInput(t.voiceTranscriptionUnavailable);
      } finally {
        setVoiceState("idle");
      }
    };
    try {
      recorder.start();
      setVoiceState("recording");
    } catch (err) {
      stream.getTracks().forEach((track) => track.stop());
      setVoiceState("idle");
      fallbackVoiceInput(getVoiceErrorMessage(err));
    }
  }

  if (error && !session) return <section className="panel error">{error}</section>;
  if (!session) return <section className="panel">{t.loadingSession}</section>;
  if (!token) {
    return (
      <section className="stack-lg">
        <div className="session-header">
          <h2>{session.title}</h2>
          <p>{session.description}</p>
          <small>{t.joinCode}: {session.code}</small>
        </div>
        <form className="panel stack-form" onSubmit={submitProtectedJoin}>
          {needsJoinSecret ? (
            <label>
              {t.joinSecretLabel}
              <input value={joinSecret} onChange={(e) => setJoinSecret(e.target.value)} maxLength={64} required />
            </label>
          ) : null}
          <label>
            {t.captchaLabel}
            <div className="row">
              <input value={captchaQuestion} readOnly />
              <input value={captchaAnswer} onChange={(e) => setCaptchaAnswer(e.target.value)} required />
            </div>
          </label>
          {error ? <p className="error">{error}</p> : null}
          <div className="row">
            <button className="btn btn-primary" type="submit">{t.joinSession}</button>
          </div>
        </form>
      </section>
    );
  }

  return (
    <section className="stack-lg">
      <div className="session-header">
        <h2>{session.title}</h2>
        <p>{session.description}</p>
        <small>{t.joinCode}: {session.code} · {t.methodLabel}: {methodLabel(session.methodology)}</small>
        <div className="row">
          <button type="button" className="btn" onClick={resetAccess}>{t.resetAccess}</button>
        </div>
      </div>

      <div className={`video-call-card${session.video_enabled ? "" : " is-disabled"}`}>
        <div>
          <strong>{session.video_enabled ? t.videoSession : t.videoUnavailableTitle}</strong>
          <p>{session.video_enabled ? t.videoNoAccount : t.videoUnavailableHint}</p>
        </div>
        <div className="row">
          {session.video_enabled ? (
            <Link className="btn btn-primary" to={`/video/participant/${session.code}`}>{t.openVideo}</Link>
          ) : (
            <button type="button" className="btn btn-primary" disabled>{t.openVideo}</button>
          )}
        </div>
      </div>

      <form className="stack-form" onSubmit={submitCard}>
        <h3>{t.addThought}</h3>
        <textarea required rows={3} maxLength={1000} value={text} onChange={(e) => setText(e.target.value)} />
        <div className="row">
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            {categories.map((c) => (
              <option key={c} value={c}>{methodLabel(c)}</option>
            ))}
          </select>
          <button type="button" className="btn" onClick={toggleVoice} disabled={voiceState === "processing"}>
            {voiceState === "recording" ? t.voiceRecording : voiceState === "processing" ? t.voiceProcessing : t.voiceRecord}
          </button>
          <button className="btn btn-primary" type="submit">{t.submit}</button>
        </div>
      </form>

      {error && <p className="error">{error}</p>}

      <CardBoard categories={categories} cards={cards} onVote={onVote} canVote={canVote} />
    </section>
  );
}
