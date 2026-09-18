import io
import os
import wave

from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel
from piper import PiperVoice

VOICES_DIR = os.environ.get("VOICES_DIR", "/voices")
DEFAULT_VOICE = os.environ.get("DEFAULT_VOICE", "uk_UA-lada-x_low")

app = FastAPI()
_loaded_voices: dict[str, PiperVoice] = {}


def available_voice_ids() -> list[str]:
    if not os.path.isdir(VOICES_DIR):
        return []
    return sorted(
        name[:-5]
        for name in os.listdir(VOICES_DIR)
        if name.endswith(".onnx")
    )


def load_voice(voice_id: str) -> PiperVoice:
    if voice_id in _loaded_voices:
        return _loaded_voices[voice_id]
    model_path = os.path.join(VOICES_DIR, f"{voice_id}.onnx")
    if not os.path.isfile(model_path):
        raise HTTPException(status_code=422, detail=f"unknown voice: {voice_id}")
    voice = PiperVoice.load(model_path)
    _loaded_voices[voice_id] = voice
    return voice


class SynthesizeRequest(BaseModel):
    text: str
    voice: str | None = None


@app.get("/health")
def health():
    return {"status": "ok", "voices": available_voice_ids()}


@app.post("/synthesize")
def synthesize(req: SynthesizeRequest):
    text = req.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="text is required")

    voice_id = req.voice or DEFAULT_VOICE
    voice = load_voice(voice_id)

    buf = io.BytesIO()
    with wave.open(buf, "wb") as wav_file:
        voice.synthesize(text, wav_file)

    return Response(content=buf.getvalue(), media_type="audio/wav")
