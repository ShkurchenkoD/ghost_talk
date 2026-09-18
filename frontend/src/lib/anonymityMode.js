import { synthesizeSpeech, transcribeAudio } from "../api/client.js";

const VIDEO_FPS = 24;
const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 720;

const DEFAULT_ANONYMITY_SETTINGS = {
  enabled: false,
  audioMode: "normal",
  videoMode: "anonymous_mask",
  voiceMode: "synthetic",
  languageMode: "auto",
  preferredLanguage: "uk-UA",
  voiceTemplateId: "anonymous-neutral-01",
  fallbackMode: "mute",
  avatarId: "1",
};

const VIDEO_ANONYMITY_MODES = new Set(["off", "face_blur", "face_pixelation", "anonymous_mask"]);
const VOICE_ANONYMITY_MODES = new Set(["off", "synthetic"]);
const LANGUAGE_MODES = new Set(["auto", "manual"]);
const PREFERRED_LANGUAGES = new Set(["uk-UA", "en-US", "pl-PL", "ru-RU"]);
const AVATAR_IDS = new Set(Array.from({ length: 16 }, (_, index) => String(index + 1)));

const SYNTHETIC_RECORDING_MIME_TYPES = [
  { mimeType: "audio/webm;codecs=opus", extension: "webm" },
  { mimeType: "audio/webm", extension: "webm" },
  { mimeType: "audio/ogg;codecs=opus", extension: "ogg" },
];
const SYNTHETIC_VOICES_BY_LANG = {
  uk: ["uk_UA-lada-x_low"],
  en: ["en_US-lessac-medium", "en_US-amy-medium", "en_GB-alan-low"],
};
const SYNTHETIC_SPEECH_START_LEVEL = 0.14;
const SYNTHETIC_SILENCE_HOLD_MS = 900;
const SYNTHETIC_MIN_UTTERANCE_MS = 400;

// Each id maps to what the numbered PNG in /public actually depicts (verified
// visually) - the id-to-name pairing here does NOT follow numeric file order,
// since the original mapping had every name pointing at the wrong artwork.
export const AVATAR_OPTIONS = [
  { id: "1", name: "Glitch" },
  { id: "10", name: "Owl" },
  { id: "11", name: "Panda" },
  { id: "12", name: "Helmet" },
  { id: "7", name: "Shadow" },
  { id: "14", name: "Neon" },
  { id: "13", name: "Static" },
  { id: "16", name: "Pixel" },
  { id: "2", name: "Alien" },
  { id: "3", name: "Veil" },
  { id: "4", name: "Robot" },
  { id: "5", name: "Porcelain" },
  { id: "6", name: "Armor" },
  { id: "15", name: "Ghost" },
  { id: "8", name: "Cat" },
  { id: "9", name: "Fox" },
];

const PALETTES = [
  {
    background: ["#081f2f", "#163a5f"],
    accent: "#67e8f9",
    avatar: "#f8fafc",
    detail: "#38bdf8",
  },
  {
    background: ["#1f1632", "#4c1d95"],
    accent: "#f9a8d4",
    avatar: "#fdf2f8",
    detail: "#c084fc",
  },
  {
    background: ["#102418", "#166534"],
    accent: "#86efac",
    avatar: "#f0fdf4",
    detail: "#4ade80",
  },
  {
    background: ["#2b160d", "#9a3412"],
    accent: "#fdba74",
    avatar: "#fff7ed",
    detail: "#fb923c",
  },
];

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function hashString(input) {
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = ((hash << 5) - hash + input.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}

function roundedRect(ctx, x, y, width, height, radius) {
  const safeRadius = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + safeRadius, y);
  ctx.arcTo(x + width, y, x + width, y + height, safeRadius);
  ctx.arcTo(x + width, y + height, x, y + height, safeRadius);
  ctx.arcTo(x, y + height, x, y, safeRadius);
  ctx.arcTo(x, y, x + width, y, safeRadius);
  ctx.closePath();
}

function drawOrb(ctx, x, y, radius, color, alpha) {
  const gradient = ctx.createRadialGradient(x, y, radius * 0.12, x, y, radius);
  gradient.addColorStop(0, `${color}${Math.round(clamp(alpha, 0, 1) * 255).toString(16).padStart(2, "0")}`);
  gradient.addColorStop(1, `${color}00`);
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
}

export function buildAnonymousProfile(seed, role) {
  const hash = hashString(`${role}:${seed}`);
  const palette = PALETTES[hash % PALETTES.length];
  return {
    alias: role === "facilitator" ? "Masked Host" : `Masked Guest ${100 + (hash % 900)}`,
    palette,
    shapeSeed: hash % 7,
    motionOffset: (hash % 100) / 100,
    voiceColor: (hash % 5) - 2,
  };
}

