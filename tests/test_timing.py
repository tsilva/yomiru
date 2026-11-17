import unittest

from yomiru.captions import Cue
from yomiru.timing import Timing, adjust, align_boundaries, estimate_offset


def dialogue():
    # Irregular, reproducible speech spacing; no copyrighted dialogue.
    start = 5000
    rows = []
    for i in range(90):
        start += 2100 + (i * 7919 % 3901)
        rows.append(Cue(start, start + 1400 + (i * 79 % 900), f"Line {i}"))
    return rows


class TimingTests(unittest.TestCase):
    def test_early_japanese_is_delayed_without_changing_base_or_durations(self):
        base = dialogue()
        ja = [Cue(c.start - 980, c.end - 980, c.text) for c in base]
        upper, lower, report = adjust(ja, base, Timing(align=True))
        self.assertEqual(report["automatic_offset_ms"], 980)
        self.assertEqual(upper, base)
        self.assertEqual(lower, base)
        self.assertEqual(ja[0].start, base[0].start - 980)
        self.assertFalse(report["audio_verified"])

    def test_late_japanese_and_missing_cues_still_fit(self):
        base = dialogue()
        ja = [Cue(c.start + 530, c.end + 530, c.text) for i, c in enumerate(base) if i % 4]
        report = estimate_offset(ja, base)
        self.assertEqual(report["automatic_offset_ms"], -530)

    def test_small_late_japanese_cues_align_both_boundaries_without_global_shift(self):
        base = dialogue()
        japanese = [Cue(c.start + 130, c.end + 180, "日本語") for c in base]
        upper, lower, report = adjust(japanese, base, Timing(align=True))
        self.assertEqual(report["automatic_offset_ms"], 0)
        self.assertEqual(report["boundary_aligned_cues"], len(base))
        self.assertEqual([(c.start, c.end) for c in upper], [(c.start, c.end) for c in base])
        self.assertTrue(all(c.text == "日本語" for c in upper))
        self.assertEqual(lower, base)
        self.assertEqual(japanese[0].start, base[0].start + 130)

    def test_global_offset_then_jitter_correction_then_manual_delays(self):
        base = dialogue()
        japanese = [
            Cue(c.start - 980 + (i % 3 - 1) * 40,
                c.end - 980 + (i % 3 - 1) * 90, "日本語")
            for i, c in enumerate(base)
        ]
        upper, lower, report = adjust(japanese, base, Timing(True, 100, -50))
        self.assertGreater(report["boundary_aligned_cues"], 40)
        self.assertEqual(
            [(c.start, c.end) for c in upper],
            [(c.start + 100, c.end + 100) for c in base],
        )
        self.assertEqual(lower[0].start, base[0].start - 50)

    def test_extra_closed_captions_do_not_hide_a_consistent_offset(self):
        base = dialogue()
        japanese = [Cue(c.start - 980, c.end - 980, "Speech") for c in base]
        japanese += [Cue(2000 + i * 1900, 2800 + i * 1900, "Effect") for i in range(180)]
        report = estimate_offset(japanese, base)
        self.assertEqual(report["automatic_offset_ms"], 980)

    def test_ambiguous_split_or_distant_cues_are_never_collapsed(self):
        base = [Cue(1000, 3000, "One phrase"), Cue(5000, 7000, "Second phrase")]
        cases = [
            [Cue(1000, 2000, "First half"), Cue(2000, 3000, "Second half")],
            [Cue(1100, 3100, "A"), Cue(1150, 3150, "B")],
            [Cue(1400, 3400, "Distant")],
        ]
        for japanese in cases:
            with self.subTest(japanese=japanese):
                self.assertEqual(align_boundaries(japanese, base), (japanese, 0, 0))
        dense = [Cue(1000 + i, 3000 + i, "Overlap") for i in range(20)]
        self.assertEqual(align_boundaries([base[0]], dense), ([base[0]], 0, 0))

    def test_sparse_regular_unrelated_and_cut_timelines_are_left_unchanged(self):
        base = dialogue()
        periodic = [Cue(i * 1000, i * 1000 + 500, "Repeated") for i in range(200)]
        cases = [
            (base[:4], base[:4]),
            ([Cue(c.start + 600, c.end + 600, c.text) for c in periodic], periodic),
            ([Cue(c.start * 3, c.end * 3, c.text) for c in base], base),
            ([Cue(c.start - (900 if i < 60 else 1400),
                  c.end - (900 if i < 60 else 1400), c.text)
              for i, c in enumerate(base)], base),
            ([Cue(c.start - 3000, c.end - 3000, c.text) for c in base], base),
        ]
        for ja, lower in cases:
            with self.subTest(first=ja[0].start):
                self.assertEqual(estimate_offset(ja, lower)["automatic_offset_ms"], 0)
                upper, _, report = adjust(ja, lower, Timing(align=True))
                self.assertEqual(report["boundary_aligned_cues"], 0)
                self.assertEqual(upper, ja)

    def test_manual_delays_are_independent_and_negative_times_are_clipped(self):
        ja = [Cue(100, 500, "Discard"), Cue(500, 1500, "Clip"), Cue(2000, 3000, "Keep")]
        base = [Cue(1000, 2000, "Base")]
        upper, lower, report = adjust(ja, base, Timing(False, -700, 250))
        self.assertEqual(upper, [Cue(0, 800, "Clip"), Cue(1300, 2300, "Keep")])
        self.assertEqual(lower, [Cue(1250, 2250, "Base")])
        self.assertEqual(report["status"], "disabled")
        for bad in [float("nan"), True, "100", 60001]:
            with self.assertRaises(ValueError):
                Timing(japanese_delay_ms=bad)
