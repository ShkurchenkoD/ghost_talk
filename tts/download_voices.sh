#!/bin/sh
# Downloads a small fixed set of Piper voices used to give each anonymous
# participant a distinct, consistent synthetic voice for a session.
#
# Voice paths follow the rhasspy/piper-voices HuggingFace layout:
#   https://huggingface.co/rhasspy/piper-voices/tree/main/<lang>/<lang_REGION>/<name>/<quality>/
# If a download 404s (a voice was renamed/removed upstream), check that page
# for the current path and update VOICES below.
set -eu

BASE_URL="https://huggingface.co/rhasspy/piper-voices/resolve/main"
mkdir -p "$VOICES_DIR"

# entries: <lang>/<lang_REGION>/<name>/<quality>/<lang_REGION>-<name>-<quality>
VOICES="
uk/uk_UA/lada/x_low/uk_UA-lada-x_low
en/en_US/lessac/medium/en_US-lessac-medium
en/en_US/amy/medium/en_US-amy-medium
en/en_GB/alan/low/en_GB-alan-low
"

for entry in $VOICES; do
  dir=$(dirname "$entry")
  base=$(basename "$entry")
  echo "Fetching voice $base"
  curl -fL "$BASE_URL/$dir/$base.onnx" -o "$VOICES_DIR/$base.onnx"
  curl -fL "$BASE_URL/$dir/$base.onnx.json" -o "$VOICES_DIR/$base.onnx.json"
done