function debugShow(text) {
  if (typeof localStorage === "undefined" || localStorage.getItem("ghosttalk_voice_debug") !== "1") return;
  console.log("[voice-debug]", text);
  if (typeof document === "undefined") return;
  let el = document.getElementById("__voice_debug_overlay");
  if (!el) {
    el = document.createElement("div");
    el.id = "__voice_debug_overlay";
    el.style.cssText = "position:fixed;bottom:0;left:0;right:0;max-height:45vh;overflow-y:auto;background:rgba(0,0,0,0.88);color:#0f0;font:11px monospace;padding:6px;z-index:2147483647;white-space:pre-wrap;pointer-events:none;";
    document.body.appendChild(el);
  }
  const line = document.createElement("div");
  line.textContent = `${new Date().toISOString().slice(11, 19)} ${text}`;
  el.appendChild(line);
  el.scrollTop = el.scrollHeight;
}

function getSpeechRecognitionCtor() {
  return (typeof window !== "undefined" && (window.SpeechRecognition || window.webkitSpeechRecognition)) || null;
}

function isAndroidChrome() {
  if (typeof navigator === "undefined") return false;
  const ua = String(navigator.userAgent || "");
  return /Android/i.test(ua) && /Chrome\//i.test(ua) && !/EdgA\//i.test(ua);
}

// Same locale resolution ParticipantPage's "Записати голос" card input uses,
// so voice quality in a call matches what users already see there.
function resolveSpeechLocale(settings) {
  const preferred = String(settings.preferredLanguage || "").trim();
  if (settings.languageMode === "manual" && PREFERRED_LANGUAGES.has(preferred)) return preferred;
  return currentSyntheticLang() === "en" ? "en-US" : "uk-UA";
}

function currentSyntheticLang() {
  const lang = (typeof localStorage !== "undefined" && localStorage.getItem("ghosttalk_lang")) || "uk";
  return SYNTHETIC_VOICES_BY_LANG[lang] ? lang : "uk";
}

function pickSyntheticVoice(profile, settings = DEFAULT_ANONYMITY_SETTINGS) {
  const preferred = String(settings.preferredLanguage || "").trim().toLowerCase().split("-")[0];
  const lang = SYNTHETIC_VOICES_BY_LANG[preferred] ? preferred : currentSyntheticLang();
  const pool = SYNTHETIC_VOICES_BY_LANG[lang] || SYNTHETIC_VOICES_BY_LANG.uk;
  if (String(settings.voiceTemplateId || "").includes("robot")) return "en_US-lessac-medium";
  if (String(settings.voiceTemplateId || "").includes("deep")) return "en_GB-alan-low";
  if (String(settings.voiceTemplateId || "").includes("light")) return "en_US-amy-medium";
  return pool[hashString(`voice:${profile.alias}`) % pool.length];
}

function pickSyntheticRecordingFormat() {
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") {
    return { mimeType: "", extension: "webm" };
  }
  return (
    SYNTHETIC_RECORDING_MIME_TYPES.find((candidate) => MediaRecorder.isTypeSupported(candidate.mimeType))
    || { mimeType: "", extension: "webm" }
  );
}

export function getDefaultAnonymitySettings() {
  return { ...DEFAULT_ANONYMITY_SETTINGS };
}

export function sanitizeAnonymitySettings(input) {
  const next = typeof input === "object" && input ? input : {};
  const videoMode = VIDEO_ANONYMITY_MODES.has(next.videoMode) ? next.videoMode : DEFAULT_ANONYMITY_SETTINGS.videoMode;
  const voiceMode = VOICE_ANONYMITY_MODES.has(next.voiceMode) ? next.voiceMode : DEFAULT_ANONYMITY_SETTINGS.voiceMode;
  const languageMode = LANGUAGE_MODES.has(next.languageMode) ? next.languageMode : DEFAULT_ANONYMITY_SETTINGS.languageMode;
  const preferredLanguage = PREFERRED_LANGUAGES.has(next.preferredLanguage) ? next.preferredLanguage : DEFAULT_ANONYMITY_SETTINGS.preferredLanguage;
  const avatarId = AVATAR_IDS.has(String(next.avatarId)) ? String(next.avatarId) : DEFAULT_ANONYMITY_SETTINGS.avatarId;
  const enabled = typeof next.enabled === "boolean" ? next.enabled : videoMode !== "off" || voiceMode !== "off";
  return {
    enabled,
    audioMode: enabled ? "anonymous" : "normal",
    videoMode,
    voiceMode,
    languageMode,
    preferredLanguage,
    voiceTemplateId: String(next.voiceTemplateId || DEFAULT_ANONYMITY_SETTINGS.voiceTemplateId),
    fallbackMode: "mute",
    avatarId,
  };
}

