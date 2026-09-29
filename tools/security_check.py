#!/usr/bin/env python3
"""Static privacy-boundary checks for the production deployment files."""

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def require(path: Path, needle: str, failures: list[str]) -> None:
    if needle not in path.read_text(encoding="utf-8"):
        failures.append(f"{path.relative_to(ROOT)}: missing {needle!r}")


def main() -> int:
    failures: list[str] = []
    nginx_files = [
        ROOT / "frontend" / "nginx.http.conf.template",
        ROOT / "frontend" / "nginx.https.conf.template",
        ROOT / "frontend" / "nginx.conf",
    ]
    for path in nginx_files:
        text = path.read_text(encoding="utf-8")
        require(path, "location ^~ /api/internal/", failures)
        require(path, "return 404;", failures)
        if "proxy_pass" in text.split("location ^~ /api/internal/", 1)[1].split("}", 1)[0]:
            failures.append(f"{path.relative_to(ROOT)}: internal location must not proxy")

    entrypoint = ROOT / "frontend" / "docker-entrypoint.prod.sh"
    require(entrypoint, 'CSP_CONNECT_SRC="${CSP_CONNECT_SRC:-\'self\'}"', failures)
    compose = ROOT / "docker-compose.prod.yml"
    require(compose, "CSP_CONNECT_SRC:", failures)
    require(compose, 'LOG_TRANSCRIPTS: "false"', failures)
    require(compose, 'SAVE_AUDIO_SAMPLES: "false"', failures)
    require(compose, "http://localhost:8080/ready", failures)
    for path in [ROOT / ".env.prod.example", ROOT / ".env.lan.example"]:
        require(path, "CSP_CONNECT_SRC=", failures)

    for path in [ROOT / "frontend" / "nginx.http.conf.template", ROOT / "frontend" / "nginx.https.conf.template"]:
        text = path.read_text(encoding="utf-8")
        if "connect-src ${CSP_CONNECT_SRC}" not in text:
            failures.append(f"{path.relative_to(ROOT)}: CSP must use explicit CSP_CONNECT_SRC")
        if "connect-src 'self' https:" in text or "connect-src 'self' ws:" in text:
            failures.append(f"{path.relative_to(ROOT)}: broad production connect-src fallback found")

    if failures:
        print("security checks failed:")
        print("\n".join(f"- {failure}" for failure in failures))
        return 1
    print(f"security checks passed ({len(nginx_files)} nginx configs, production CSP and worker boundaries)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
