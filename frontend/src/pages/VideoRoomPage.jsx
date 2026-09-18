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
  getAnonymousAudioStatus,
  getEventsUrl,
  getJoinCaptcha,
  getSession,
  joinSession,
  listVoiceTemplates,
  updateAnonymousAudio,
} from "../api/client";
import { videoDisplayNameKey } from "../api/sessionState";
import { useI18n } from "../i18n.jsx";
import {
  AVATAR_OPTIONS,
  AnonymousVideoProcessor,
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

function publishedAudioTrackName(settings) {
  return settings.enabled && settings.voiceMode === "synthetic" ? ANONYMOUS_MICROPHONE_TRACK : PUBLIC_MICROPHONE_TRACK;
}

function ManagedVideoRoom({ sessionCode, role, displayName, initialAnonymitySettings, participantToken, voiceTemplates, t }) {
  const room = useRoomContext();
  const connectionState = useConnectionState();
  const [anonymitySettings, setAnonymitySettings] = useState(initialAnonymitySettings);
  const [anonymousAudioStatus, setAnonymousAudioStatus] = useState(null);
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [microphoneEnabled, setMicrophoneEnabled] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [anonymityPopupOpen, setAnonymityPopupOpen] = useState(false);
  const initializedRef = useRef(false);
  const cameraTrackRef = useRef(null);
  const microphoneTrackRef = useRef(null);
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
  const profile = useMemo(
    () => buildAnonymousProfile(`${sessionCode}:${role}:${displayName}`, role),
    [displayName, role, sessionCode],
  );

  const applyRemoteSubscriptionPolicy = useCallback(() => {
    room.remoteParticipants.forEach((participant) => {
      participant.trackPublications.forEach((publication) => {
        if (publication.kind !== Track.Kind.Audio) return;
        if (!isWorkerParticipant(participant)) return;
        publication.setSubscribed(false);
      });
    });
  }, [room]);

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
    if (!needVideo && !needAudio) return;

    if (rawAcquirePendingRef.current) {
      await rawAcquirePendingRef.current;
      return acquireRawTracks(needCamera, needMicrophone);
    }

    const promise = navigator.mediaDevices
      .getUserMedia({ video: needVideo, audio: needAudio })
      .then((stream) => {
        if (needVideo) rawCameraTrackRef.current = stream.getVideoTracks()[0];
        if (needAudio) rawMicrophoneTrackRef.current = stream.getAudioTracks()[0];
      });
    rawAcquirePendingRef.current = promise;
    try {
      await promise;
    } finally {
      rawAcquirePendingRef.current = null;
    }
  }, []);

  const createManagedTracks = useCallback(async (needCamera, needMicrophone, settings) => {
    if (!needCamera && !needMicrophone) {
      return { cameraTrack: null, microphoneTrack: null };
    }

    await acquireRawTracks(needCamera, needMicrophone);

    let cameraTrack = null;
    let microphoneTrack = null;

    try {
      if (needCamera) {
        const rawVideoTrack = rawCameraTrackRef.current;
        if (settings.enabled && settings.videoMode !== "off") {
          const processor = new AnonymousVideoProcessor(profile, settings);
          await processor.init({ track: rawVideoTrack, audioTrack: rawMicrophoneTrackRef.current });
          cameraTrack = attachAnonymousResources(
            new LocalVideoTrack(processor.processedTrack, rawVideoTrack.getConstraints?.(), true),
            { processor },
          );
        } else {
          cameraTrack = attachAnonymousResources(
            new LocalVideoTrack(rawVideoTrack, rawVideoTrack.getConstraints?.(), true),
            {},
          );
        }
      }

      if (needMicrophone) {
        const rawAudioTrack = rawMicrophoneTrackRef.current;
        const audioContext = ensureAudioContext();
        if (audioContext.state === "suspended") {
          await audioContext.resume().catch(() => {});
        }
        if (settings.enabled && settings.voiceMode === "synthetic") {
          const processor = new SpeechSynthesisAudioProcessor(profile, settings);
          await processor.init({ track: rawAudioTrack, audioContext });
          microphoneTrack = attachAnonymousResources(
            new LocalAudioTrack(processor.processedTrack, rawAudioTrack.getConstraints?.(), true, audioContext),
            { processor },
          );
        } else {
          microphoneTrack = attachAnonymousResources(
            new LocalAudioTrack(rawAudioTrack, rawAudioTrack.getConstraints?.(), true, audioContext),
            {},
          );
        }
      }

      return { cameraTrack, microphoneTrack };
    } catch (trackError) {
      await discardGeneratedTrack(cameraTrack);
      await discardGeneratedTrack(microphoneTrack);
      throw trackError;
    }
  }, [acquireRawTracks, ensureAudioContext, profile]);

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
    const { cameraTrack, microphoneTrack } = await createManagedTracks(
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
      } else if (cameraTrackRef.current) {
        await disposeTrack(room, cameraTrackRef.current, () => releaseRawTrack("video"));
        cameraTrackRef.current = null;
      }

      if (nextMicrophoneEnabled) {
        if (microphoneTrackRef.current && microphoneTrack) {
          microphoneTrackRef.current = await replacePublishedTrack(microphoneTrackRef.current, microphoneTrack);
        } else if (!microphoneTrackRef.current && microphoneTrack) {
          await room.localParticipant.publishTrack(microphoneTrack, { source: Track.Source.Microphone, name: publishedAudioTrackName(settings) });
          microphoneTrackRef.current = microphoneTrack;
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
  }, [createManagedTracks, releaseRawTrack, replacePublishedTrack, room]);

  const applyAnonymitySettings = useCallback(async (nextSettings) => {
    setBusy(true);
    setError("");
    try {
      const sanitized = sanitizeAnonymitySettings(nextSettings);
      if (role === "participant" && participantToken) {
        const statusRes = await updateAnonymousAudio(sessionCode, {
          enabled: sanitized.enabled,
          language_mode: sanitized.languageMode,
          preferred_language: sanitized.preferredLanguage,
          voice_template_id: sanitized.voiceTemplateId,
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
    sessionCode,
    t,
    t.videoAnonymousError,
  ]);

  const updateAnonymityField = useCallback((field, value) => {
    const nextSettings = sanitizeAnonymitySettings({
      ...anonymitySettings,
      [field]: value,
      enabled: field === "enabled" ? value : true,
    });
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
          await room.localParticipant.publishTrack(microphoneTrack, { source: Track.Source.Microphone, name: publishedAudioTrackName(anonymitySettings) });
          microphoneTrackRef.current = microphoneTrack;
          setMicrophoneEnabled(true);
        }
      }
    } catch (err) {
      console.error(err);
      setError(t.videoAnonymousError);
    } finally {
      setBusy(false);
    }
  }, [anonymitySettings, busy, createManagedTracks, microphoneEnabled, releaseRawTrack, room, t.videoAnonymousError]);

  useEffect(() => {
    if (connectionState !== ConnectionState.Connected || initializedRef.current) return;
    initializedRef.current = true;
    rebuildPublishedMedia(anonymitySettings, true, true).catch((err) => {
      console.error(err);
      setError(t.videoAnonymousError);
      setCameraEnabled(false);
      setMicrophoneEnabled(false);
    });
  }, [anonymitySettings, connectionState, rebuildPublishedMedia, t.videoAnonymousError]);

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
      if (!String(msg?.type || "").startsWith("anonymous_audio.")) return;
      const payload = msg.payload || {};
      setAnonymousAudioStatus((prev) => ({
        ...(prev || {}),
        ...payload,
        status_label: statusLabelFromState(payload.status, t),
      }));
    };
    return () => es.close();
  }, [sessionCode, t]);

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
      disposeTrack(room, microphoneTrackRef.current, () => releaseRawTrack("audio")),
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
      <aside className="video-room-sidebar">{anonymityPanel}</aside>
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
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [anonymitySettings, setAnonymitySettings] = useState(() => readAnonymitySettings(sessionCode, normalizedRole));
  const [voiceTemplates, setVoiceTemplates] = useState([]);
  const [captchaQuestion, setCaptchaQuestion] = useState("");
  const [captchaAnswer, setCaptchaAnswer] = useState("");
  const room = useMemo(() => new Room(), []);

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
        enabled: field === "enabled" ? value : true,
      });
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
      const res = await createVideoToken(sessionCode, { display_name: trimmedName, audio_mode: anonymitySettings.enabled ? "anonymous" : "normal" }, headers);
      localStorage.setItem(videoDisplayNameKey(sessionCode, normalizedRole), trimmedName);
      setAuthToken(res.token);
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
          />
        </LiveKitRoom>
      </div>
    </section>
  );
}