export class AnonymousVideoProcessor {
  constructor(profile, settings = DEFAULT_ANONYMITY_SETTINGS) {
    this.name = "ghosttalk-anonymous-video";
    this.profile = profile;
    this.settings = sanitizeAnonymitySettings(settings);
    this.processedTrack = undefined;
    this.canvas = undefined;
    this.ctx = undefined;
    this.frameHandle = 0;
    this.stream = undefined;
    this.startedAt = 0;
    this.video = undefined;
    this.faceDetector = undefined;
    this.lastDetectionAt = 0;
    this.pixelCanvas = undefined;
    this.pixelCtx = undefined;
    this.faceBox = undefined;
    this.avatarImage = undefined;
    this.avatarImageKey = "";
    this.audioContext = undefined;
    this.audioSource = undefined;
    this.audioAnalyser = undefined;
    this.audioData = undefined;
    this.voiceLevel = 0;
    this.voicePulse = 0;
    this.faceState = {
      x: 0.5,
      y: 0.42,
      scale: 1,
      roll: 0,
    };
  }

  async init(opts) {
    await this.restart(opts);
  }

  async restart(opts) {
    await this.destroy();
    const settings = opts.track.getSettings?.() || {};
    const width = settings.width || DEFAULT_WIDTH;
    const height = settings.height || DEFAULT_HEIGHT;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.startedAt = performance.now();
    this.stream = canvas.captureStream(VIDEO_FPS);
    this.processedTrack = this.stream.getVideoTracks()[0];
    this.video = document.createElement("video");
    this.video.autoplay = true;
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.srcObject = new MediaStream([opts.track]);
    await this.video.play().catch(() => {});
    this.connectAudioAnalyser(opts.audioTrack);
    await this.ensureAvatarImage();

    if (typeof window !== "undefined" && "FaceDetector" in window) {
      try {
        this.faceDetector = new window.FaceDetector({
          fastMode: true,
          maxDetectedFaces: 1,
        });
      } catch (_) {
        this.faceDetector = undefined;
      }
    }

    const draw = (now) => {
      if (!this.ctx || !this.canvas) return;
      this.updateFaceTracking(now).catch(() => {});
      this.renderFrame(now);
      this.frameHandle = window.requestAnimationFrame(draw);
    };

    this.frameHandle = window.requestAnimationFrame(draw);
  }

