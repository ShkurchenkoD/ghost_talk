import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  Chat,
  ChatToggle,
  ConnectionStateToast,
  DisconnectButton,
  GridLayout,
  LayoutContextProvider,
  LiveKitRoom,
  ParticipantTile,
  RoomAudioRenderer,
  StartMediaButton,
  TrackToggle,
  useConnectionState,
  useCreateLayoutContext,
  useRoomContext,
  useTracks,
} from "@livekit/components-react";
import {
  ConnectionState,
  LocalAudioTrack,
  LocalVideoTrack,
  Room,
  RoomEvent,
  Track,
} from "livekit-client";
import {
  createVideoToken,
  createTranscriptPartial,
  createTranscriptSegment,
  getTranscriptConsent,
  getAnonymousAudioStatus,
  getEventsUrl,
  getJoinCaptcha,
  getSession,
  joinSession,
  listVoiceTemplates,
  setTranscriptConsent,
  updateAnonymousAudio,
} from "../api/client";
import { videoDisplayNameKey } from "../api/sessionState";
import { useI18n } from "../i18n.jsx";
import {
  AVATAR_OPTIONS,
  AnonymousVideoProcessor,
  MaskedAudioProcessor,
  SpeechSynthesisAudioProcessor,
  buildAnonymousProfile,
  getDefaultAnonymitySettings,
  sanitizeAnonymitySettings,
} from "../lib/anonymityMode";

const PUBLIC_MICROPHONE_TRACK = "microphone-public";
const ANONYMOUS_MICROPHONE_TRACK = "microphone-anonymous";
const WORKER_IDENTITY_PREFIX = "anon-worker:";

function isWorkerParticipant(participant) {
  return Boolean(participant?.identity && participant.identity.startsWith(WORKER_IDENTITY_PREFIX));
}

function anonymousModeKey(code, role) {
  return `ghosttalk_video_anonymous_${String(code).toUpperCase()}_${role}`;
}

function readAnonymitySettings(code, role) {
  try {
    const raw = localStorage.getItem(anonymousModeKey(code, role));
    return raw ? sanitizeAnonymitySettings(JSON.parse(raw)) : getDefaultAnonymitySettings();
  } catch (_) {
    return getDefaultAnonymitySettings();
  }
}

function persistAnonymitySettings(code, role, settings) {
  localStorage.setItem(anonymousModeKey(code, role), JSON.stringify(sanitizeAnonymitySettings(settings)));
}

function defaultDisplayName(role, t) {
  if (role === "facilitator") return t.videoDefaultFacilitatorName;
  return `${t.videoAnonymousPrefix} ${Math.floor(100 + Math.random() * 900)}`;
}

function attachAnonymousResources(track, resources) {
  if (!track) return track;
  track.__ghostAnonymousResources = resources;
  return track;
}

// Resources only ever hold a `processor` (the disposable canvas/audio-graph
// wrapper around anonymization). The raw camera/microphone MediaStreamTrack is
// never part of these resources: it is a long-lived device handle owned by
// rawCameraTrackRef/rawMicrophoneTrackRef and must survive settings changes,
// otherwise every mode switch reopens the physical device while the previous
// handle is still live, which is exactly what produced the intermittent
// "NotFoundError: The object can not be found here." on real hardware.
async function destroyResources(resources) {
  try {
    await resources?.processor?.destroy?.();
  } catch (_) {
    // Ignore processor shutdown failures during cleanup.
  }
}

// Stops a generated LocalTrack only if it wraps a disposable processed track
// (i.e. it has a processor). Tracks that directly wrap the persistent raw
// device track must never be stopped here - their lifecycle is owned by
// releaseRawTrack.
async function discardGeneratedTrack(track) {
  if (!track) return;
  const resources = track.__ghostAnonymousResources;
  await destroyResources(resources);
  if (resources?.processor) {
    try {
      track.stop();
    } catch (_) {
      // Ignore tracks already stopped.
    }
  }
}

async function disposeTrack(room, track, releaseRaw) {
  if (!track) return;
  try {
    await room.localParticipant.unpublishTrack(track, false);
  } catch (_) {
    // Ignore unpublish failures during cleanup.
  }
  await destroyResources(track.__ghostAnonymousResources);
  try {
    track.stop();
  } catch (_) {
    // Ignore tracks already stopped by the browser/SDK.
  }
  releaseRaw?.();
}

