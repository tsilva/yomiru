import json
import unittest

from yomiru.translation import Anchor
from yomiru.translation_review import review_batch, validate_compact_review, validate_review


class TranslationReviewTests(unittest.TestCase):
    def test_compact_review_preserves_implicit_keeps_and_explicit_uncertainty(self):
        request = review_batch(
            self.source, {"c00001": "It was declared.", "c00002": "Across the entire region."},
            0, 2, "codex/gpt-6.1-sol", full_context=True, clause_scope=True, compact=True,
        )
        body = {
            "reviewed_ids": ["c00002", "c00001"],
            "changes": [{"id": "c00001", "japanese": "全域に",
                         "text": "Across the entire region,", "issue": "cue_scope"}],
            "uncertain": [{"id": "c00002", "japanese": "発令されました"}],
        }
        result = validate_compact_review(json.dumps(body), request)
        self.assertEqual(result["translations"]["c00001"], "Across the entire region,")
        self.assertEqual(result["translations"]["c00002"], "Across the entire region.")
        self.assertEqual(result["uncertain"], ["c00002"])
        body["changes"] = []
        body["uncertain"] = []
        result = validate_compact_review(json.dumps(body), request)
        self.assertEqual(result["translations"]["c00001"], "It was declared.")

    def test_compact_review_rejects_incomplete_coverage_and_unsafe_proposals(self):
        base = {"reviewed_ids": self.request["ids"], "changes": [], "uncertain": []}
        variants = [dict(base, reviewed_ids=["c00001"]),
                    dict(base, reviewed_ids=["c00001", "c00001"]),
                    dict(base, reviewed_ids=["c00001", "unknown"])]
        for replacement in [dict(self.rows[0], japanese="違う文"),
                            dict(self.rows[0], text="It was declared."),
                            dict(self.rows[0], text=r"{\pos(1,1)}Bad")]:
            replacement.pop("action")
            variants.append(dict(base, changes=[replacement]))
        replacement = {k: v for k, v in self.rows[0].items() if k != "action"}
        variants.append(dict(base, changes=[replacement], uncertain=[
            {"id": "c00001", "japanese": "全域に"},
        ]))
        for body in variants:
            with self.subTest(body=body), self.assertRaises(ValueError):
                validate_compact_review(json.dumps(body), self.request)

    def setUp(self):
        self.source = [Anchor("c00001", 1000, 2000, "全域に"),
                       Anchor("c00002", 2200, 3200, "発令されました")]
        self.request = review_batch(self.source, {"c00001": "It was declared.",
                                                 "c00002": "Across the entire region."},
                                    0, 2, "test/model")
        self.rows = [
            {"id": "c00001", "japanese": "全域に", "action": "replace",
             "text": "Across the entire region,", "issue": "cue_scope"},
            {"id": "c00002", "japanese": "発令されました", "action": "replace",
             "text": "It was declared.", "issue": "cue_scope"},
        ]

    def test_reviews_are_grounded_and_applied_by_id(self):
        result = validate_review(json.dumps({"reviews": self.rows[::-1]}), self.request)
        self.assertEqual(result["translations"]["c00001"], "Across the entire region,")
        self.assertEqual(len(result["changes"]), 2)
        self.assertNotIn("1000", json.dumps(self.request["payload"]))

    def test_wrong_source_evidence_missing_ids_and_hidden_edits_are_rejected(self):
        variants = [self.rows[:1], [self.rows[0], self.rows[0]],
                    [dict(self.rows[0], japanese="違う文"), self.rows[1]],
                    [dict(self.rows[0], action="keep", issue="none"), self.rows[1]],
                    [dict(self.rows[0], text="It was declared."), self.rows[1]],
                    [dict(self.rows[0], text=r"{\pos(1,1)}Bad"), self.rows[1]]]
        for rows in variants:
            with self.subTest(rows=rows), self.assertRaises(ValueError):
                validate_review(json.dumps({"reviews": rows}), self.request)

    def test_uncertainty_preserves_text_and_requires_review(self):
        rows = [dict(self.rows[0], action="uncertain", issue="uncertain",
                     text="It was declared."), self.rows[1]]
        result = validate_review(json.dumps({"reviews": rows}), self.request)
        self.assertEqual(result["uncertain"], ["c00001"])
        self.assertEqual(result["translations"]["c00001"], "It was declared.")