  renderFrame(now) {
    const { width, height } = this.canvas;
    const ctx = this.ctx;
    const mode = this.settings.videoMode;
    if (!this.video) return;

    ctx.clearRect(0, 0, width, height);

    if (mode === "face_blur") {
      this.renderBlurMask(ctx, width, height);
      return;
    }
    if (mode === "face_pixelation") {
      this.renderPixelMask(ctx, width, height);
      return;
    }
    if (mode !== "anonymous_mask") {
      ctx.drawImage(this.video, 0, 0, width, height);
      return;
    }

    const { avatar, detail } = this.profile.palette;
    const elapsed = (now - this.startedAt) / 1000;
    const pulse = 0.5 + Math.sin(elapsed * 1.8 + this.profile.motionOffset * Math.PI * 2) * 0.5;
    const voiceLevel = this.readVoiceLevel();

    const faceRect = this.getFaceRect(width, height, 1.35);
    if (!faceRect) return;
    const avatarCenterX = faceRect.x + faceRect.width / 2;
    const avatarCenterY = faceRect.y + faceRect.height / 2;
    const headRadius = Math.min(faceRect.width, faceRect.height) * 0.34;
    const bob = Math.sin(elapsed * 2.2) * (height * 0.006);
    const roll = this.faceState.roll;
    const zoom = 1 + voiceLevel * 0.04 + pulse * 0.015;
    const tilt = roll * 1.25;
    const driftX = Math.sin(elapsed * 1.1 + this.profile.motionOffset * Math.PI * 2) * width * 0.008;
    const driftY = bob * 2.1;

    if (this.avatarImage?.complete && this.avatarImage.naturalWidth > 0) {
      const imageAspect = this.avatarImage.naturalWidth / this.avatarImage.naturalHeight;
      const canvasAspect = width / height;
      const coverWidth = imageAspect > canvasAspect ? width : height * imageAspect;
      const coverHeight = imageAspect > canvasAspect ? width / imageAspect : height;
      const portraitWidth = coverWidth * (1 + voiceLevel * 0.035);
      const portraitHeight = coverHeight * (1 + voiceLevel * 0.035);
      const portraitX = (width - portraitWidth) / 2 + driftX;
      const portraitY = (height - portraitHeight) / 2 + driftY;

      ctx.save();
      ctx.translate(width / 2, height / 2 + bob);
      ctx.rotate(tilt);
      ctx.scale(zoom, zoom);
      ctx.translate(-(width / 2), -(height / 2 + bob));
      ctx.shadowColor = `${detail}99`;
      ctx.shadowBlur = 20 + voiceLevel * 18;
      ctx.drawImage(this.avatarImage, portraitX, portraitY, portraitWidth, portraitHeight);
      ctx.restore();
      return;
    }

    ctx.save();
    ctx.translate(avatarCenterX, avatarCenterY + bob);
    ctx.rotate(roll);
    ctx.translate(-avatarCenterX, -avatarCenterY);
    ctx.fillStyle = "rgba(6, 11, 25, 0.72)";
    roundedRect(
      ctx,
      avatarCenterX - faceRect.width * 0.42,
      avatarCenterY - faceRect.height * 0.5,
      faceRect.width * 0.84,
      faceRect.height,
      faceRect.width * 0.16,
    );
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.14)";
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = avatar;
    ctx.beginPath();
    ctx.arc(avatarCenterX, avatarCenterY - headRadius * 0.15, headRadius, 0, Math.PI * 2);
    ctx.fill();
    roundedRect(
      ctx,
      avatarCenterX - faceRect.width * 0.18,
      avatarCenterY + headRadius * 0.42,
      faceRect.width * 0.36,
      faceRect.height * 0.32,
      faceRect.width * 0.1,
    );
    ctx.fill();
    ctx.restore();
  }

  async ensureAvatarImage() {
    const nextKey = this.settings.avatarId || DEFAULT_ANONYMITY_SETTINGS.avatarId;
    if (this.avatarImageKey === nextKey && this.avatarImage?.complete) return;
    const image = new Image();
    image.decoding = "async";
    image.src = `/${nextKey}.png`;
    if (typeof image.decode === "function") {
      await image.decode().catch(() => {});
    }
    this.avatarImage = image;
    this.avatarImageKey = nextKey;
  }

  connectAudioAnalyser(audioTrack) {
    if (!audioTrack) return;
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) return;
    if (!this.audioContext) {
      this.audioContext = new AudioContextCtor();
    }
    if (this.audioContext.state === "suspended") {
      this.audioContext.resume().catch(() => {});
    }
    this.audioAnalyser = this.audioContext.createAnalyser();
    this.audioAnalyser.fftSize = 256;
    this.audioAnalyser.smoothingTimeConstant = 0.82;
    this.audioData = new Uint8Array(this.audioAnalyser.frequencyBinCount);
    this.audioSource = this.audioContext.createMediaStreamSource(new MediaStream([audioTrack]));
    this.audioSource.connect(this.audioAnalyser);
  }

  readVoiceLevel() {
    if (!this.audioAnalyser || !this.audioData) {
      this.voiceLevel += (0 - this.voiceLevel) * 0.2;
      return this.voiceLevel;
    }
    this.audioAnalyser.getByteFrequencyData(this.audioData);
    let sum = 0;
    for (let index = 0; index < this.audioData.length; index += 1) {
      sum += this.audioData[index];
    }
    const average = sum / (this.audioData.length * 255);
    const boosted = clamp((average - 0.05) * 3.2, 0, 1);
    this.voicePulse = Math.max(boosted, this.voicePulse * 0.82);
    this.voiceLevel += (this.voicePulse - this.voiceLevel) * 0.28;
    return this.voiceLevel;
  }

  renderBlurMask(ctx, width, height) {
    ctx.save();
    ctx.filter = "blur(18px)";
    ctx.drawImage(this.video, 0, 0, width, height);
    ctx.restore();
  }

  renderPixelMask(ctx, width, height) {
    const pixelWidth = Math.max(16, Math.round(width / 24));
    const pixelHeight = Math.max(12, Math.round(height / 24));
    if (!this.pixelCanvas) {
      this.pixelCanvas = document.createElement("canvas");
      this.pixelCtx = this.pixelCanvas.getContext("2d");
    }
    this.pixelCanvas.width = pixelWidth;
    this.pixelCanvas.height = pixelHeight;
    this.pixelCtx.imageSmoothingEnabled = false;
    this.pixelCtx.clearRect(0, 0, pixelWidth, pixelHeight);
    this.pixelCtx.drawImage(this.video, 0, 0, width, height, 0, 0, pixelWidth, pixelHeight);

    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.pixelCanvas, 0, 0, pixelWidth, pixelHeight, 0, 0, width, height);
    ctx.restore();
  }

  getFaceRect(width, height, scaleMultiplier = 1) {
    if (this.faceBox) {
      const expandedWidth = this.faceBox.width * scaleMultiplier;
      const expandedHeight = this.faceBox.height * scaleMultiplier * 1.15;
      return {
        x: clamp(this.faceBox.x + this.faceBox.width / 2 - expandedWidth / 2, 0, width - expandedWidth),
        y: clamp(this.faceBox.y + this.faceBox.height / 2 - expandedHeight / 2, 0, height - expandedHeight),
        width: clamp(expandedWidth, 40, width),
        height: clamp(expandedHeight, 48, height),
      };
    }

    const estimatedWidth = width * 0.18 * this.faceState.scale * scaleMultiplier;
    const estimatedHeight = height * 0.22 * this.faceState.scale * scaleMultiplier;
    return {
      x: clamp(width * this.faceState.x - estimatedWidth / 2, 0, width - estimatedWidth),
      y: clamp(height * this.faceState.y - estimatedHeight / 2, 0, height - estimatedHeight),
      width: estimatedWidth,
      height: estimatedHeight,
    };
  }

  async destroy() {
    if (this.frameHandle) {
      window.cancelAnimationFrame(this.frameHandle);
      this.frameHandle = 0;
    }
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = undefined;
    }
    if (this.video) {
      this.video.pause?.();
      this.video.srcObject = null;
      this.video = undefined;
    }
    this.faceDetector = undefined;
    this.faceBox = undefined;
    this.pixelCanvas = undefined;
    this.pixelCtx = undefined;
    this.processedTrack = undefined;
    this.canvas = undefined;
    this.ctx = undefined;
    if (this.audioSource) {
      try {
        this.audioSource.disconnect();
      } catch (_) {
        // Ignore audio graph teardown races.
      }
      this.audioSource = undefined;
    }
    if (this.audioAnalyser) {
      try {
        this.audioAnalyser.disconnect();
      } catch (_) {
        // Ignore audio graph teardown races.
      }
      this.audioAnalyser = undefined;
    }
    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
      this.audioContext = undefined;
    }
    this.audioData = undefined;
    this.avatarImage = undefined;
    this.avatarImageKey = "";
    this.voiceLevel = 0;
    this.voicePulse = 0;
  }

  async updateFaceTracking(now) {
    if (!this.faceDetector || !this.video || this.video.readyState < 2) return;
    if (now - this.lastDetectionAt < 120) return;
    this.lastDetectionAt = now;

    const faces = await this.faceDetector.detect(this.video);
    const face = faces?.[0];
    if (!face?.boundingBox || !this.canvas) return;

    const width = this.canvas.width;
    const height = this.canvas.height;
    const box = face.boundingBox;
    this.faceBox = {
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
    };
    const targetX = clamp((box.x + box.width / 2) / width, 0.3, 0.7);
    const targetY = clamp((box.y + box.height / 2) / height + 0.02, 0.28, 0.58);
    const targetScale = clamp(box.width / (width * 0.16), 0.82, 1.22);
    const targetRoll = this.estimateRoll(face.landmarks || []);

    this.faceState = {
      x: this.faceState.x + (targetX - this.faceState.x) * 0.28,
      y: this.faceState.y + (targetY - this.faceState.y) * 0.28,
      scale: this.faceState.scale + (targetScale - this.faceState.scale) * 0.22,
      roll: this.faceState.roll + (targetRoll - this.faceState.roll) * 0.3,
    };
  }

  estimateRoll(landmarks) {
    const leftEye = landmarks.find((point) => point.type === "eye" || point.type === "leftEye");
    const rightEye = landmarks.find((point) => point.type === "rightEye");
    if (!leftEye || !rightEye) return 0;
    return clamp(
      Math.atan2(rightEye.y - leftEye.y, rightEye.x - leftEye.x),
      -0.35,
      0.35,
    );
  }
}

