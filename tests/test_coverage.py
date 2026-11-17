import unittest

from yomiru.captions import Cue
from yomiru.coverage import sparse_base


class CoverageTests(unittest.TestCase):
    def test_sparse_song_or_signs_track_is_detected_but_dialogue_is_retained(self):
        japanese = [Cue(i * 5000, i * 5000 + 3000, "日本語") for i in range(120)]
        partial = [Cue(i * 5000, i * 5000 + 3000, "Sign") for i in range(8)]
        self.assertTrue(sparse_base(japanese, partial))
        self.assertFalse(sparse_base(japanese, japanese[::2]))
        # A fewer-cue translation can still cover the dialogue timeline.
        self.assertFalse(sparse_base(japanese, [Cue(0, 600000, "Long translation")]))
        # Short excerpts are insufficient evidence of a signs-only track.
        self.assertFalse(sparse_base(japanese[:4], partial[:1]))
