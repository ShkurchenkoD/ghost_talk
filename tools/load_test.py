#!/usr/bin/env python3
"""Read-only concurrent HTTP smoke test for the GhostTalk backend."""

from __future__ import annotations

import argparse
import json
import math
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from statistics import median


def percentile(values: list[float], fraction: float) -> float:
    ordered = sorted(values)
    if not ordered:
        return 0.0
    index = min(len(ordered) - 1, max(0, math.ceil(len(ordered) * fraction) - 1))
    return ordered[index]


def one_request(url: str, timeout: float) -> tuple[float, int, str]:
    started = time.perf_counter()
    try:
        with urllib.request.urlopen(url, timeout=timeout) as response:
            response.read()
            return (time.perf_counter() - started) * 1000, response.status, ""
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as exc:
        status = getattr(exc, "code", 0) or 0
        return (time.perf_counter() - started) * 1000, status, type(exc).__name__


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://localhost:18080")
    parser.add_argument("--path", action="append", default=None, help="read-only path; repeat for a mixed workload")
    parser.add_argument("--requests", type=int, default=200)
    parser.add_argument("--concurrency", type=int, default=20)
    parser.add_argument("--timeout", type=float, default=10)
    parser.add_argument("--fail-p95-ms", type=float, default=1000)
    parser.add_argument("--fail-error-rate", type=float, default=0.01)
    args = parser.parse_args()
    if args.requests < 1 or args.concurrency < 1:
        parser.error("--requests and --concurrency must be positive")

    paths = [path if path.startswith("/") else f"/{path}" for path in (args.path or ["/health"])]
    urls = [f"{args.base_url.rstrip('/')}{paths[index % len(paths)]}" for index in range(args.requests)]
    results: list[tuple[float, int, str]] = []
    lock = threading.Lock()

    def run(url: str) -> None:
        result = one_request(url, args.timeout)
        with lock:
            results.append(result)

    started = time.perf_counter()
    with ThreadPoolExecutor(max_workers=args.concurrency) as pool:
        futures = [pool.submit(run, url) for url in urls]
        for future in as_completed(futures):
            future.result()
    elapsed_ms = (time.perf_counter() - started) * 1000
    latencies = [item[0] for item in results]
    errors = [item for item in results if item[1] < 200 or item[1] >= 300]
    output = {
        "base_url": args.base_url,
        "paths": paths,
        "requests": len(results),
        "concurrency": args.concurrency,
        "elapsed_ms": round(elapsed_ms, 2),
        "throughput_rps": round(len(results) / max(elapsed_ms / 1000, 0.001), 2),
        "p50_ms": round(median(latencies), 2) if latencies else 0,
        "p95_ms": round(percentile(latencies, 0.95), 2),
        "max_ms": round(max(latencies), 2) if latencies else 0,
        "errors": len(errors),
        "error_rate": round(len(errors) / max(len(results), 1), 4),
        "error_types": sorted({item[2] or f"HTTP_{item[1]}" for item in errors}),
    }
    print(json.dumps(output, ensure_ascii=False, indent=2))
    if output["p95_ms"] > args.fail_p95_ms or output["error_rate"] > args.fail_error_rate:
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