// Strongest anonymity mode: recognizes speech (STT) and replaces the outgoing
// audio entirely with synthesized speech (TTS) in a fixed anonymous voice, so
// no part of the original waveform (and its voice biometrics) ever leaves the
// browser. Trades real-time responsiveness for that guarantee: each utterance
// only reaches the other participants after STT+TTS round-trips complete.
export class SpeechSynthesisAudioProcessor {
  constructor(profile, settings = DEFAULT_ANONYMITY_SETTINGS) {
    this.name = "ghosttalk-speech-synthesis-audio";
    this.profile = profile;
    this.settings = sanitizeAnonymitySettings(settings);
    this.processedTrack = undefined;
    this.destroyed = false;

    this.audioContext = undefined;
    this.destination = undefined;
    this.analyserSource = undefined;
    this.analyser = undefined;
    this.analyserData = undefined;
    this.vadHandle = 0;

    this.rawStream = undefined;
    this.recorder = undefined;
    this.recordedChunks = [];
    this.speaking = false;
    this.silenceStartedAt = 0;
    this.speechStartedAt = 0;

    this.recognition = undefined;
    this.usingNativeRecognition = false;
    this.recognitionRestartTimer = 0;
    this.nativeWatchdogTimer = 0;
    this.gotNativeResult = false;

    this.playQueue = Promise.resolve();
    this.activeSource = undefined;
    this.voiceId = pickSyntheticVoice(profile, this.settings);
  }

