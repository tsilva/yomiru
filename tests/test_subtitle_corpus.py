import unittest

from yomiru.subtitle_corpus import (
    ass_parts,
    rebuild_ass,
    rendered_translation,
    translations_for_practice,
)


class SubtitleCorpusTest(unittest.TestCase):
    def test_exact_rendition_preserves_line_endings_and_event_text(self):
        original = (
            '\ufeff[Script Info]\r\nTitle: Test\r\n\r\n[Events]\r\n'
            'Format: Start, End, Style, Text\r\n'
            'Dialogue: 0:00:01.00,0:00:02.00,English,Here, take this.\\NPlease.\r\n'
        ).encode()
        header, events = ass_parts(original)
        self.assertEqual((header + '\n'.join(events)).encode(), original)
        self.assertEqual(rendered_translation(events), [
            {'start': 1000, 'end': 2000, 'text': 'Here, take this. Please.'},
        ])

    def test_recovered_timeline_can_render_but_ambiguous_text_cannot_supply_context(self):
        source = {'cues': [{'id': 'c00001', 'start': 1001, 'end': 2001,
                            'reading_source': '水を飲みます。'}]}
        translation = {'provenance': 'rendered', 'cues': [
            {'start': 1000, 'end': 2000, 'text': 'I drink water.'},
        ]}
        self.assertEqual(translations_for_practice(source, translation),
                         {'c00001': 'I drink water.'})
        self.assertIn('みずをのみます', rebuild_ass(source, translation, 'kana'))
        translation['cues'].append({'start': 1000, 'end': 2000, 'text': 'A second meaning.'})
        self.assertEqual(translations_for_practice(source, translation), {})
