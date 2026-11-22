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

    def test_kana_track_regenerates_only_the_selected_reviewed_span(self):
        source = {"cues": [
            {"id": "c00001", "start": 1000, "end": 2000,
             "japanese": "猫がいる。", "reading_source": "猫がいる。"},
            {"id": "c00002", "start": 2100, "end": 3000,
             "japanese": "猫がいる。", "reading_source": "猫がいる。"},
        ]}
        translation = {"cues": [
            {"start": 1000, "end": 2000, "text": "A cat is here."},
            {"start": 2100, "end": 3000, "text": "Here is a cat."},
        ]}
        edits = {"c00002": [{"start": 0, "end": 1, "form": "猫", "beforeKana": "ねこ",
                             "beforeRomaji": "Neko", "kana": "ネコ", "romaji": "Neko"}]}
        original = rebuild_ass(source, translation, "kana")
        fixed = rebuild_ass(source, translation, "kana", subtitle_readings=edits)
        self.assertEqual(fixed, original.replace(
            "0:00:02.10,0:00:03.00,Japanese,,0,0,0,,ねこ",
            "0:00:02.10,0:00:03.00,Japanese,,0,0,0,,ネコ",
        ))
        self.assertNotEqual(original, fixed)
        self.assertEqual(rebuild_ass(source, translation, "japanese", subtitle_readings=edits),
                         rebuild_ass(source, translation, "japanese"))

    def test_kana_track_checks_reviewed_edits_against_source_ruby(self):
        source = {"cues": [{
            "id": "c00001", "start": 1000, "end": 2000,
            "japanese": "山田と猫。", "reading_source": "山田(やまた)と猫。",
        }]}
        translation = {"cues": [{"start": 1000, "end": 2000, "text": "Yamata and a cat."}]}
        ruby = {"start": 0, "end": 2, "form": "山田", "beforeKana": "やまだ",
                "beforeRomaji": "Yamada", "kana": "やまた", "romaji": "Yamata"}
        cat = {"start": 3, "end": 4, "form": "猫", "beforeKana": "ねこ",
               "beforeRomaji": "neko", "kana": "ネコ", "romaji": "neko"}
        original = rebuild_ass(source, translation, "kana")
        fixed = rebuild_ass(source, translation, "kana", subtitle_readings={"c00001": [ruby, cat]})
        self.assertEqual(fixed, original.replace("やまたとねこ", "やまたとネコ"))
        with self.assertRaisesRegex(ValueError, "does not align with the stored cue c00001"):
            rebuild_ass(source, translation, "kana", subtitle_readings={"c00001": [cat]})

    def test_reviewed_kana_can_restore_a_surname_before_given_name_ruby(self):
        source = {"cues": [{
            "id": "c00001", "start": 1000, "end": 2000,
            "japanese": "山田元です!", "reading_source": "山田元(はじめ)です!",
        }]}
        translation = {"cues": [{"start": 1000, "end": 2000, "text": "I'm Hajime Yamada!"}]}
        name = {"start": 0, "end": 3, "form": "山田元", "beforeKana": "やまだもと",
                "beforeRomaji": "Yamada moto", "kana": "やまだはじめ", "romaji": "Yamada Hajime"}
        original = rebuild_ass(source, translation, "kana")
        fixed = rebuild_ass(source, translation, "kana", subtitle_readings={"c00001": [name]})
        self.assertIn("はじめです!", original)
        self.assertEqual(fixed, original.replace("はじめです!", "やまだはじめです!"))
        with self.assertRaisesRegex(ValueError, "does not align with the stored cue c00001"):
            rebuild_ass(source, translation, "kana",
                        subtitle_readings={"c00001": [{**name, "kana": "やまだもと"}]})
