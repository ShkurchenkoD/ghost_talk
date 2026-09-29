#!/usr/bin/env python3
"""Validate the minimum privacy-safe production environment before deploy."""

from __future__ import annotations

import argparse
import re
from pathlib import Path
from urllib.parse import urlparse


PLACEHOLDERS = (
    "replace-me",
    "replace-with",
    "your-api",
    "example.com",
)


def read_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        values[key.strip()] = value
    return values


def is_placeholder(value: str) -> bool:
    lower = value.strip().lower()
    return not lower or any(marker in lower for marker in PLACEHOLDERS)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-file", type=Path, required=True)
    args = parser.parse_args()
    values = read_env(args.env_file)
    failures: list[str] = []

    required = [
        "SERVER_NAME",
        "LIVEKIT_SERVER_NAME",
        "LIVEKIT_URL",
        "LIVEKIT_API_KEY",
        "LIVEKIT_API_SECRET",
        "INTERNAL_WORKER_TOKEN",
        "CSP_CONNECT_SRC",
        "CORS_ALLOWED_ORIGINS",
        "TRANSCRIPT_RETENTION",
    ]
    for key in required:
        if not values.get(key, "").strip():
            failures.append(f"{key} is required")

    if values.get("ENABLE_TLS", "").lower() != "true":
        failures.append("ENABLE_TLS must be true for production")
    if values.get("MEDIA_TOPOLOGY", "dual").lower() != "dual":
        failures.append("MEDIA_TOPOLOGY must be dual for raw-track isolation")
    retention = values.get("TRANSCRIPT_RETENTION", "").strip().lower()
    if not re.fullmatch(r"[1-9][0-9]*(?:m|h|d)", retention):
        failures.append("TRANSCRIPT_RETENTION must be a positive duration such as 720h")

    for key in ("LIVEKIT_API_SECRET", "INTERNAL_WORKER_TOKEN"):
        value = values.get(key, "")
        if is_placeholder(value):
            failures.append(f"{key} still contains a placeholder")
        elif len(value) < 32:
            failures.append(f"{key} must be at least 32 characters")

    livekit_url = values.get("LIVEKIT_URL", "")
    parsed = urlparse(livekit_url)
    if parsed.scheme != "wss" or not parsed.hostname:
        failures.append("LIVEKIT_URL must be a wss:// URL with a hostname")

    csp = values.get("CSP_CONNECT_SRC", "")
    if "*" in csp or "http:" in csp or "https:" not in csp or "wss:" not in csp:
        failures.append("CSP_CONNECT_SRC must explicitly include HTTPS and WSS origins without wildcards")
    for hostname in (values.get("SERVER_NAME", ""), values.get("LIVEKIT_SERVER_NAME", "")):
        if hostname and hostname not in csp:
            failures.append(f"CSP_CONNECT_SRC does not include {hostname}")

    cors = values.get("CORS_ALLOWED_ORIGINS", "")
    if "*" in cors:
        failures.append("CORS_ALLOWED_ORIGINS must not contain a wildcard")
    if values.get("SERVER_NAME") and values["SERVER_NAME"] not in cors:
        failures.append("CORS_ALLOWED_ORIGINS does not include SERVER_NAME")

    if failures:
        print(f"production preflight failed for {args.env_file}:")
        print("\n".join(f"- {failure}" for failure in failures))
        return 1
    print(f"production preflight passed for {args.env_file}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
