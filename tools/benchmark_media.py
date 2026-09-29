#!/usr/bin/env python3
"""Small, reproducible latency harness for the realtime audio pipeline.

The local-only stages (VAD and masked PCM processing) are always measured.
STT/TTS measurements are enabled when INTERNAL_WORKER_TOKEN is provided and
call the backend's worker-only routes; no transcript or audio samples are
written to disk.
"""

from __future__ import annotations

import argparse
import importlib.util
import io
import json
import math
import os
import time
import urllib.error
import urllib.request
import wave
from array import array
from pathlib import Path
from statistics import median


ROOT = Path(__file__).resolve().parents[1]
AUDIO_PATH = ROOT / "media-worker" / "app" / "audio.py"
spec = importlib.util.spec_from_file_location("ghosttalk_audio", AUDIO_PATH)
if spec is None or spec.loader is None:
    raise RuntimeError(f"unable to load {AUDIO_PATH}")
audio_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audio_module)
mask_pcm_mono_48k = audio_module.mask_pcm_mono_48k


def percentile(values: list[float], fraction: float) -> float:
    ordered = sorted(values)
    if not ordered:
        return 0.0
    index = min(len(ordered) - 1, max(0, math.ceil(len(ordered) * fraction) - 1))
    return ordered[index]


def measure(name: str, fn, iterations: int) -> dict[str, float | int | str]:
    samples: list[float] = []
    for _ in range(iterations):
        started = time.perf_counter()
        fn()
        samples.append((time.perf_counter() - started) * 1000)
    return {
        "name": name,
        "count": len(samples),
        "p50_ms": round(median(samples), 2),
        "p95_ms": round(percentile(samples, 0.95), 2),
        "p99_ms": round(percentile(samples, 0.99), 2),
        "max_ms": round(max(samples), 2),
    }


def pcm_fixture(seconds: float = 0.25, sample_rate: int = 48_000) -> bytes:
    count = int(seconds * sample_rate)
    samples = array("h", (int(9000 * math.sin(2 * math.pi * 220 * i / sample_rate)) for i in range(count)))
    return samples.tobytes()


def rms_fixture(pcm: bytes) -> float:
    samples = array("h")
    samples.frombytes(pcm[: len(pcm) - (len(pcm) % 2)])
    if not samples:
        return 0.0
    return math.sqrt(sum(sample * sample for sample in samples) / len(samples))


def wav_fixture(pcm: bytes) -> bytes:
    stream = io.BytesIO()
    with wave.open(stream, "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(48_000)
        output.writeframes(pcm)
    return stream.getvalue()


def multipart(boundary: str, audio: bytes) -> bytes:
    return b"".join(
        [
            f'--{boundary}\r\nContent-Disposition: form-data; name="language"\r\n\r\nuk\r\n'.encode(),
            f'--{boundary}\r\nContent-Disposition: form-data; name="audio"; filename="benchmark.wav"\r\nContent-Type: audio/wav\r\n\r\n'.encode(),
            audio,
            f"\r\n--{boundary}--\r\n".encode(),
        ]
    )


def request_once(url: str, body: bytes, content_type: str, token: str) -> bytes:
    headers = {"Content-Type": content_type, "X-Internal-Worker-Token": token}
    req = urllib.request.Request(url, method="POST", data=body, headers=headers)
    with urllib.request.urlopen(req, timeout=60) as response:
        return response.read()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--iterations", type=int, default=5)
    parser.add_argument("--backend-url", default=os.getenv("BENCHMARK_BACKEND_URL", "http://localhost:18080"))
    parser.add_argument("--token", default=os.getenv("INTERNAL_WORKER_TOKEN", ""))
    parser.add_argument("--skip-services", action="store_true")
    parser.add_argument("--fail-on-thresholds", action="store_true")
    parser.add_argument("--masked-p95-ms", type=float, default=500)
    parser.add_argument("--stt-p95-ms", type=float, default=2500)
    parser.add_argument("--tts-p95-ms", type=float, default=2500)
    args = parser.parse_args()
    if args.iterations < 1:
        parser.error("--iterations must be positive")

    pcm = pcm_fixture()
    results = [
        measure("vad_rms", lambda: rms_fixture(pcm), args.iterations),
        measure("masked_pcm", lambda: mask_pcm_mono_48k(pcm), args.iterations),
    ]
    skipped: list[str] = []
    if args.skip_services or not args.token:
        skipped.extend(["stt", "tts"])
    else:
        audio = wav_fixture(pcm)
        boundary = "ghosttalk-benchmark"
        try:
            results.append(
                measure(
                    "stt",
                    lambda: request_once(
                        f"{args.backend_url.rstrip('/')}/api/internal/transcribe",
                        multipart(boundary, audio),
                        f"multipart/form-data; boundary={boundary}",
                        args.token,
                    ),
                    args.iterations,
                )
            )
            tts_payload = json.dumps({"text": "Тестова фраза для benchmark", "voice": ""}).encode()
            results.append(
                measure(
                    "tts",
                    lambda: request_once(
                        f"{args.backend_url.rstrip('/')}/api/internal/synthesize",
                        tts_payload,
                        "application/json",
                        args.token,
                    ),
                    args.iterations,
                )
            )
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as exc:
            skipped.extend(["stt", "tts"])
            skipped.append(f"services_error:{type(exc).__name__}")

    output = {"iterations": args.iterations, "results": results, "skipped": skipped}
    print(json.dumps(output, ensure_ascii=False, indent=2))
    if not args.fail_on_thresholds:
        return 0
    limits = {"masked_pcm": args.masked_p95_ms, "stt": args.stt_p95_ms, "tts": args.tts_p95_ms}
    violations = [
        f"{item['name']} p95={item['p95_ms']}ms > {limits[item['name']]}ms"
        for item in results
        if item["name"] in limits and float(item["p95_ms"]) > limits[item["name"]]
    ]
    if violations:
        print("threshold violations:", "; ".join(violations))
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
