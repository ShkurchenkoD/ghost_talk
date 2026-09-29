import asyncio
import json
import os
import time
from typing import Any
from urllib import error, request

from fastapi import FastAPI

BACKEND_URL = os.environ.get("BACKEND_URL", "http://backend:8080").rstrip("/")
WORKER_TOKEN = os.environ.get("INTERNAL_WORKER_TOKEN", "").strip()
ANALYSIS_URL = os.environ.get("ANALYSIS_URL", "").strip()
ANALYSIS_API_KEY = os.environ.get("ANALYSIS_API_KEY", "").strip()
ANALYSIS_MODEL = os.environ.get("ANALYSIS_MODEL", "").strip()
POLL_SECONDS = max(2, int(os.environ.get("ANALYSIS_POLL_SECONDS", "5")))

app = FastAPI()
state: dict[str, Any] = {"last_error": "", "last_run_at": 0.0, "completed": 0, "failed": 0}


def configured() -> bool:
    return bool(WORKER_TOKEN and ANALYSIS_URL and ANALYSIS_MODEL)


def backend_request(method: str, path: str, payload: dict[str, Any] | None = None) -> tuple[int, dict[str, Any]]:
    body = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = request.Request(f"{BACKEND_URL}{path}", method=method, data=body, headers={
        "Content-Type": "application/json",
        "X-Internal-Worker-Token": WORKER_TOKEN,
    })
    try:
        with request.urlopen(req, timeout=30) as response:
            raw = response.read().decode("utf-8")
            return response.status, json.loads(raw) if raw else {}
    except error.HTTPError as exc:
        raw = exc.read().decode("utf-8")
        return exc.code, json.loads(raw) if raw else {}


def build_messages(data: dict[str, Any]) -> list[dict[str, str]]:
    transcript = [
        {"id": item["id"], "speaker": item["participant_alias"], "time_ms": item["started_at_ms"], "text": item["text"]}
        for item in data.get("segments", [])
    ]
    cards = [{"id": card["id"], "category": card["category"], "votes": card["vote_count"], "text": card["text"]} for card in data.get("cards", [])]
    system = "You analyse an anonymous facilitated meeting. Return only valid JSON; do not infer real identities or invent commitments."
    schema = {
        "executive_summary": "string",
        "themes": [{"title": "string", "summary": "string", "segment_ids": [1]}],
        "decisions": [{"text": "string", "segment_ids": [1]}],
        "risks_questions": [{"text": "string", "segment_ids": [1]}],
        "action_items": [{"text": "string", "owner_alias": "string", "due_date": None, "segment_ids": [1]}],
    }
    user = {"session": data.get("session", {}), "transcript": transcript, "cards": cards, "required_schema": schema}
    return [{"role": "system", "content": system}, {"role": "user", "content": json.dumps(user, ensure_ascii=False)}]


def call_analysis(data: dict[str, Any]) -> dict[str, Any]:
    headers = {"Content-Type": "application/json"}
    if ANALYSIS_API_KEY:
        headers["Authorization"] = f"Bearer {ANALYSIS_API_KEY}"
    payload = {"model": ANALYSIS_MODEL, "messages": build_messages(data), "response_format": {"type": "json_object"}}
    req = request.Request(ANALYSIS_URL, method="POST", data=json.dumps(payload).encode("utf-8"), headers=headers)
    with request.urlopen(req, timeout=90) as response:
        body = json.loads(response.read().decode("utf-8"))
    content = str(body["choices"][0]["message"]["content"]).strip()
    # Providers occasionally wrap an otherwise valid structured response in a
    # Markdown fence. Accept that transport quirk without relaxing the JSON
    # schema validation below.
    if content.startswith("```") and content.endswith("```"):
        content = content.split("\n", 1)[1].rsplit("\n", 1)[0].strip()
    result = json.loads(content)
    if not isinstance(result.get("executive_summary"), str) or not result["executive_summary"].strip():
        raise ValueError("analysis response has no executive_summary")
    return result


def normalize_result(result: dict[str, Any]) -> dict[str, Any]:
    def array(key: str) -> list[Any]:
        value = result.get(key, [])
        return value if isinstance(value, list) else []
    actions = []
    for action in array("action_items")[:100]:
        if not isinstance(action, dict) or not str(action.get("text", "")).strip():
            continue
        due_date = action.get("due_date")
        if isinstance(due_date, str) and due_date:
            try:
                due_date = time.strftime("%Y-%m-%dT00:00:00Z", time.strptime(due_date, "%Y-%m-%d"))
            except ValueError:
                due_date = None
        else:
            due_date = None
        actions.append({
            "text": str(action["text"]).strip(), "owner_alias": str(action.get("owner_alias", "")).strip(),
            "due_date": due_date, "source_segment_ids": action.get("segment_ids", []), "status": "open",
        })
    return {"insight": {
        "executive_summary": result["executive_summary"].strip(), "themes": array("themes"),
        "decisions": array("decisions"), "risks_questions": array("risks_questions"),
    }, "action_items": actions}


async def run_once() -> None:
    if not configured():
        return
    status, claimed = await asyncio.to_thread(backend_request, "POST", "/api/internal/analysis/jobs/claim")
    if status == 204:
        return
    if status != 200:
        raise RuntimeError(f"unable to claim analysis job: HTTP {status}")
    job = claimed["job"]
    job_id = job["id"]
    try:
        status, data = await asyncio.to_thread(backend_request, "GET", f"/api/internal/analysis/jobs/{job_id}/input")
        if status != 200:
            raise RuntimeError(f"unable to load analysis input: HTTP {status}")
        result = await asyncio.to_thread(call_analysis, data)
        status, _ = await asyncio.to_thread(backend_request, "POST", f"/api/internal/analysis/jobs/{job_id}/complete", normalize_result(result))
        if status != 200:
            raise RuntimeError(f"unable to complete analysis job: HTTP {status}")
        state["completed"] += 1
    except Exception as exc:
        state["failed"] += 1
        # Provider errors can echo request content. Do not persist or expose
        # them because that content may include an anonymous transcript.
        await asyncio.to_thread(backend_request, "POST", f"/api/internal/analysis/jobs/{job_id}/fail", {"error": type(exc).__name__})
        raise


async def loop() -> None:
    while True:
        try:
            await run_once()
            state["last_error"] = ""
        except Exception as exc:
            # Metrics are intentionally transcript-free for the same reason
            # job errors are: provider messages may echo request content.
            state["last_error"] = type(exc).__name__
        finally:
            state["last_run_at"] = time.time()
        await asyncio.sleep(POLL_SECONDS)


@app.on_event("startup")
async def startup() -> None:
    asyncio.create_task(loop())


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/ready")
def ready():
    return {"status": "ready" if configured() else "degraded", "configured": configured(), "last_error": state["last_error"]}


@app.get("/metrics")
def metrics():
    return state