  async init(opts) {
    await this.restart(opts);
  }

  async restart(opts) {
    await this.destroy();
    this.destroyed = false;

    const audioContext = opts.audioContext;
    if (audioContext.state === "suspended") {
      await audioContext.resume().catch(() => {});
    }
    this.audioContext = audioContext;
    this.destination = audioContext.createMediaStreamDestination();
    this.processedTrack = this.destination.stream.getAudioTracks()[0];

    // A MediaStreamAudioDestinationNode only stays "unmuted" for WebRTC while
    // something is continuously connected to it. Utterance playback connects
    // an AudioBufferSourceNode only for the duration of each clip, so between
    // utterances (or before the first one) the destination would otherwise sit
    // with nothing feeding it — Chrome then reports the outgoing track as
    // muted and remote participants receive total silence, even though the
    // STT/TTS pipeline itself is working. Keep a permanent, silent source
    // connected so the track always has live (if silent) data flowing.
    this.keepAlive = audioContext.createConstantSource();
    this.keepAlive.offset.value = 0;
    this.keepAlive.connect(this.destination);
    this.keepAlive.start();

    this.rawStream = new MediaStream([opts.track]);

    // Prefer the browser's native Web Speech API — the same STT ParticipantPage's
    // "Записати голос" card input already uses, which recognizes speech far more
    // accurately than the server-side whisper-small fallback below. It can't take
    // our specific track as input (browsers only let it listen to the default
    // input device), but that's the same device the raw mic track already comes
    // from, so this works the same way it does for card input.
    const __locale = resolveSpeechLocale(this.settings);
    const nativeSpeechAllowed = !isAndroidChrome();
    debugShow(`locale=${__locale} ctor=${Boolean(getSpeechRecognitionCtor())} nativeAllowed=${nativeSpeechAllowed}`);
    this.usingNativeRecognition = nativeSpeechAllowed ? this.startNativeRecognition(__locale) : false;
    debugShow(`usingNativeRecognition=${this.usingNativeRecognition}`);
    if (this.usingNativeRecognition) {
      // Some mobile browsers (notably Android Chrome) run continuous
      // recognition while the mic is simultaneously captured for the call's
      // raw audio track and never produce a single result - it just cycles
      // start/end every few seconds with no error and no transcript. Rather
      // than sit silently broken for the whole call, demote to the
      // whisper-based fallback if nothing has been recognized in time.
      this.gotNativeResult = false;
      this.nativeWatchdogTimer = window.setTimeout(() => {
        if (this.destroyed || this.gotNativeResult || !this.usingNativeRecognition) return;
        console.warn("[anonymity] native speech recognition produced no results in time, falling back to server-side transcription");
        debugShow("native recognition idle too long -> falling back to whisper");
        this.demoteToFallbackVad();
      }, 12000);
      return;
    }

    this.startFallbackVad();
  }

  startFallbackVad() {
    this.analyserSource = this.audioContext.createMediaStreamSource(this.rawStream);
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 512;
    this.analyser.smoothingTimeConstant = 0.75;
    this.analyserData = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyserSource.connect(this.analyser);

    const tick = () => {
      if (this.destroyed) return;
      this.evaluateVoiceActivity();
      this.vadHandle = window.requestAnimationFrame(tick);
    };
    this.vadHandle = window.requestAnimationFrame(tick);
  }

  demoteToFallbackVad() {
    if (this.recognitionRestartTimer) {
      window.clearTimeout(this.recognitionRestartTimer);
      this.recognitionRestartTimer = 0;
    }
    if (this.recognition) {
      const recognition = this.recognition;
      this.recognition = undefined;
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      recognition.onstart = null;
      recognition.onaudiostart = null;
      recognition.onspeechstart = null;
      try {
        recognition.stop();
      } catch (_) {
        // Recognition may already be inactive.
      }
    }
    this.usingNativeRecognition = false;
    this.startFallbackVad();
  }

