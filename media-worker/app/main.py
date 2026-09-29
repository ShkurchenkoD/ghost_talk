"""Consent-gated LiveKit audio worker for single/dual room topologies."""
import asyncio
import audioop
import io
import json
import os
import time
import wave
from dataclasses import dataclass
from urllib import request

import jwt
from fastapi import FastAPI
from livekit import rtc

from app.audio import mask_pcm_mono_48k

BACKEND = os.getenv("BACKEND_URL", "http://backend:8080").rstrip("/")
SECRET = os.getenv("INTERNAL_WORKER_TOKEN", "").strip()
LK_URL, LK_KEY, LK_SECRET = (os.getenv("LIVEKIT_URL", "").strip(), os.getenv("LIVEKIT_API_KEY", "").strip(), os.getenv("LIVEKIT_API_SECRET", "").strip())
TOPOLOGY = os.getenv("MEDIA_TOPOLOGY", "single").strip().lower()
POLL, SILENCE_MS, MAX_MS, ENERGY = 5, 900, 12000, 250
SEGMENT_KEY_WINDOW_MS = 500


@dataclass(frozen=True)
class Item:
    code: str
    room: str
    input_room: str
    public_room: str
    participant_id: int
    token: str
    language: str
    audio_mode: str
    voice_id: str
    session_started_at_ms: int


def api(method, path, payload=None):
    body = json.dumps(payload).encode() if payload is not None else None
    req = request.Request(BACKEND + path, method=method, data=body, headers={"Content-Type": "application/json", "X-Internal-Worker-Token": SECRET})
    with request.urlopen(req, timeout=60) as response:
        raw = response.read()
        return json.loads(raw) if raw else {}


def jwt_for(room, can_publish=False):
    now = int(time.time())
    claims = {"iss": LK_KEY, "sub": f"media-worker-{room}", "nbf": now - 60, "exp": now + 3600,
              "video": {"room": room, "roomJoin": True, "canPublish": can_publish, "canSubscribe": True}}
    return jwt.encode(claims, LK_SECRET, algorithm="HS256")


def multipart(boundary, audio, language):
    return b"".join([f"--{boundary}\r\nContent-Disposition: form-data; name=\"language\"\r\n\r\n{language}\r\n".encode(), f"--{boundary}\r\nContent-Disposition: form-data; name=\"audio\"; filename=\"segment.wav\"\r\nContent-Type: audio/wav\r\n\r\n".encode(), audio, f"\r\n--{boundary}--\r\n".encode()])


def transcribe(audio, language):
    boundary = "ghosttalk-media-worker"
    req = request.Request(BACKEND + "/api/internal/transcribe", method="POST", data=multipart(boundary, audio, language), headers={"Content-Type": f"multipart/form-data; boundary={boundary}", "X-Internal-Worker-Token": SECRET})
    with request.urlopen(req, timeout=60) as response:
        return json.loads(response.read()).get("text", "").strip()


def synthesize(text, voice):
    req = request.Request(BACKEND + "/api/internal/synthesize", method="POST", data=json.dumps({"text": text, "voice": voice or ""}).encode(), headers={"Content-Type": "application/json", "X-Internal-Worker-Token": SECRET})
    with request.urlopen(req, timeout=60) as response:
        return response.read()


