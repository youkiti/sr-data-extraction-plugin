"""合成データの純粋関数と、利用可能なら上流を使うレコード構築を検査する。"""
import os
from pathlib import Path
import unittest
from unittest.mock import Mock, patch
import subprocess

from score.score_yun import (FIELDS, YUN_COMMIT, assert_yun_checkout, main, build_record, concatenate_draw, gold_value,
                             upstream, validate_draws, validate_icos)


class CheckoutTests(unittest.TestCase):
    @patch("score.score_yun.subprocess.run")
    def test_fixed_clean_checkout(self, git):
        git.side_effect = [Mock(stdout=YUN_COMMIT + "\n"), Mock(stdout="")]
        assert_yun_checkout(Path("/上流 clone"))
        self.assertEqual(git.call_args_list[0].args[0],
                         ["git", "-C", "/上流 clone", "rev-parse", "HEAD"])
        self.assertEqual(git.call_args_list[1].args[0],
                         ["git", "-C", "/上流 clone", "status", "--porcelain", "--untracked-files=no"])
        for call in git.call_args_list:
            self.assertEqual(call.kwargs, dict(check=True, capture_output=True, text=True))

    @patch("score.score_yun.subprocess.run")
    def test_reject_wrong_commit_and_tracked_changes(self, git):
        for head, status, message in (("wrong", "", "commit が一致しません"),
                                      (YUN_COMMIT, " M evaluation/metrics.py\n", "追跡対象ファイルの変更")):
            with self.subTest(head=head, status=status):
                git.side_effect = [Mock(stdout=head), Mock(stdout=status)]
                with self.assertRaisesRegex(ValueError, message):
                    assert_yun_checkout(Path("/upstream"))

    @patch("score.score_yun.subprocess.run")
    def test_git_failure(self, git):
        git.side_effect = subprocess.CalledProcessError(128, ["git"])
        with self.assertRaisesRegex(ValueError, "git で検証できません"):
            assert_yun_checkout(Path("/upstream"))

    @patch("score.score_yun.upstream")
    @patch("score.score_yun.assert_yun_checkout", side_effect=ValueError("検証で拒否"))
    def test_check_before_loading_upstream_in_all_modes(self, check, load):
        for flags in ([], ["--selftest-gpt4"], ["--gold-comma-normalized"]):
            with self.subTest(flags=flags):
                with self.assertRaisesRegex(ValueError, "検証で拒否"):
                    main(["--yun-root", "/upstream", *flags])
        self.assertEqual(check.call_count, 3)
        load.assert_not_called()


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