  startNativeRecognition(locale) {
    const SpeechRecognitionCtor = getSpeechRecognitionCtor();
    if (!SpeechRecognitionCtor) return false;

    const recognition = new SpeechRecognitionCtor();
    recognition.lang = locale;
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event) => {
      this.gotNativeResult = true;
      debugShow(`onresult len=${event.results.length} idx=${event.resultIndex}`);
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        debugShow(`result[${index}] final=${result.isFinal} text="${result[0]?.transcript}"`);
        if (!result.isFinal) continue;
        const transcript = result[0]?.transcript?.trim();
        if (transcript) this.enqueueUtteranceText(transcript);
      }
    };
    recognition.onerror = (event) => {
      debugShow(`onerror ${event?.error}`);
      if (event?.error === "no-speech" || event?.error === "aborted") return;
      console.warn("[anonymity] speech recognition error", event?.error);
    };
    recognition.onend = () => {
      debugShow(`onend destroyed=${this.destroyed} current=${this.recognition === recognition}`);
      // Continuous recognition sessions can still end on their own (silence
      // timeout, transient network hiccup) - restart transparently so the mic
      // keeps listening for the whole call, unless we tore it down ourselves.
      if (this.destroyed || this.recognition !== recognition) return;
      try {
        recognition.start();
      } catch (_) {
        this.recognitionRestartTimer = window.setTimeout(() => {
          if (!this.destroyed && this.recognition === recognition) {
            try { recognition.start(); } catch (__) { /* give up until next end/error */ }
          }
        }, 300);
      }
    };
    recognition.onstart = () => debugShow("onstart fired");
    recognition.onaudiostart = () => debugShow("onaudiostart fired");
    recognition.onspeechstart = () => debugShow("onspeechstart fired");

    try {
      recognition.start();
    } catch (err) {
      debugShow(`recognition.start() threw ${err?.message}`);
      return false;
    }
    this.recognition = recognition;
    return true;
  }

  enqueueUtteranceText(text) {
    this.playQueue = this.playQueue
      .then(() => this.processUtteranceText(text))
      .catch(() => {});
  }

  async processUtteranceText(text) {
    debugShow(`processUtteranceText text="${text}"`);
    if (this.destroyed || !text) return;
    const audioData = await synthesizeSpeech(text, this.voiceId).catch((err) => {
      console.warn("[anonymity] synthesis failed", err);
      debugShow(`synthesis failed ${err?.message}`);
      return null;
    });
    if (this.destroyed || !audioData) return;
    debugShow(`synthesized ${audioData.byteLength || audioData.length} bytes`);

    const audioBuffer = await this.audioContext.decodeAudioData(audioData).catch((err) => {
      console.warn("[anonymity] decode failed", err);
      debugShow(`decode failed ${err?.message}`);
      return null;
    });
    if (this.destroyed || !audioBuffer) return;
    debugShow(`decoded, playing ${audioBuffer.duration.toFixed(2)}s`);

    await this.playBuffer(audioBuffer);
  }

  evaluateVoiceActivity() {
    this.analyser.getByteFrequencyData(this.analyserData);
    let sum = 0;
    for (let index = 0; index < this.analyserData.length; index += 1) {
      sum += this.analyserData[index];
    }
    const average = sum / (this.analyserData.length * 255);
    // Raw analyser averages sit well below 1.0 for normal speech volume; boost
    // the same way AnonymousVideoProcessor.readVoiceLevel() does so the VAD
    // threshold actually triggers on a typical mic gain.
    const level = clamp((average - 0.05) * 3.2, 0, 1);
    const now = performance.now();

    this.__vadDebugTick = (this.__vadDebugTick || 0) + 1;
    if (this.__vadDebugTick % 60 === 0) {
      debugShow(`vad level=${level.toFixed(2)} speaking=${this.speaking}`);
    }

    if (level >= SYNTHETIC_SPEECH_START_LEVEL) {
      this.silenceStartedAt = 0;
      if (!this.speaking) {
        debugShow(`vad startUtterance level=${level.toFixed(2)}`);
        this.startUtterance(now);
      }
      return;
    }

    if (!this.speaking) return;
    if (!this.silenceStartedAt) {
      this.silenceStartedAt = now;
      return;
    }
    if (now - this.silenceStartedAt >= SYNTHETIC_SILENCE_HOLD_MS) {
      this.endUtterance(now);
    }
  }

  startUtterance(now) {
    if (typeof MediaRecorder === "undefined") return;
    const { mimeType, extension } = pickSyntheticRecordingFormat();
    try {
      this.recorder = mimeType ? new MediaRecorder(this.rawStream, { mimeType }) : new MediaRecorder(this.rawStream);
    } catch (_) {
      this.recorder = undefined;
      return;
    }
    this.recordedChunks = [];
    this.recordingExtension = extension;
    this.recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) this.recordedChunks.push(event.data);
    };
    this.recorder.start();
    this.speaking = true;
    this.speechStartedAt = now;
  }

  endUtterance(now) {
    const recorder = this.recorder;
    this.recorder = undefined;
    this.speaking = false;
    this.silenceStartedAt = 0;
    if (!recorder) return;

    const tooShort = now - this.speechStartedAt < SYNTHETIC_MIN_UTTERANCE_MS;
    const chunks = this.recordedChunks;
    const mimeType = recorder.mimeType || "audio/webm";
    const extension = this.recordingExtension || "webm";
    // Note: this.recordedChunks is intentionally left as-is here — `ondataavailable`
    // (still wired from startUtterance) fires on stop() and pushes the final blob
    // into it before `onstop` runs below. Reassigning it here would orphan that
    // push into a stale `chunks` reference, leaving `chunks` permanently empty.
    // startUtterance() resets it fresh when the next utterance begins.

    recorder.onstop = () => {
      debugShow(`endUtterance tooShort=${tooShort} chunks=${chunks.length}`);
      if (tooShort || this.destroyed || chunks.length === 0) return;
      const blob = new Blob(chunks, { type: mimeType });
      this.enqueueUtterance(blob, extension);
    };
    try {
      recorder.stop();
    } catch (_) {
      // Recorder may already be inactive.
    }
  }

  enqueueUtterance(blob, extension) {
    this.playQueue = this.playQueue
      .then(() => this.processUtterance(blob, extension))
      .catch(() => {});
  }

  async processUtterance(blob, extension) {
    debugShow(`processUtterance blob size=${blob.size}`);
    if (this.destroyed) return;
    const lang = String(this.settings.preferredLanguage || "").trim().toLowerCase().split("-")[0] || currentSyntheticLang();
    debugShow(`transcribe start lang=${lang} ext=${extension} mime=${blob.type || "unknown"}`);
    const text = await transcribeAudio(blob, lang, `utterance.${extension}`).catch((err) => {
      console.warn("[anonymity] transcription failed", err);
      debugShow(`transcription failed ${err?.message}`);
      return "";
    });
    debugShow(`transcribed text="${text}"`);
    if (this.destroyed) return;
    if (!text || !text.trim()) {
      debugShow("transcribed text empty");
      return;
    }

    debugShow(`synthesize start voice=${this.voiceId}`);
    const audioData = await synthesizeSpeech(text.trim(), this.voiceId).catch((err) => {
      console.warn("[anonymity] synthesis failed", err);
      debugShow(`synthesis failed ${err?.message}`);
      return null;
    });
    if (this.destroyed || !audioData) return;
    debugShow(`synthesized ${audioData.byteLength || audioData.length} bytes`);

    const audioBuffer = await this.audioContext.decodeAudioData(audioData).catch((err) => {
      console.warn("[anonymity] decode failed", err);
      debugShow(`decode failed ${err?.message}`);
      return null;
    });
    if (this.destroyed || !audioBuffer) return;
    debugShow(`decoded, playing ${audioBuffer.duration.toFixed(2)}s`);

    await this.playBuffer(audioBuffer);
  }

  playBuffer(audioBuffer) {
    return new Promise((resolve) => {
      if (this.destroyed || !this.audioContext || !this.destination) {
        resolve();
        return;
      }
      const source = this.audioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(this.destination);
      source.onended = () => {
        if (this.activeSource === source) this.activeSource = undefined;
        resolve();
      };
      this.activeSource = source;
      source.start();
    });
  }

  async destroy() {
    this.destroyed = true;

    if (this.vadHandle) {
      window.cancelAnimationFrame(this.vadHandle);
      this.vadHandle = 0;
    }

    if (this.recognitionRestartTimer) {
      window.clearTimeout(this.recognitionRestartTimer);
      this.recognitionRestartTimer = 0;
    }
    if (this.nativeWatchdogTimer) {
      window.clearTimeout(this.nativeWatchdogTimer);
      this.nativeWatchdogTimer = 0;
    }
    if (this.recognition) {
      const recognition = this.recognition;
      this.recognition = undefined;
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      try {
        recognition.stop();
      } catch (_) {
        // Recognition may already be inactive.
      }
    }
    this.usingNativeRecognition = false;

    if (this.recorder) {
      this.recorder.onstop = null;
      try {
        this.recorder.stop();
      } catch (_) {
        // Recorder may already be inactive.
      }
      this.recorder = undefined;
    }
    this.recordedChunks = [];
    this.speaking = false;

    if (this.activeSource) {
      try {
        this.activeSource.stop();
      } catch (_) {
        // Source may already have finished.
      }
      this.activeSource = undefined;
    }

    if (this.keepAlive) {
      try {
        this.keepAlive.stop();
      } catch (_) {
        // Source may already have finished.
      }
      this.keepAlive = undefined;
    }

    if (this.analyserSource) {
      try {
        this.analyserSource.disconnect();
      } catch (_) {
        // Ignore audio graph teardown races.
      }
      this.analyserSource = undefined;
    }
    if (this.analyser) {
      try {
        this.analyser.disconnect();
      } catch (_) {
        // Ignore audio graph teardown races.
      }
      this.analyser = undefined;
    }
    this.analyserData = undefined;
    this.rawStream = undefined;

    if (this.destination) {
      this.destination.stream.getTracks().forEach((track) => track.stop());
      this.destination = undefined;
    }
    this.processedTrack = undefined;
    this.audioContext = undefined;
  }
}
