import asyncio
import os
import time
from typing import Any
from urllib import error, request

from fastapi import FastAPI

BACKEND_URL = os.environ.get("BACKEND_URL", "http://backend:8080").rstrip("/")
SYNC_INTERVAL_SECONDS = max(2, int(os.environ.get("SYNC_INTERVAL_SECONDS", "5")))

app = FastAPI()

state: dict[str, Any] = {
    "last_sync_at": 0.0,
    "last_sync_ok": False,
    "last_error": "",
    "work_items": {},
    "metrics": {
        "anonymous_audio_active_sessions": 0,
        "anonymous_audio_active_participants": 0,
        "anonymous_audio_utterances_total": 0,
        "anonymous_audio_errors_total": 0,
    },
}


def is_configured(name: str) -> bool:
    return bool(os.environ.get(name, "").strip())


def json_request(method: str, path: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    body = None
    headers = {"Content-Type": "application/json"}
    if payload is not None:
      import json
      body = json.dumps(payload).encode("utf-8")
    req = request.Request(f"{BACKEND_URL}{path}", method=method, data=body, headers=headers)
    with request.urlopen(req, timeout=15) as resp:
        import json
        return json.loads(resp.read().decode("utf-8"))


def derive_next_status(item: dict[str, Any]) -> str:
    current = str(item.get("status") or "").strip() or "initializing"
    if current in {"error", "playing", "recognizing", "synthesizing", "listening", "ready"}:
        return current
    return "ready"


async def sync_once() -> None:
    metrics = state["metrics"]
    try:
        response = await asyncio.to_thread(json_request, "GET", "/api/internal/anonymous-audio/work-items")
        items = response.get("items") or []
        next_items: dict[str, dict[str, Any]] = {}
        session_codes: set[str] = set()
        for item in items:
            session_code = str(item.get("session_code") or "").strip().upper()
            participant_token = str(item.get("participant_token") or "").strip()
            if not session_code or not participant_token:
                continue
            session_codes.add(session_code)
            item_key = f"{session_code}:{participant_token}"
            next_items[item_key] = item
            detected_language = item.get("detected_language") or ""
            preferred_language = str(item.get("preferred_language") or "").strip().split("-")[0].lower()
            payload = {
                "session_code": session_code,
                "participant_token": participant_token,
                "status": derive_next_status(item),
                "worker_ready": True,
                "worker_connected": True,
                "latency_ms": item.get("latency_ms") or 0,
                "language_locked": item.get("language_locked") or False,
            }
            if not detected_language and preferred_language:
                payload["detected_language"] = preferred_language
                payload["language_confidence"] = 0.99
            elif detected_language:
                payload["detected_language"] = detected_language
                payload["language_confidence"] = item.get("language_confidence") or 0.0
            await asyncio.to_thread(json_request, "POST", "/api/internal/anonymous-audio/runtime", payload)

        state["work_items"] = next_items
        metrics["anonymous_audio_active_sessions"] = len(session_codes)
        metrics["anonymous_audio_active_participants"] = len(next_items)
        state["last_sync_ok"] = True
        state["last_error"] = ""
    except (error.URLError, error.HTTPError, TimeoutError, ValueError) as exc:
        state["last_sync_ok"] = False
        state["last_error"] = str(exc)
        metrics["anonymous_audio_errors_total"] += 1
    finally:
        state["last_sync_at"] = time.time()


async def sync_loop() -> None:
    while True:
        await sync_once()
        await asyncio.sleep(SYNC_INTERVAL_SECONDS)


@app.on_event("startup")
async def startup_event() -> None:
    asyncio.create_task(sync_loop())


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/ready")
def ready():
    livekit = is_configured("LIVEKIT_URL") and is_configured("LIVEKIT_API_KEY") and is_configured("LIVEKIT_API_SECRET")
    redis = is_configured("REDIS_URL")
    stt_model = is_configured("STT_MODEL")
    tts_engine = is_configured("TTS_PROVIDER")
    ready_state = livekit and redis and stt_model and tts_engine and state["last_sync_ok"]
    return {
        "status": "ready" if ready_state else "degraded",
        "livekit": livekit,
        "redis": redis,
        "stt_model": stt_model,
        "tts_engine": tts_engine,
        "backend_sync": state["last_sync_ok"],
        "last_error": state["last_error"],
    }


@app.get("/metrics")
def metrics():
    return state["metrics"]
