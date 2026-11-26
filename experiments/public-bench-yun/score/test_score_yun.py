"""合成データの純粋関数と、利用可能なら上流を使うレコード構築を検査する。"""
import os
from pathlib import Path
import unittest

from score.score_yun import (FIELDS, build_record, concatenate_draw, gold_value,
                             upstream, validate_draws, validate_icos)


class PureTests(unittest.TestCase):
    def test_x_filling(self):
        for value in (None, ""):
            self.assertEqual(gold_value(value), "x")
        for value in (0, 1, 1.5, "x", " ", "1,525"):
            self.assertEqual(gold_value(value), value)
            self.assertIs(type(gold_value(value)), type(value))

    def test_comma_sensitivity(self):
        self.assertEqual(gold_value("1,525"), "1,525")
        self.assertEqual(gold_value("1,525", True), 1525)
        self.assertEqual(gold_value("6,032.37", True), 6032.37)
        for value in ("1,52", " 1,525", "-1,525", "1e3", "1525", 1525, 1.2):
            self.assertEqual(gold_value(value, True), value)
            self.assertIs(type(gold_value(value, True)), type(value))

    def test_concatenate_duplicates_and_empty_task(self):
        a, b = {"id": 1}, {"id": 2}
        self.assertEqual(concatenate_draw({2: [a, b], 10: []}, [2, 10], [0, 0]), [a, b, a, b])
        self.assertEqual(concatenate_draw({2: [a]}, [2, 10], [1, 1]), [])
        self.assertEqual(concatenate_draw({2: [a], 10: [b]}, [2, 10], [1, 0]), [b, a])

    def test_id_set_mismatch(self):
        gold = [{"id": 1, "pmcid": 2, "split": "TEST", "outcome_type": "binary"},
                {"id": 2, "pmcid": 10, "split": "TEST", "outcome_type": "continuous"}]
        ico = {"id": 1, "pmcid": 2, "outcomeType": "binary"}
        self.assertEqual(validate_icos(gold, [ico], [2])[0], gold[:1])
        for icos in ([], [dict(ico, id=3)], [ico, ico], [dict(ico, outcomeType="continuous")]):
            with self.assertRaises(ValueError):
                validate_icos(gold, icos, [2])
        with self.assertRaises(ValueError):
            validate_icos(gold, [ico], [2, 10])
        with self.assertRaises(ValueError):
            validate_icos(gold, [ico], [99])

    def test_draws_mismatch(self):
        data = {"replicates": 2, "pmcids": [2, 10], "draws": [[0, 0], [1, 0]]}
        validate_draws(data, [10, 2])
        for pmcids in ([2], [2, 11]):
            with self.assertRaises(ValueError):
                validate_draws(data, pmcids)
        for bad in (dict(data, pmcids=[10, 2]), dict(data, replicates=3),
                    dict(data, draws=[[0, 2], [1, 0]]), dict(data, draws=[[0], [1, 0]])):
            with self.assertRaises(ValueError):
                validate_draws(bad, [2, 10])


@unittest.skipUnless(os.environ.get("YUN_ROOT"), "YUN_ROOT 未設定のため上流依存の検査を省略")
class UpstreamTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.calculator, cls.utils = upstream(Path(os.environ["YUN_ROOT"]).resolve())

    def test_build_record(self):
        for task in FIELDS:
            row = {"id": 1, "pmcid": 2, **dict.fromkeys(FIELDS[task], "")}
            record = build_record(row, dict.fromkeys(FIELDS[task], "x"), task, self.utils)
            for field in FIELDS[task]:
                self.assertEqual(record[field], "x")
                self.assertEqual(record[field + "_output"], "x")
            estimate = "log_odds_ratio" if task == "binary_outcomes" else "standardized_mean_difference"
            self.assertEqual({key for key in record if "_output" in key},
                             {field + "_output" for field in FIELDS[task]} | {estimate + "_output"})


if __name__ == "__main__":
    unittest.main()
