import sys
import unittest
from array import array
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1]))

from app.audio import mask_pcm_mono_48k


class MaskedAudioTransformTest(unittest.TestCase):
    def test_preserves_pcm16_frame_length(self):
        source = array("h", [0, 1000, -1000, 32767, -32768] * 96).tobytes()
        transformed = mask_pcm_mono_48k(source)
        self.assertEqual(len(transformed), len(source))

    def test_changes_non_silent_samples(self):
        source = array("h", [12000, -12000, 5000, -5000]).tobytes()
        self.assertNotEqual(mask_pcm_mono_48k(source), source)


if __name__ == "__main__":
    unittest.main()