class Worker:
    def __init__(self):
        self.items, self.rooms, self.public_rooms, self.tasks, self.track_tasks = {}, {}, {}, set(), {}
        self.output_tracks = {}
        self.masked_ready = set()
        self.last_success_at = 0.0
        self.metrics = {"media_worker_active_participants": 0, "media_worker_active_streams": 0, "media_worker_segments_total": 0, "media_worker_errors_total": 0, "media_worker_cancelled_tracks_total": 0, "media_worker_stt_requests_total": 0, "media_worker_stt_errors_total": 0, "media_worker_stt_latency_ms_last": 0, "media_worker_stt_latency_ms_total": 0, "media_worker_tts_requests_total": 0, "media_worker_tts_errors_total": 0}
        self.last_error = ""

    async def refresh(self):
        data = await asyncio.to_thread(api, "GET", "/api/internal/transcript-work-items")
        next_items = {}
        for x in data.get("items", []):
            input_room = x.get("input_room") or x["room"]
            key = (input_room if TOPOLOGY == "dual" else x["room"], int(x["participant_id"]))
            next_items[key] = Item(x["session_code"], x["room"], input_room, x.get("public_room") or x["room"], int(x["participant_id"]), x["participant_token"], x.get("preferred_language") or "uk-UA", x.get("audio_mode") or "normal", x.get("voice_id") or "", int(x["session_started_at_ms"]))
        for key in set(self.items) - set(next_items):
            task = self.track_tasks.pop(key, None)
            if task and not task.done():
                task.cancel()
                self.metrics["media_worker_cancelled_tracks_total"] += 1
        self.masked_ready.intersection_update({(item.code, item.participant_id) for item in next_items.values() if item.audio_mode == "masked"})
        self.items = next_items
        self.metrics["media_worker_active_participants"] = len(self.items)
        await self.cleanup_output_tracks(next_items)
        active_rooms = {x.input_room if TOPOLOGY == "dual" else x.room for x in self.items.values()}
        for room_name in list(self.rooms):
            if room_name not in active_rooms:
                try:
                    await self.rooms.pop(room_name).disconnect()
                except Exception:
                    self.metrics["media_worker_errors_total"] += 1
        for room_name in active_rooms - self.rooms.keys():
            await self.connect_input(room_name)
        if TOPOLOGY == "dual":
            public_rooms = {x.public_room for x in self.items.values() if x.audio_mode in ("anonymous", "masked")}
            for room_name in list(self.public_rooms):
                if room_name not in public_rooms:
                    try:
                        await self.public_rooms.pop(room_name).disconnect()
                    except Exception:
                        self.metrics["media_worker_errors_total"] += 1
            for room_name in public_rooms - self.public_rooms.keys():
                await self.connect_public(room_name)
            for item in next_items.values():
                ready_key = (item.code, item.participant_id)
                if item.audio_mode == "masked" and item.public_room in self.public_rooms and ready_key not in self.masked_ready:
                    if await self.report_masked_ready(item):
                        self.masked_ready.add(ready_key)

    async def cleanup_output_tracks(self, items):
        """Unpublish processed audio as soon as consent/work-item disappears."""
        active_keys = set()
        if TOPOLOGY == "dual":
            for item in items.values():
                if item.audio_mode == "anonymous":
                    active_keys.add((item.public_room, item.participant_id))
                elif item.audio_mode == "masked":
                    active_keys.add((item.public_room, item.participant_id, "masked"))
        for key, output in list(self.output_tracks.items()):
            if key in active_keys:
                continue
            self.output_tracks.pop(key, None)
            room = self.public_rooms.get(key[0])
            if not room:
                continue
            _, track = output
            try:
                sid = getattr(track, "sid", None)
                if sid:
                    await room.local_participant.unpublish_track(sid)
            except Exception:
                self.metrics["media_worker_errors_total"] += 1

    async def report_masked_ready(self, item):
        """Expose the media-worker readiness in the participant status card."""
        try:
            await asyncio.to_thread(api, "POST", "/api/internal/anonymous-audio/runtime", {
                "session_code": item.code,
                "participant_token": item.token,
                "status": "ready",
                "worker_ready": True,
                "worker_connected": True,
            })
        except Exception:
            # A participant can revoke settings between refresh and this call;
            # that is not a media-stream failure and will be reconciled next
            # refresh.
            return False
        return True

    async def connect_input(self, name):
        room = rtc.Room()
        room.on("track_subscribed", lambda track, publication, participant: self.track(track, publication.sid, participant.identity, name))
        await room.connect(LK_URL, jwt_for(name))
        self.rooms[name] = room

    async def connect_public(self, name):
        room = rtc.Room()
        await room.connect(LK_URL, jwt_for(name, can_publish=True))
        self.public_rooms[name] = room

    def track(self, track, track_sid, identity, room):
        if track.kind != rtc.TrackKind.KIND_AUDIO or not identity.startswith("participant-"):
            return
        try:
            item = self.items.get((room, int(identity.removeprefix("participant-"))))
        except ValueError:
            return
        if not item:
            return
        key = (room, item.participant_id)
        previous = self.track_tasks.get(key)
        if previous and not previous.done():
            previous.cancel()
        task = asyncio.create_task(self.consume(track, item, key, str(track_sid or "")))
        self.tasks.add(task)
        self.track_tasks[key] = task
        self.metrics["media_worker_active_streams"] = len(self.track_tasks)

        def done(completed):
            self.tasks.discard(completed)
            if self.track_tasks.get(key) is completed:
                self.track_tasks.pop(key, None)
            self.metrics["media_worker_active_streams"] = len(self.track_tasks)
        task.add_done_callback(done)

    async def consume(self, track, item, key, track_sid):
        frames, started, voiced, rate, channels = bytearray(), 0.0, 0.0, 48000, 1
        try:
            async for event in rtc.AudioStream(track):
                frame, now = event.frame, time.monotonic()
                rate, channels, chunk = frame.sample_rate, frame.num_channels, bytes(frame.data)
                if TOPOLOGY == "dual" and item.audio_mode == "masked":
                    await self.publish_masked_frame(item, chunk, rate, channels)
                if audioop.rms(chunk, 2) >= ENERGY:
                    if not frames:
                        started = now
                    voiced = now
                if frames or voiced:
                    frames.extend(chunk)
                if frames and ((now - voiced) * 1000 >= SILENCE_MS or (now - started) * 1000 >= MAX_MS):
                    if self.items.get(key) == item:
                        await self.finalize(item, track_sid, bytes(frames), rate, channels, started, now)
                    frames.clear(); voiced = 0
        except asyncio.CancelledError:
            frames.clear(); raise
        except Exception as exc:
            self.metrics["media_worker_errors_total"] += 1; self.last_error = type(exc).__name__
        else:
            if frames and self.items.get(key) == item:
                await self.finalize(item, track_sid, bytes(frames), rate, channels, started, time.monotonic())
        finally:
            frames.clear()

    async def finalize(self, item, track_sid, pcm, rate, channels, started, ended):
        stream = io.BytesIO()
        with wave.open(stream, "wb") as output:
            output.setnchannels(channels); output.setsampwidth(2); output.setframerate(rate); output.writeframes(pcm)
        self.metrics["media_worker_stt_requests_total"] += 1
        stt_started = time.monotonic()
        try:
            text = await asyncio.to_thread(transcribe, stream.getvalue(), item.language.split("-")[0])
        except Exception:
            self.metrics["media_worker_stt_errors_total"] += 1; raise
        finally:
            latency_ms = max(0, int((time.monotonic() - stt_started) * 1000)); self.metrics["media_worker_stt_latency_ms_last"] = latency_ms; self.metrics["media_worker_stt_latency_ms_total"] += latency_ms
        if not text:
            return
        duration_ms = max(0, int((ended - started) * 1000)); ended_at_ms = max(0, int(time.time() * 1000) - item.session_started_at_ms); started_at_ms = max(0, ended_at_ms - duration_ms)
        segment_owner = track_sid or str(item.participant_id); start_bucket = started_at_ms // SEGMENT_KEY_WINDOW_MS
        result = await asyncio.to_thread(api, "POST", "/api/internal/transcript-segments", {"session_code": item.code, "participant_token": item.token, "segment_key": f"{segment_owner}-{start_bucket}", "track_sid": track_sid, "started_at_ms": started_at_ms, "ended_at_ms": ended_at_ms, "text": text, "language": item.language.split("-")[0], "confidence": 0, "redacted": False})
        if TOPOLOGY == "dual" and item.audio_mode == "anonymous":
            redacted_text = ((result.get("segment") or {}).get("text") or "").strip()
            if redacted_text:
                await self.publish_processed(item, redacted_text)
        self.metrics["media_worker_segments_total"] += 1

    async def publish_processed(self, item, text):
        room = self.public_rooms.get(item.public_room)
        if not room:
            await self.connect_public(item.public_room); room = self.public_rooms.get(item.public_room)
        if not room:
            return
        key = (item.public_room, item.participant_id); output = self.output_tracks.get(key)
        if not output:
            source = rtc.AudioSource(22050, 1, queue_size_ms=2000)
            track = rtc.LocalAudioTrack.create_audio_track(f"anonymous-audio-{item.participant_id}", source)
            options = rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_MICROPHONE)
            await room.local_participant.publish_track(track, options); output = (source, track); self.output_tracks[key] = output
        source, _ = output; self.metrics["media_worker_tts_requests_total"] += 1
        try:
            wav_bytes = await asyncio.to_thread(synthesize, text, item.voice_id)
            with wave.open(io.BytesIO(wav_bytes), "rb") as wav_file:
                rate, channels, width = wav_file.getframerate(), wav_file.getnchannels(), wav_file.getsampwidth(); pcm = wav_file.readframes(wav_file.getnframes())
            if width != 2: pcm = audioop.lin2lin(pcm, width, 2)
            if channels != 1: pcm = audioop.tomono(pcm, 2, 0.5, 0.5)
            if rate != 22050: pcm, _ = audioop.ratecv(pcm, 2, 1, rate, 22050, None)
            frame_samples = 480
            for offset in range(0, len(pcm), frame_samples * 2):
                chunk = pcm[offset:offset + frame_samples * 2]
                if len(chunk) < frame_samples * 2: chunk += b"\x00" * (frame_samples * 2 - len(chunk))
                await source.capture_frame(rtc.AudioFrame(chunk, 22050, 1, frame_samples))
        except Exception:
            self.metrics["media_worker_tts_errors_total"] += 1; raise

    async def publish_masked_frame(self, item, pcm, rate, channels):
        """Apply a low-latency timbre mask before publishing to public room.

        This is intentionally not advertised as biometric-grade anonymity;
        synthetic mode remains the recommended mode for sensitive sessions.
        """
        room = self.public_rooms.get(item.public_room)
        if not room:
            await self.connect_public(item.public_room)
            room = self.public_rooms.get(item.public_room)
        if not room:
            return
        key = (item.public_room, item.participant_id, "masked")
        output = self.output_tracks.get(key)
        if not output:
            source = rtc.AudioSource(48000, 1, queue_size_ms=1000)
            track = rtc.LocalAudioTrack.create_audio_track(f"masked-audio-{item.participant_id}", source)
            options = rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_MICROPHONE)
            await room.local_participant.publish_track(track, options)
            output = (source, track)
            self.output_tracks[key] = output
        source, _ = output
        if channels != 1:
            pcm = audioop.tomono(pcm, 2, 0.5, 0.5)
        if rate != 48000:
            pcm, _ = audioop.ratecv(pcm, 2, 1, rate, 48000, None)
        masked = mask_pcm_mono_48k(pcm)
        frame_samples = 480
        for offset in range(0, len(masked), frame_samples * 2):
            chunk = masked[offset:offset + frame_samples * 2]
            if len(chunk) < frame_samples * 2:
                chunk += b"\x00" * (frame_samples * 2 - len(chunk))
            await source.capture_frame(rtc.AudioFrame(chunk, 48000, 1, frame_samples))


worker = Worker(); app = FastAPI()


async def loop():
    while True:
        if SECRET and LK_URL and LK_KEY and LK_SECRET:
            try:
                await worker.refresh(); worker.last_error = ""
                worker.last_success_at = time.time()
            except Exception as exc:
                worker.metrics["media_worker_errors_total"] += 1; worker.last_error = type(exc).__name__
        await asyncio.sleep(POLL)


@app.on_event("startup")
async def startup():
    asyncio.create_task(loop())


@app.get("/health")
def health(): return {"status": "ok"}


@app.get("/ready")
def ready():
    configured = bool(SECRET and LK_URL and LK_KEY and LK_SECRET)
    refreshed = worker.last_success_at > 0
    return {
        "status": "ready" if configured and refreshed and not worker.last_error else "degraded",
        "configured": configured,
        "last_error": worker.last_error,
        "last_success_at": worker.last_success_at,
    }


@app.get("/metrics")
def metrics(): return worker.metrics
