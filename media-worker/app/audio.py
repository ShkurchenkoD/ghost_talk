"""Pure PCM transforms used by the streaming media worker."""

from array import array


def mask_pcm_mono_48k(pcm: bytes) -> bytes:
    """Apply the low-latency masked timbre transform to mono 48 kHz PCM16.

    Keeping this operation pure makes its safety properties testable without a
    LiveKit connection. Resampling/channel conversion is deliberately handled
    by the caller before invoking this function.
    """
    samples = array("h")
    samples.frombytes(pcm[: len(pcm) - (len(pcm) % 2)])
    for index, sample in enumerate(samples):
        normalized = max(-1.0, min(1.0, (sample / 32768.0) * 2.4))
        samples[index] = int(max(-1.0, min(1.0, normalized - (normalized ** 3) * 0.18)) * 22000)
    return samples.tobytes()