function AnonymousModePanel({ settings, busy, error, status, voiceTemplates, onRetry, onToggleEnabled, onChange, t }) {
  const enabled = settings.enabled;
  const templates = voiceTemplates?.length ? voiceTemplates : [{ id: "anonymous-neutral-01", name: "Neutral Anonymous" }];
  return (
    <div className={`anonymous-mode-card${enabled ? " is-on" : ""}`}>
      <div className="anonymous-mode-summary">
        <p className="anonymous-mode-eyebrow">{enabled ? t.videoAnonymousOn : t.videoAnonymousOff}</p>
        <strong>{t.videoAnonymousTitle}</strong>
      </div>
      <div className="anonymous-mode-actions">
        <button className="btn btn-primary anonymous-mode-toggle" type="button" onClick={onToggleEnabled} disabled={busy}>
          {busy ? t.videoAnonymousApplying : enabled ? t.videoAnonymousDisable : t.videoAnonymousEnable}
        </button>
      </div>
      <div className="anonymous-mode-fields">
        <label>
          <span>{t.videoAnonymousAudioMode}</span>
          <select value={settings.audioMode} onChange={(event) => onChange("enabled", event.target.value === "anonymous")} disabled={busy}>
            <option value="normal">{t.videoAnonymousAudioModeNormal}</option>
            <option value="anonymous">{t.videoAnonymousAudioModeAnonymous}</option>
          </select>
        </label>
        <label>
          <span>{t.videoAnonymousVideoMode}</span>
          <select value={settings.videoMode} onChange={(event) => onChange("videoMode", event.target.value)} disabled={busy}>
            <option value="anonymous_mask">{t.videoAnonymousModeMask}</option>
            <option value="face_blur">{t.videoAnonymousModeBlur}</option>
            <option value="face_pixelation">{t.videoAnonymousModePixel}</option>
            <option value="off">{t.videoAnonymousModeOff}</option>
          </select>
        </label>
        <label>
          <span>{t.videoAnonymousVoiceMode}</span>
          <select value={settings.voiceMode} onChange={(event) => onChange("voiceMode", event.target.value)} disabled={busy}>
            <option value="masked">{t.videoAnonymousVoiceMasked}</option>
            <option value="synthetic">{t.videoAnonymousVoiceSynthetic}</option>
            <option value="off">{t.videoAnonymousModeOff}</option>
          </select>
        </label>
        <label>
          <span>{t.videoAnonymousLanguageMode}</span>
          <select value={settings.languageMode} onChange={(event) => onChange("languageMode", event.target.value)} disabled={busy}>
            <option value="auto">{t.videoAnonymousLanguageAuto}</option>
            <option value="manual">{t.videoAnonymousLanguageManual}</option>
          </select>
        </label>
        <label>
          <span>{t.videoAnonymousPreferredLanguage}</span>
          <select value={settings.preferredLanguage} onChange={(event) => onChange("preferredLanguage", event.target.value)} disabled={busy || settings.languageMode === "auto"}>
            <option value="uk-UA">Українська</option>
            <option value="en-US">English</option>
            <option value="pl-PL">Polski</option>
            <option value="ru-RU">Русский</option>
          </select>
        </label>
        <label>
          <span>{t.videoAnonymousVoiceTemplate}</span>
          <select value={settings.voiceTemplateId} onChange={(event) => onChange("voiceTemplateId", event.target.value)} disabled={busy}>
            {templates.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
      </div>
      <div className="anonymous-mode-avatar-section">
        <div className="anonymous-mode-avatar-heading">
          <span>{t.videoAnonymousAvatar}</span>
          <small>{t.videoAnonymousAvatarHint}</small>
        </div>
        <div className="anonymous-mode-avatar-grid" role="list" aria-label={t.videoAnonymousAvatar}>
          {AVATAR_OPTIONS.map((avatar) => {
            const selected = settings.avatarId === avatar.id;
            return (
              <button
                key={avatar.id}
                type="button"
                role="listitem"
                className={`anonymous-mode-avatar-option${selected ? " is-selected" : ""}`}
                onClick={() => onChange("avatarId", avatar.id)}
                disabled={busy}
                aria-pressed={selected ? "true" : "false"}
                title={avatar.name}
              >
                <img src={`/${avatar.id}.png`} alt={avatar.name} loading="lazy" />
                <span>{avatar.name}</span>
              </button>
            );
          })}
        </div>
      </div>
      <p className="anonymous-mode-copy">
        {enabled ? t.videoAnonymousEnabledHint : t.videoAnonymousDisabledHint}
      </p>
      {status ? (
        <div className="anonymous-mode-copy">
          <strong>{status.status_label}</strong>
          {status.worker_ready === false && enabled ? <div>{t.videoAnonymousOriginalMuted}</div> : null}
          {status.detected_language ? <div>{`${t.videoAnonymousLanguageDetected}: ${status.detected_language}`}</div> : null}
          {typeof status.latency_ms === "number" && status.latency_ms > 0 ? <div>{`${t.videoAnonymousLatency}: ${status.latency_ms} ms`}</div> : null}
        </div>
      ) : null}
      {error ? <p className="error">{error}</p> : null}
      {enabled ? <button className="btn" type="button" onClick={onRetry} disabled={busy}>{t.videoAnonymousRetry}</button> : null}
    </div>
  );
}

function MediaControlButton({ active, disabled, onClick, children }) {
  return (
    <button
      type="button"
      className="lk-button"
      aria-pressed={active ? "true" : "false"}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

function GhostControlBar({
  cameraEnabled,
  microphoneEnabled,
  busy,
  onToggleCamera,
  onToggleMicrophone,
  t,
}) {
  return (
    <div className="lk-control-bar ghost-control-bar">
      <MediaControlButton active={microphoneEnabled} disabled={busy} onClick={onToggleMicrophone}>
        {microphoneEnabled ? t.videoMuteMicrophone : t.videoUnmuteMicrophone}
      </MediaControlButton>
      <MediaControlButton active={cameraEnabled} disabled={busy} onClick={onToggleCamera}>
        {cameraEnabled ? t.videoDisableCamera : t.videoEnableCamera}
      </MediaControlButton>
      <TrackToggle source={Track.Source.ScreenShare}>
        {t.videoShareScreen}
      </TrackToggle>
      <ChatToggle>{t.videoChat}</ChatToggle>
      <DisconnectButton>{t.videoLeave}</DisconnectButton>
      <StartMediaButton />
    </div>
  );
}

function GhostVideoConference({ controls, t, participantFilter = null }) {
  const [widgetState, setWidgetState] = useState({
    showChat: false,
    unreadMessages: 0,
    showSettings: false,
  });
  const layoutContext = useCreateLayoutContext();
  // `updateOnlyOn` replaces (not extends) the room events that refresh this
  // list - it does not default-merge with track publish/subscribe events.
  // Restricting it to ActiveSpeakersChanged meant the tile list never
  // refreshed when a camera track was published or replaced (including the
  // raw->anonymized swap), so video only ever showed placeholders. Leave it
  // unset to use @livekit/components-react's default event set, which
  // includes local/remote track publish, subscribe, and mute events.
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false },
  );
  const visibleTracks = useMemo(
    () => (typeof participantFilter === "function"
      ? tracks.filter((trackRef) => participantFilter(trackRef.participant))
      : tracks),
    [participantFilter, tracks],
  );

  return (
    <div className="lk-video-conference">
      <LayoutContextProvider value={layoutContext} onWidgetChange={setWidgetState}>
        <div className="lk-video-conference-inner">
          <div className="lk-grid-layout-wrapper">
            <GridLayout tracks={visibleTracks}>
              <ParticipantTile />
            </GridLayout>
          </div>
          <GhostControlBar {...controls} t={t} />
        </div>
        <Chat style={{ display: widgetState.showChat ? "grid" : "none" }} />
      </LayoutContextProvider>
      <RoomAudioRenderer />
      <ConnectionStateToast />
    </div>
  );
}

function statusLabelFromState(status, t) {
  switch (status) {
    case "initializing": return t.videoAnonymousStatusInitializing;
    case "ready": return t.videoAnonymousStatusReady;
    case "listening": return t.videoAnonymousStatusListening;
    case "recognizing": return t.videoAnonymousStatusRecognizing;
    case "synthesizing": return t.videoAnonymousStatusSynthesizing;
    case "playing": return t.videoAnonymousStatusPlaying;
    case "error": return t.videoAnonymousStatusError;
    default: return t.videoAnonymousStatusOff;
  }
}

function MediaStatusPanel({
  connectionState,
  inputConnected,
  mediaTopology,
  role,
  cameraEnabled,
  microphoneEnabled,
  transcriptConsented,
  anonymousAudioStatus,
  room,
  inputRoom,
  anonymityEnabled,
  t,
}) {
  const [snapshot, setSnapshot] = useState({ cameraPublished: false, microphonePublished: false });

  useEffect(() => {
    const refresh = () => {
      const cameraPublication = room.localParticipant?.getTrackPublication?.(Track.Source.Camera);
      const microphoneRoom = (microphoneEnabled && mediaTopology === "dual" && role === "participant" && anonymityEnabled)
        ? inputRoom
        : room;
      const microphonePublication = microphoneRoom?.localParticipant?.getTrackPublication?.(Track.Source.Microphone);
      setSnapshot({
        cameraPublished: Boolean(cameraPublication?.track),
        microphonePublished: Boolean(microphonePublication?.track),
      });
    };
    refresh();
    const timer = window.setInterval(refresh, 500);
    return () => window.clearInterval(timer);
  }, [anonymityEnabled, inputRoom, mediaTopology, microphoneEnabled, role, room]);

  const connected = connectionState === ConnectionState.Connected;
  const inputRequired = mediaTopology === "dual" && role === "participant" && anonymityEnabled;
  const inputReady = !inputRequired || inputConnected;
  const workerReady = !anonymityEnabled
    ? "off"
    : anonymousAudioStatus?.worker_ready === true
      ? "ready"
      : anonymousAudioStatus?.worker_ready === false
        ? "error"
        : "checking";

  const stateLabel = (state) => {
    if (state === "ok") return t.videoMediaStatusReady;
    if (state === "error") return t.videoMediaStatusError;
    if (state === "off") return t.videoMediaStatusNotApplicable;
    return t.videoMediaStatusChecking;
  };

  return (
    <section className="media-status-card" aria-live="polite">
      <div className="media-status-heading">
        <div>
          <p className="anonymous-mode-eyebrow">{t.videoMediaStatusEyebrow}</p>
          <strong>{t.videoMediaStatusTitle}</strong>
        </div>
        <span className={`media-status-dot${connected && inputReady ? " is-ready" : " is-error"}`} aria-hidden="true" />
      </div>
      <dl className="media-status-list">
        <div>
          <dt>{t.videoMediaStatusPublicRoom}</dt>
          <dd className={connected ? "is-ready" : "is-error"}>{connected ? t.videoMediaStatusConnected : String(connectionState || t.videoMediaStatusChecking)}</dd>
        </div>
        <div>
          <dt>{t.videoMediaStatusCamera}</dt>
          <dd className={cameraEnabled && snapshot.cameraPublished ? "is-ready" : cameraEnabled ? "is-error" : "is-muted"}>
            {cameraEnabled ? (snapshot.cameraPublished ? t.videoMediaStatusPublished : t.videoMediaStatusMissing) : t.videoMediaStatusDisabled}
          </dd>
        </div>
        <div>
          <dt>{t.videoMediaStatusMicrophone}</dt>
          <dd className={microphoneEnabled && snapshot.microphonePublished ? "is-ready" : microphoneEnabled ? "is-error" : "is-muted"}>
            {microphoneEnabled ? (snapshot.microphonePublished ? t.videoMediaStatusPublished : t.videoMediaStatusMissing) : t.videoMediaStatusDisabled}
          </dd>
        </div>
        {mediaTopology === "dual" && role === "participant" ? (
          <div>
            <dt>{t.videoMediaStatusInputRoom}</dt>
            <dd className={inputConnected ? "is-ready" : inputRequired ? "is-error" : "is-muted"}>
              {inputConnected ? t.videoMediaStatusConnected : inputRequired ? t.videoMediaStatusDisconnected : t.videoMediaStatusNotApplicable}
            </dd>
          </div>
        ) : null}
        <div>
          <dt>{t.videoMediaStatusAnonymity}</dt>
          <dd className={anonymityEnabled ? "is-ready" : "is-muted"}>{anonymityEnabled ? t.videoMediaStatusEnabled : t.videoMediaStatusDisabled}</dd>
        </div>
        {role === "participant" ? (
          <div>
            <dt>{t.videoMediaStatusTranscript}</dt>
            <dd className={transcriptConsented ? "is-ready" : "is-muted"}>{transcriptConsented ? t.videoMediaStatusConsented : t.videoMediaStatusNotConsented}</dd>
          </div>
        ) : null}
        <div>
          <dt>{t.videoMediaStatusWorker}</dt>
          <dd className={`is-${workerReady === "ready" ? "ready" : workerReady === "error" ? "error" : workerReady === "off" ? "muted" : "checking"}`}>
            {stateLabel(workerReady === "ready" ? "ok" : workerReady === "error" ? "error" : workerReady === "off" ? "off" : "checking")}
          </dd>
        </div>
      </dl>
      {cameraEnabled && !snapshot.cameraPublished && connected ? <p className="media-status-warning">{t.videoMediaStatusCameraWarning}</p> : null}
    </section>
  );
}

function publishedAudioTrackName(settings) {
  return settings.enabled && settings.voiceMode === "synthetic" ? ANONYMOUS_MICROPHONE_TRACK : PUBLIC_MICROPHONE_TRACK;
}

function requestedAudioMode(settings) {
  if (!settings.enabled) return "normal";
  return settings.voiceMode === "masked" ? "masked" : "anonymous";
}

function ManagedVideoRoom({ sessionCode, role, displayName, initialAnonymitySettings, participantToken, voiceTemplates, t, mediaTopology = "single", inputRoom = null, inputToken = "", inputServerUrl = "", onAudioModeChange = null }) {
  const room = useRoomContext();
  const connectionState = useConnectionState();
  const [anonymitySettings, setAnonymitySettings] = useState(initialAnonymitySettings);
  const [anonymousAudioStatus, setAnonymousAudioStatus] = useState(null);
  const [transcriptConsented, setTranscriptConsented] = useState(false);
  const [liveCaptions, setLiveCaptions] = useState([]);
  const [partialCaption, setPartialCaption] = useState(null);
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [microphoneEnabled, setMicrophoneEnabled] = useState(true);
  const [busy, setBusy] = useState(false);
  const [inputConnected, setInputConnected] = useState(mediaTopology !== "dual" || role !== "participant");
  const [error, setError] = useState("");
  const [anonymityPopupOpen, setAnonymityPopupOpen] = useState(false);
  const initializedRef = useRef(false);
  const cameraTrackRef = useRef(null);
  const microphoneTrackRef = useRef(null);
  const microphoneRoomRef = useRef(room);
  const audioContextRef = useRef(null);
  // Long-lived raw device handles. These are acquired once (on first need)
  // and reused across every anonymity settings change, camera/mic replace,
  // and reconnect - only released by an explicit camera/mic-off toggle or on
  // leaving the room. Re-acquiring the same physical device via a second
  // getUserMedia() call while the first handle is still open is what used to
  // throw an intermittent NotFoundError ("The object cannot be found here.")
  // on real hardware whenever anonymity mode was toggled or a mask/voice
  // preset was changed while the call was live.
  const rawCameraTrackRef = useRef(null);
  const rawMicrophoneTrackRef = useRef(null);
  const rawAcquirePendingRef = useRef(null);
  const transcriptStartedAtRef = useRef(performance.now());
  const partialCaptionRequestRef = useRef(0);
  const profile = useMemo(
    () => buildAnonymousProfile(`${sessionCode}:${role}:${displayName}`, role),
    [displayName, role, sessionCode],
  );

  const recordTranscript = useCallback(({ text, startedAt, endedAt, language }) => {
    if (role !== "participant" || !participantToken || !transcriptConsented || !String(text || "").trim()) return;
    const captionText = String(text).trim();
    if (partialCaptionRequestRef.current) {
      window.clearTimeout(partialCaptionRequestRef.current);
      partialCaptionRequestRef.current = 0;
    }
    setPartialCaption(null);
    const provisionalID = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
    setLiveCaptions((previous) => [...previous, {
      id: provisionalID,
      text: captionText,
      language: String(language || "").split("-")[0],
    }].slice(-4));
    const sessionStartedAt = transcriptStartedAtRef.current;
    createTranscriptSegment(sessionCode, {
      segment_key: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`,
      text: captionText,
      language: String(language || "").split("-")[0],
      confidence: 1,
      started_at_ms: Math.max(0, Math.round(startedAt - sessionStartedAt)),
      ended_at_ms: Math.max(0, Math.round(endedAt - sessionStartedAt)),
    }, participantToken).then((result) => {
      const segment = result.segment;
      if (!segment?.id) return;
      setLiveCaptions((previous) => [...previous.filter((caption) => caption.id !== provisionalID && caption.id !== segment.id), {
        id: segment.id,
        text: segment.text,
        language: segment.language || "",
      }].slice(-4));
    }).catch((err) => {
      // Keep the local caption visible even if persistence fails; it is not
      // retained and disappears with the page.
      console.warn("[transcript] unable to save final segment", err);
    });
  }, [participantToken, role, sessionCode, transcriptConsented]);

  const recordPartialTranscript = useCallback(({ text, language }) => {
    if (role !== "participant" || !participantToken || !transcriptConsented) return;
    const captionText = String(text || "").trim();
    setPartialCaption(captionText ? { text: captionText, language: String(language || "").split("-")[0] } : null);
    if (partialCaptionRequestRef.current) window.clearTimeout(partialCaptionRequestRef.current);
    if (!captionText) {
      partialCaptionRequestRef.current = 0;
      return;
    }
    // Browser STT updates a phrase character-by-character. Debouncing avoids
    // flooding SSE while retaining the feel of a live caption.
    partialCaptionRequestRef.current = window.setTimeout(() => {
      partialCaptionRequestRef.current = 0;
      createTranscriptPartial(sessionCode, {
        text: captionText,
        language: String(language || "").split("-")[0],
      }, participantToken).catch(() => {});
    }, 350);
  }, [participantToken, role, sessionCode, transcriptConsented]);

  useEffect(() => {
    if (role !== "participant" || !participantToken) return;
    getTranscriptConsent(sessionCode, participantToken)
      .then((result) => setTranscriptConsented(Boolean(result.consented)))
      .catch(() => setTranscriptConsented(false));
  }, [participantToken, role, sessionCode]);

  const toggleTranscriptConsent = useCallback(async () => {
    if (!participantToken) return;
    try {
      const result = await setTranscriptConsent(sessionCode, !transcriptConsented, participantToken);
      setTranscriptConsented(Boolean(result.consented));
    } catch (err) {
      setError(err.message);
    }
  }, [participantToken, sessionCode, transcriptConsented]);

  const applyRemoteSubscriptionPolicy = useCallback(() => {
    room.remoteParticipants.forEach((participant) => {
      participant.trackPublications.forEach((publication) => {
        if (publication.kind !== Track.Kind.Audio) return;
        if (!isWorkerParticipant(participant) || mediaTopology === "dual") return;
        publication.setSubscribed(false);
      });
    });
  }, [mediaTopology, room]);

  const ensureAudioContext = useCallback(() => {
    if (audioContextRef.current) return audioContextRef.current;
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) {
      throw new Error(t.videoAnonymousVoiceUnsupported);
    }
    audioContextRef.current = new AudioContextCtor();
    return audioContextRef.current;
  }, [t.videoAnonymousVoiceUnsupported]);

  const releaseRawTrack = useCallback((kind) => {
    const ref = kind === "video" ? rawCameraTrackRef : rawMicrophoneTrackRef;
    if (ref.current) {
      try {
        ref.current.stop();
      } catch (_) {
        // Ignore tracks already stopped.
      }
      ref.current = null;
    }
  }, []);

  const acquireRawTracks = useCallback(async (needCamera, needMicrophone) => {
    const needVideo = needCamera && rawCameraTrackRef.current?.readyState !== "live";
    const needAudio = needMicrophone && rawMicrophoneTrackRef.current?.readyState !== "live";
    if (!needVideo && !needAudio) return { videoError: null, audioError: null };

    if (rawAcquirePendingRef.current) {
      await rawAcquirePendingRef.current;
      return acquireRawTracks(needCamera, needMicrophone);
    }

    // Request devices separately. getUserMedia({ video: true, audio: true })
    // rejects the whole request when either device is denied/missing, which
    // used to make a microphone failure hide an otherwise working camera.
    const promise = (async () => {
      const result = { videoError: null, audioError: null };
      if (needVideo) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
          rawCameraTrackRef.current = stream.getVideoTracks()[0] || null;
        } catch (trackError) {
          result.videoError = trackError;
        }
      }
      if (needAudio) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
          rawMicrophoneTrackRef.current = stream.getAudioTracks()[0] || null;
        } catch (trackError) {
          result.audioError = trackError;
        }
      }
      return result;
    })();
    rawAcquirePendingRef.current = promise;
    try {
      return await promise;
    } finally {
      rawAcquirePendingRef.current = null;
    }
  }, []);

  const createManagedTracks = useCallback(async (needCamera, needMicrophone, settings) => {
    if (!needCamera && !needMicrophone) {
      return { cameraTrack: null, microphoneTrack: null };
    }

    // A static canvas avatar is deliberately independent from the camera: in
    // that mode the browser must not even request a raw video device track.
    const needsRawCamera = needCamera && !(settings.enabled && settings.videoMode === "anonymous_mask");
    const acquireResult = await acquireRawTracks(needsRawCamera, needMicrophone);

    let cameraTrack = null;
    let microphoneTrack = null;

    let cameraError = acquireResult?.videoError || null;
    let microphoneError = acquireResult?.audioError || null;

    if (needCamera && !cameraError) {
      try {
        const rawVideoTrack = rawCameraTrackRef.current;
        if (!rawVideoTrack && !(settings.enabled && settings.videoMode === "anonymous_mask")) {
          throw new Error("camera track unavailable");
        }
        if (settings.enabled && settings.videoMode !== "off") {
          const processor = new AnonymousVideoProcessor(profile, settings);
          await processor.init({ track: rawVideoTrack, audioTrack: rawMicrophoneTrackRef.current });
          cameraTrack = attachAnonymousResources(
            new LocalVideoTrack(processor.processedTrack, rawVideoTrack?.getConstraints?.(), true),
            { processor },
          );
        } else {
          cameraTrack = attachAnonymousResources(
            new LocalVideoTrack(rawVideoTrack, rawVideoTrack.getConstraints?.(), true),
            {},
          );
        }
      } catch (trackError) {
        cameraError = trackError;
      }
    }

    if (needMicrophone && !microphoneError) {
      try {
        const rawAudioTrack = rawMicrophoneTrackRef.current;
        if (!rawAudioTrack) throw new Error("microphone track unavailable");
        const audioContext = ensureAudioContext();
        if (audioContext.state === "suspended") {
          await audioContext.resume().catch(() => {});
        }
        if (mediaTopology === "dual" && role === "participant") {
          // Raw microphone is confined to the input room. The public room
          // receives only the worker's redacted/synthesized track.
          microphoneTrack = new LocalAudioTrack(rawAudioTrack, rawAudioTrack.getConstraints?.(), true, audioContext);
        } else if (settings.enabled && settings.voiceMode === "masked") {
          const processor = new MaskedAudioProcessor(settings);
          await processor.init({ track: rawAudioTrack, audioContext });
          microphoneTrack = attachAnonymousResources(
            new LocalAudioTrack(processor.processedTrack, rawAudioTrack.getConstraints?.(), true, audioContext),
            { processor },
          );
        } else if (settings.enabled && settings.voiceMode === "synthetic") {
          const processor = new SpeechSynthesisAudioProcessor(profile, settings, {
            onTranscript: recordTranscript,
            onPartialTranscript: recordPartialTranscript,
          });
          await processor.init({ track: rawAudioTrack, audioContext });
          microphoneTrack = attachAnonymousResources(
            new LocalAudioTrack(processor.processedTrack, rawAudioTrack.getConstraints?.(), true, audioContext),
            { processor },
          );
        } else if (settings.enabled) {
          // Fail closed: anonymous mode never substitutes the original voice.
          microphoneTrack = null;
        } else {
          microphoneTrack = attachAnonymousResources(
            new LocalAudioTrack(rawAudioTrack, rawAudioTrack.getConstraints?.(), true, audioContext),
            {},
          );
        }
      } catch (trackError) {
        microphoneError = trackError;
      }
    }

    if (cameraError) {
      await discardGeneratedTrack(microphoneTrack);
      throw cameraError;
    }
    if (microphoneError) {
      await discardGeneratedTrack(microphoneTrack);
      // Anonymous voice must fail closed, but a browser audio API failure
      // must not remove an otherwise valid raw/anonymized camera track.
    }

    return { cameraTrack, microphoneTrack, cameraError, microphoneError };
  }, [acquireRawTracks, ensureAudioContext, mediaTopology, profile, recordPartialTranscript, recordTranscript, role]);

  const replacePublishedTrack = useCallback(async (currentTrack, nextTrack) => {
    if (!currentTrack || !nextTrack) {
      return nextTrack;
    }

    const previousResources = currentTrack.__ghostAnonymousResources;
    const nextResources = nextTrack.__ghostAnonymousResources;

    try {
      await currentTrack.replaceTrack(nextTrack.mediaStreamTrack, true);
      if (currentTrack.kind === Track.Kind.Audio) {
        currentTrack.setAudioContext?.(audioContextRef.current);
      }
      currentTrack.__ghostAnonymousResources = nextResources;
      await destroyResources(previousResources);
      return currentTrack;
    } catch (replaceError) {
      await discardGeneratedTrack(nextTrack);
      throw replaceError;
    }
  }, []);

  const rebuildPublishedMedia = useCallback(async (settings, nextCameraEnabled, nextMicrophoneEnabled) => {
    const { cameraTrack, microphoneTrack, microphoneError } = await createManagedTracks(
      nextCameraEnabled,
      nextMicrophoneEnabled,
      settings,
    );

    try {
      if (nextCameraEnabled) {
        if (cameraTrackRef.current && cameraTrack) {
          cameraTrackRef.current = await replacePublishedTrack(cameraTrackRef.current, cameraTrack);
        } else if (!cameraTrackRef.current && cameraTrack) {
          await room.localParticipant.publishTrack(cameraTrack, { source: Track.Source.Camera, name: "camera-public" });
          cameraTrackRef.current = cameraTrack;
        }
        // Switching to a static avatar must also turn off a camera acquired
        // by a previous blur/pixel/normal mode.
        if (settings.enabled && settings.videoMode === "anonymous_mask") {
          releaseRawTrack("video");
        }
      } else if (cameraTrackRef.current) {
        await disposeTrack(room, cameraTrackRef.current, () => releaseRawTrack("video"));
        cameraTrackRef.current = null;
      }

      if (microphoneError) {
        setMicrophoneEnabled(false);
        if (settings.enabled) setError(t.videoAnonymousError);
      }

      const targetMicrophoneRoom = mediaTopology === "dual" && role === "participant" && settings.enabled ? inputRoom : room;
      if (nextMicrophoneEnabled && microphoneTrackRef.current && microphoneRoomRef.current !== targetMicrophoneRoom) {
        await disposeTrack(microphoneRoomRef.current, microphoneTrackRef.current, null);
        microphoneTrackRef.current = null;
      }
      if (nextMicrophoneEnabled && !microphoneTrack && settings.enabled && !(mediaTopology === "dual" && role === "participant")) {
        // Anonymous mode must fail closed. A disabled/failed synthetic pipeline
        // is mute; it must never retain or publish the raw microphone track.
        setMicrophoneEnabled(false);
        setError(t.videoAnonymousError);
        if (microphoneTrackRef.current) {
          await disposeTrack(room, microphoneTrackRef.current, () => releaseRawTrack("audio"));
          microphoneTrackRef.current = null;
        }
      } else if (nextMicrophoneEnabled) {
        if (microphoneTrackRef.current && microphoneTrack) {
          microphoneTrackRef.current = await replacePublishedTrack(microphoneTrackRef.current, microphoneTrack);
        } else if (!microphoneTrackRef.current && microphoneTrack) {
          if (!targetMicrophoneRoom) throw new Error("input room unavailable");
          await targetMicrophoneRoom.localParticipant.publishTrack(microphoneTrack, { source: Track.Source.Microphone, name: publishedAudioTrackName(settings) });
          microphoneTrackRef.current = microphoneTrack;
          microphoneRoomRef.current = targetMicrophoneRoom;
        }
      } else if (microphoneTrackRef.current) {
        await disposeTrack(room, microphoneTrackRef.current, () => releaseRawTrack("audio"));
        microphoneTrackRef.current = null;
      }
    } catch (rebuildError) {
      if (cameraTrack && cameraTrack !== cameraTrackRef.current) {
        await discardGeneratedTrack(cameraTrack);
      }
      if (microphoneTrack && microphoneTrack !== microphoneTrackRef.current) {
        await discardGeneratedTrack(microphoneTrack);
      }
      throw rebuildError;
    }
  }, [createManagedTracks, inputRoom, mediaTopology, releaseRawTrack, replacePublishedTrack, role, room, t.videoAnonymousError]);

  const applyAnonymitySettings = useCallback(async (nextSettings) => {
    setBusy(true);
    setError("");
    try {
      const sanitized = sanitizeAnonymitySettings(nextSettings);
      const previousAudioMode = requestedAudioMode(anonymitySettings);
      const nextAudioMode = requestedAudioMode(sanitized);
      // In dual topology the public-room JWT explicitly lists publishable
      // sources. Refresh it before moving the microphone between rooms so a
      // normal-mode participant can publish to the public room and an
      // anonymous/masked participant cannot retain that capability.
      if (
        role === "participant" &&
        mediaTopology === "dual" &&
        previousAudioMode !== nextAudioMode &&
        onAudioModeChange
      ) {
        const refreshedToken = await onAudioModeChange(nextAudioMode);
        if (!refreshedToken || typeof room.updateToken !== "function") {
          throw new Error("public room token refresh unavailable");
        }
        await room.updateToken(refreshedToken);
      }
      if (role === "participant" && participantToken) {
        const statusRes = await updateAnonymousAudio(sessionCode, {
          enabled: sanitized.enabled,
          language_mode: sanitized.languageMode,
          preferred_language: sanitized.preferredLanguage,
          voice_template_id: sanitized.voiceTemplateId,
          audio_mode: requestedAudioMode(sanitized),
          pii_redaction_enabled: false,
        }, participantToken);
        setAnonymousAudioStatus({ ...statusRes, status_label: statusLabelFromState(statusRes.status, t) });
      }
      await rebuildPublishedMedia(sanitized, cameraEnabled, microphoneEnabled);
      setAnonymitySettings(sanitized);
      persistAnonymitySettings(sessionCode, role, sanitized);
    } catch (err) {
      console.error(err);
      setError(t.videoAnonymousError);
    } finally {
      setBusy(false);
    }
  }, [
    cameraEnabled,
    microphoneEnabled,
    participantToken,
    rebuildPublishedMedia,
    role,
    mediaTopology,
    anonymitySettings,
    onAudioModeChange,
    room,
    sessionCode,
    t,
    t.videoAnonymousError,
  ]);

  const updateAnonymityField = useCallback((field, value) => {
    const nextSettings = sanitizeAnonymitySettings({
      ...anonymitySettings,
      [field]: value,
      enabled: field === "enabled" ? value : anonymitySettings.enabled,
    });
    if (field !== "enabled") {
      nextSettings.enabled = nextSettings.videoMode !== "off" || nextSettings.voiceMode !== "off";
      nextSettings.audioMode = nextSettings.enabled ? "anonymous" : "normal";
    }
    applyAnonymitySettings(nextSettings);
  }, [anonymitySettings, applyAnonymitySettings]);

  const toggleCamera = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      if (cameraEnabled) {
        await disposeTrack(room, cameraTrackRef.current, () => releaseRawTrack("video"));
        cameraTrackRef.current = null;
        setCameraEnabled(false);
      } else {
        const { cameraTrack } = await createManagedTracks(true, false, anonymitySettings);
        if (cameraTrack) {
          await room.localParticipant.publishTrack(cameraTrack, { source: Track.Source.Camera, name: "camera-public" });
          cameraTrackRef.current = cameraTrack;
          setCameraEnabled(true);
        }
      }
    } catch (err) {
      console.error(err);
      setError(t.videoAnonymousError);
    } finally {
      setBusy(false);
    }
  }, [anonymitySettings, busy, cameraEnabled, createManagedTracks, releaseRawTrack, room, t.videoAnonymousError]);

  const toggleMicrophone = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      if (microphoneEnabled) {
        await disposeTrack(room, microphoneTrackRef.current, () => releaseRawTrack("audio"));
        microphoneTrackRef.current = null;
        setMicrophoneEnabled(false);
      } else {
        const { microphoneTrack } = await createManagedTracks(false, true, anonymitySettings);
        if (microphoneTrack) {
          const targetRoom = mediaTopology === "dual" && role === "participant" && anonymitySettings.enabled ? inputRoom : room;
          if (!targetRoom) throw new Error("input room unavailable");
          await targetRoom.localParticipant.publishTrack(microphoneTrack, { source: Track.Source.Microphone, name: publishedAudioTrackName(anonymitySettings) });
          microphoneTrackRef.current = microphoneTrack;
          microphoneRoomRef.current = targetRoom;
          setMicrophoneEnabled(true);
        }
      }
    } catch (err) {
      console.error(err);
      setError(t.videoAnonymousError);
    } finally {
      setBusy(false);
    }
  }, [anonymitySettings, busy, createManagedTracks, inputRoom, mediaTopology, microphoneEnabled, releaseRawTrack, role, room, t.videoAnonymousError]);

  useEffect(() => {
    if (mediaTopology !== "dual" || role !== "participant" || !inputRoom || !inputToken || !inputServerUrl) return undefined;
    let cancelled = false;
    inputRoom.connect(inputServerUrl, inputToken, { autoSubscribe: false }).then(() => {
      if (!cancelled) setInputConnected(true);
    }).catch(() => {
      // Normal public audio/video does not depend on the private input room.
      // Keep the diagnostic error scoped to modes that actually require it.
      if (!cancelled && anonymitySettings.enabled) setError(t.videoAnonymousError);
    });
    return () => {
      cancelled = true;
      setInputConnected(false);
      inputRoom.disconnect().catch(() => {});
    };
  }, [anonymitySettings.enabled, inputRoom, inputServerUrl, inputToken, mediaTopology, role, t.videoAnonymousError]);

  useEffect(() => {
    const inputRequired = mediaTopology === "dual" && role === "participant" && anonymitySettings.enabled;
    if (connectionState !== ConnectionState.Connected || (inputRequired && !inputConnected) || initializedRef.current) return;
    initializedRef.current = true;
    rebuildPublishedMedia(anonymitySettings, true, true).catch((err) => {
      console.error(err);
      setError(t.videoAnonymousError);
      setCameraEnabled(false);
      setMicrophoneEnabled(false);
    });
  }, [anonymitySettings, connectionState, inputConnected, mediaTopology, rebuildPublishedMedia, role, t.videoAnonymousError]);

  useEffect(() => {
    if (connectionState !== ConnectionState.Connected) return undefined;

    applyRemoteSubscriptionPolicy();

    const reapply = () => applyRemoteSubscriptionPolicy();
    room.on(RoomEvent.ParticipantConnected, reapply);
    room.on(RoomEvent.TrackPublished, reapply);
    room.on(RoomEvent.TrackSubscribed, reapply);

    return () => {
      room.off(RoomEvent.ParticipantConnected, reapply);
      room.off(RoomEvent.TrackPublished, reapply);
      room.off(RoomEvent.TrackSubscribed, reapply);
    };
  }, [applyRemoteSubscriptionPolicy, connectionState, room]);

  // Keep the screen from auto-locking during a call - a locked/screen-off phone
  // throttles the tab's JS timers and drops the LiveKit connection. The wake
  // lock is released by the browser whenever the tab backgrounds, so it has to
  // be re-requested on visibilitychange to hold for the whole call.
  useEffect(() => {
    if (!("wakeLock" in navigator)) return;
    let wakeLock = null;
    let cancelled = false;
    const acquire = async () => {
      try {
        wakeLock = await navigator.wakeLock.request("screen");
      } catch (_) {
        // Not fatal - call still works, screen may just lock on its own.
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible" && !cancelled) acquire();
    };
    acquire();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      wakeLock?.release().catch(() => {});
    };
  }, []);

  useEffect(() => {
    if (!sessionCode) return undefined;
    const es = new EventSource(getEventsUrl(sessionCode));
    es.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg?.type === "transcript.segment.partial" && role === "participant") {
        const segment = msg.payload || {};
        setPartialCaption(segment.text ? { text: segment.text, language: segment.language || "" } : null);
        return;
      }
      if (msg?.type === "transcript.segment.final" && role === "participant") {
        const segment = msg.payload || {};
        setPartialCaption(null);
        if (segment.text) {
          setLiveCaptions((previous) => [...previous.filter((caption) => caption.id !== segment.id), {
            id: segment.id,
            text: segment.text,
            language: segment.language || "",
          }].slice(-4));
        }
        return;
      }
      if (!String(msg?.type || "").startsWith("anonymous_audio.")) return;
      const payload = msg.payload || {};
      setAnonymousAudioStatus((prev) => ({
        ...(prev || {}),
        ...payload,
        status_label: statusLabelFromState(payload.status, t),
      }));
    };
    return () => es.close();
  }, [role, sessionCode, t]);

  useEffect(() => () => {
    if (partialCaptionRequestRef.current) window.clearTimeout(partialCaptionRequestRef.current);
  }, []);

  useEffect(() => {
    if (role !== "participant" || !participantToken) return undefined;
    let alive = true;
    const poll = async () => {
      try {
        const statusRes = await getAnonymousAudioStatus(sessionCode, participantToken);
        if (!alive) return;
        setAnonymousAudioStatus({ ...statusRes, status_label: statusLabelFromState(statusRes.status, t) });
      } catch (_) {
        // Keep last known status; anonymous mode must not auto-fallback.
      }
    };
    poll();
    const timer = window.setInterval(poll, 5000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [participantToken, role, sessionCode, t]);

  useEffect(() => () => {
    Promise.allSettled([
      disposeTrack(room, cameraTrackRef.current, () => releaseRawTrack("video")),
      disposeTrack(microphoneRoomRef.current || room, microphoneTrackRef.current, () => releaseRawTrack("audio")),
    ]);
    cameraTrackRef.current = null;
    microphoneTrackRef.current = null;
    audioContextRef.current?.close?.().catch(() => {});
  }, [releaseRawTrack, room]);

  const anonymityPanel = (
    <AnonymousModePanel
      settings={anonymitySettings}
      busy={busy}
      error={error}
      status={anonymousAudioStatus}
      voiceTemplates={voiceTemplates}
      onRetry={() => applyAnonymitySettings({ ...anonymitySettings })}
      onToggleEnabled={() => updateAnonymityField("enabled", !anonymitySettings.enabled)}
      onChange={updateAnonymityField}
      t={t}
    />
  );
  const mediaStatusPanelProps = {
    connectionState,
    inputConnected,
    mediaTopology,
    role,
    cameraEnabled,
    microphoneEnabled,
    transcriptConsented,
    anonymousAudioStatus,
    room,
    inputRoom,
    anonymityEnabled: anonymitySettings.enabled,
    t,
  };

  return (
    <div className="video-room-layout">
      <GhostVideoConference
        controls={{
          cameraEnabled,
          microphoneEnabled,
          busy,
          onToggleCamera: toggleCamera,
          onToggleMicrophone: toggleMicrophone,
        }}
        t={t}
        participantFilter={(participant) => !isWorkerParticipant(participant)}
      />
      <aside className="video-room-sidebar">
        <MediaStatusPanel {...mediaStatusPanelProps} />
        {anonymityPanel}
        {role === "participant" ? (
          <>
            <section className="anonymous-mode-card">
              <strong>Транскрипція зустрічі</strong>
              <p>Фінальні фрази зберігатимуться в анонімному текстовому протоколі.</p>
              <button type="button" className="btn" onClick={toggleTranscriptConsent}>
                {transcriptConsented ? "Відкликати згоду" : "Дозволити транскрипцію"}
              </button>
            </section>
            {transcriptConsented && (
              <section className="anonymous-mode-card" aria-live="polite">
                <strong>Ваші live captions</strong>
                {liveCaptions.length === 0 ? <p>Розпізнані фрази з’являться тут.</p> : liveCaptions.map((caption) => (
                  <p key={caption.id}><small>{caption.language || "auto"}</small><br />{caption.text}</p>
                ))}
                {partialCaption && <p><small>{partialCaption.language || "auto"} · розпізнається</small><br />{partialCaption.text}</p>}
              </section>
            )}
          </>
        ) : null}
      </aside>
      <button
        type="button"
        className="anonymous-mode-fab"
        onClick={() => setAnonymityPopupOpen(true)}
      >
        {t.videoAnonymousOpenPanel}
      </button>
      {anonymityPopupOpen ? (
        <div className="anonymous-mode-popup-overlay" onClick={() => setAnonymityPopupOpen(false)}>
          <div className="anonymous-mode-popup" onClick={(event) => event.stopPropagation()}>
            <button
              type="button"
              className="anonymous-mode-popup-close"
              onClick={() => setAnonymityPopupOpen(false)}
              aria-label={t.videoAnonymousClosePanel}
            >
              {t.videoAnonymousClosePanel}
            </button>
            <MediaStatusPanel {...mediaStatusPanelProps} />
            {anonymityPanel}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function VideoRoomPage() {
  const { role = "", code = "" } = useParams();
  const navigate = useNavigate();
  const sessionCode = code.toUpperCase();
  const normalizedRole = role === "facilitator" ? "facilitator" : "participant";
  const { t } = useI18n();
  const [session, setSession] = useState(null);
  const [authToken, setAuthToken] = useState("");
  const [participantToken, setParticipantToken] = useState("");
  const [facilitatorToken, setFacilitatorToken] = useState("");
  const [inputToken, setInputToken] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [anonymitySettings, setAnonymitySettings] = useState(() => readAnonymitySettings(sessionCode, normalizedRole));
  const [voiceTemplates, setVoiceTemplates] = useState([]);
  const [captchaQuestion, setCaptchaQuestion] = useState("");
  const [captchaAnswer, setCaptchaAnswer] = useState("");
  const room = useMemo(() => new Room(), []);
  const inputRoom = useMemo(() => new Room(), []);

  useEffect(() => {
    const savedName = localStorage.getItem(videoDisplayNameKey(sessionCode, normalizedRole)) || defaultDisplayName(normalizedRole, t);
    setDisplayName(savedName);
  }, [sessionCode, normalizedRole, t]);

  useEffect(() => {
    setAnonymitySettings(readAnonymitySettings(sessionCode, normalizedRole));
  }, [sessionCode, normalizedRole]);

  const updatePreJoinAnonymityField = useCallback((field, value) => {
    setAnonymitySettings((prev) => {
      const next = sanitizeAnonymitySettings({
        ...prev,
        [field]: value,
        enabled: field === "enabled" ? value : prev.enabled,
      });
      if (field !== "enabled") {
        next.enabled = next.videoMode !== "off" || next.voiceMode !== "off";
        next.audioMode = next.enabled ? "anonymous" : "normal";
      }
      persistAnonymitySettings(sessionCode, normalizedRole, next);
      return next;
    });
  }, [sessionCode, normalizedRole]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const sessionRes = await getSession(sessionCode);
        const templatesRes = await listVoiceTemplates().catch(() => ({ items: [] }));
        if (!alive) return;
        setSession(sessionRes.session);
        setVoiceTemplates(Array.isArray(templatesRes.items) ? templatesRes.items : []);
        if (normalizedRole === "facilitator") {
          setFacilitatorToken("");
        } else {
          const captchaRes = await getJoinCaptcha(sessionCode);
          if (!alive) return;
          setCaptchaQuestion(captchaRes.question || "");
        }
      } catch (err) {
        if (!alive) return;
        setError(err.message);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [normalizedRole, sessionCode]);

  async function connectToRoom(e) {
    e.preventDefault();
    setError("");
    setConnecting(true);
    try {
      let token = participantToken;
      if (normalizedRole !== "facilitator" && !token) {
        const joinRes = await joinSession(sessionCode, { captcha_answer: captchaAnswer });
        token = joinRes.participant_token || "";
        setParticipantToken(token);
      }
      const trimmedName = displayName.trim();
      const headers = normalizedRole === "facilitator"
        ? { "X-Facilitator-Token": facilitatorToken }
        : { "X-Participant-Token": token };
      const res = await createVideoToken(sessionCode, { display_name: trimmedName, audio_mode: requestedAudioMode(anonymitySettings) }, headers);
      localStorage.setItem(videoDisplayNameKey(sessionCode, normalizedRole), trimmedName);
      setAuthToken(res.token);
      setInputToken(res.input_token || "");
    } catch (err) {
      setError(err.message);
      if (normalizedRole !== "facilitator") {
        setCaptchaAnswer("");
        getJoinCaptcha(sessionCode).then((res) => setCaptchaQuestion(res.question || "")).catch(() => {});
      }
    } finally {
      setConnecting(false);
    }
  }

  const refreshVideoTokenForAudioMode = useCallback(async (audioMode) => {
    if (!session || !authToken) return "";
    const headers = normalizedRole === "facilitator"
      ? { "X-Facilitator-Token": facilitatorToken }
      : { "X-Participant-Token": participantToken };
    const res = await createVideoToken(sessionCode, {
      display_name: displayName.trim(),
      audio_mode: audioMode,
    }, headers);
    setAuthToken(res.token);
    // Keep the existing input-room token/connection stable while the public
    // room permissions are refreshed. Replacing input_token here would cause
    // the input-room effect to disconnect and reconnect in the middle of a
    // microphone handoff.
    return res.token;
  }, [authToken, displayName, facilitatorToken, normalizedRole, participantToken, session, sessionCode]);

  const backHref = normalizedRole === "facilitator" ? `/facilitator/${sessionCode}` : `/session/${sessionCode}`;

  if (loading) return <section className="video-page panel">{t.videoConnecting}</section>;
  if (error && !session) return <section className="video-page panel error">{error}</section>;
  if (!session) return <section className="video-page panel">{t.loadingSession}</section>;
  if (!session.video_enabled) return <section className="video-page panel error">{t.videoConfigMissing}</section>;
  if (!authToken) {
    return (
      <section className="stack-lg video-page">
        <div className="session-header">
          <h2>{t.videoJoinTitle}</h2>
          <p>{session.title}</p>
          <small>{t.videoRoleLabel}: {normalizedRole === "facilitator" ? t.videoRoleFacilitator : t.videoRoleParticipant}</small>
        </div>

        <form className="panel stack-form" onSubmit={connectToRoom}>
          <label>
            {t.videoDisplayName}
            <input
              required
              maxLength={60}
              value={displayName}
              placeholder={t.videoDisplayNameHint}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </label>
          {normalizedRole !== "facilitator" && (
            <label>
              {t.captchaLabel}
              <input value={captchaQuestion} readOnly />
              <input
                required
                value={captchaAnswer}
                onChange={(e) => setCaptchaAnswer(e.target.value)}
              />
            </label>
          )}
          {error && <p className="error">{error}</p>}
          <div className="row">
            <button className="btn btn-primary" type="submit" disabled={connecting}>{connecting ? t.videoConnecting : t.videoJoinCta}</button>
            <Link className="btn" to={backHref}>{t.videoBack}</Link>
          </div>
        </form>

        <AnonymousModePanel
          settings={anonymitySettings}
          busy={false}
          error=""
          status={null}
          voiceTemplates={voiceTemplates}
          onRetry={() => {}}
          onToggleEnabled={() => updatePreJoinAnonymityField("enabled", !anonymitySettings.enabled)}
          onChange={updatePreJoinAnonymityField}
          t={t}
        />
      </section>
    );
  }

  return (
    <section className="stack-lg video-page">
      <div className="row">
        <button className="btn" type="button" onClick={() => navigate(backHref)}>{t.videoBack}</button>
      </div>
      <div className="video-room-shell" data-lk-theme="default">
        <LiveKitRoom
          room={room}
          token={authToken}
          serverUrl={session.video_server_url}
          connect
          audio={false}
          video={false}
          onDisconnected={() => setAuthToken("")}
          onError={(roomError) => setError(roomError.message)}
        >
          <ManagedVideoRoom
            sessionCode={sessionCode}
            role={normalizedRole}
            displayName={displayName}
            initialAnonymitySettings={anonymitySettings}
            participantToken={participantToken}
            voiceTemplates={voiceTemplates}
            t={t}
            mediaTopology={session.media_topology || "single"}
            inputRoom={inputRoom}
            inputToken={inputToken}
            inputServerUrl={session.video_server_url}
            onAudioModeChange={refreshVideoTokenForAudioMode}
          />
        </LiveKitRoom>
      </div>
    </section>
  );
}
