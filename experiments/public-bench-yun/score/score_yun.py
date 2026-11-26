"""上流の指標を使う評価 C の採点。本文や正解の複製は保存しない。"""
import argparse
import contextlib
import hashlib
import importlib
import io
import json
from pathlib import Path
import re
import subprocess
import sys

FIELDS = {
    "binary_outcomes": ("intervention_events", "intervention_group_size",
                        "comparator_events", "comparator_group_size"),
    "continuous_outcomes": ("intervention_mean", "intervention_standard_deviation",
                            "intervention_group_size", "comparator_mean",
                            "comparator_standard_deviation", "comparator_group_size"),
}
TYPES = {"binary_outcomes": "binary", "continuous_outcomes": "continuous"}
COMMA_NUMBER = re.compile(r"\d{1,3}(,\d{3})+(\.\d+)?", re.ASCII)
STATES = ("value", "multiple_values", "not_reported", "not_returned", "run_failed")


def load_json(file):
    return json.loads(Path(file).read_text(encoding="utf-8"))


def sha256(file):
    return hashlib.sha256(Path(file).read_bytes()).hexdigest()


def gold_value(value, comma_normalized=False):
    if value is None or value == "":
        return "x"
    if comma_normalized and isinstance(value, str) and COMMA_NUMBER.fullmatch(value):
        text = value.replace(",", "")
        return float(text) if "." in text else int(text)
    return value


def validate_pmcids(pmcids):
    if (not isinstance(pmcids, list) or not pmcids
            or any(type(pmcid) is not int or pmcid <= 0 for pmcid in pmcids)
            or len(pmcids) != len(set(pmcids))):
        raise ValueError("PMCID は重複のない正整数の配列で指定してください")
    return sorted(pmcids)


def validate_icos(gold, icos, pmcids):
    selected = set(pmcids)
    expected = [row for row in gold if row["split"] == "TEST" and row["pmcid"] in selected]
    actual = [ico for ico in icos if ico["pmcid"] in selected]
    if (len({row["id"] for row in expected}) != len(expected)
            or len({ico["id"] for ico in actual}) != len(actual)
            or {row["id"] for row in expected} != {ico["id"] for ico in actual}):
        raise ValueError("gold と records の ICO id 集合が一致しません")
    if {row["pmcid"] for row in expected} != selected or {ico["pmcid"] for ico in actual} != selected:
        raise ValueError("指定された RCT が gold / records にありません")
    by_id = {ico["id"]: ico for ico in actual}
    for row in expected:
        ico = by_id[row["id"]]
        if ico["pmcid"] != row["pmcid"] or ico["outcomeType"] != row["outcome_type"]:
            raise ValueError("ICO の RCT または課題が一致しません")
    return expected, by_id


def point_estimate(row, task, utils, suffix=""):
    def v(field):
        return row[field + suffix]
    if task == "binary_outcomes":
        return utils.calculate_log_odds_ratio(
            v("intervention_events"), v("comparator_events"),
            v("intervention_group_size"), v("comparator_group_size"))[0]
    return utils.calculate_standardized_mean_difference(
        v("intervention_mean"), v("comparator_mean"),
        v("intervention_standard_deviation"), v("comparator_standard_deviation"),
        v("intervention_group_size"), v("comparator_group_size"))[0]


def build_record(row, outputs, task, utils, comma_normalized=False):
    # 出力列は課題の列と点推定に限定する。上流は列名から比較対象を発見する。
    record = {key: value for key, value in row.items() if "_output" not in key}
    for field in FIELDS[task]:
        record[field] = gold_value(row[field], comma_normalized)
        record[field + "_output"] = outputs[field]
    estimate = "log_odds_ratio" if task == "binary_outcomes" else "standardized_mean_difference"
    record[estimate] = point_estimate(record, task, utils)
    record[estimate + "_output"] = point_estimate(record, task, utils, "_output")
    return record


def validate_draws(data, pmcids):
    expected = validate_pmcids(pmcids)
    if data["pmcids"] != expected:
        raise ValueError("draws の PMCID 順序・集合が採点集合と一致しません")
    if (type(data["replicates"]) is not int or data["replicates"] <= 0
            or len(data["draws"]) != data["replicates"]):
        raise ValueError("draws の反復数が不正です")
    for draw in data["draws"]:
        if (len(draw) != len(expected)
                or any(type(index) is not int or not 0 <= index < len(expected) for index in draw)):
            raise ValueError("draws の添字が不正です")


def concatenate_draw(by_pmcid, pmcids, draw):
    return [record for index in draw for record in by_pmcid.get(pmcids[index], [])]


def calculate(calculator, records):
    with contextlib.redirect_stdout(io.StringIO()):
        return calculator.calculate_metrics(records)


def bootstrap(records, data, calculator_class, task):
    import numpy as np
    by_pmcid = {}
    for row in records:
        by_pmcid.setdefault(row["pmcid"], []).append(row)
    totals = []
    skipped = 0
    for draw in data["draws"]:
        sample = concatenate_draw(by_pmcid, data["pmcids"], draw)
        if not sample:
            skipped += 1
            continue
        with contextlib.redirect_stdout(io.StringIO()):
            calculator = calculator_class(task)
        # 主指標（完全一致の total）だけを上流の同じ計算で求める。calculate_metrics 全体は、
        # 復元抽出で点推定を計算できる ICO が無い回に別の指標で 0 除算になるため使わない。
        with contextlib.redirect_stdout(io.StringIO()):
            exact = calculator._MetricsCalculator__calculate_exact_match_accuracy(sample)
        totals.append(exact["total"])
    lower, upper = (np.quantile(totals, [0.025, 0.975]).tolist() if totals else (None, None))
    return {"replicates": len(totals), "skipped": skipped, "lower": lower, "upper": upper}


def extra_counts(rows, by_id, task):
    def empty():
        return {"states": dict.fromkeys(STATES, 0), "comma_dependent_matches": 0, "x_answers": 0}
    per_field = {field: empty() for field in FIELDS[task]}
    total = empty()
    for row in rows:
        for field in FIELDS[task]:
            answer = by_id[row["id"]]["fields"][field]
            for counts in (per_field[field], total):
                counts["states"][answer["state"]] += 1
                counts["comma_dependent_matches"] += int(answer["value"] == row[field] and answer["valueNoComma"] != row[field])
                counts["x_answers"] += int(answer["value"] == "x")
    return {"fields": per_field, "total": total}


def score_file(document, gold, pmcids, draws, calculator_class, utils, comma_normalized):
    expected, by_id = validate_icos(gold, document["icos"], pmcids)
    results = []
    for task, outcome_type in TYPES.items():
        rows = [row for row in expected if row["outcome_type"] == outcome_type]
        if not rows:
            continue
        with contextlib.redirect_stdout(io.StringIO()):
            records = [build_record(row, {field: by_id[row["id"]]["fields"][field]["value"]
                                          for field in FIELDS[task]}, task, utils, comma_normalized) for row in rows]
            calculator = calculator_class(task)
        results.append({"model": document["model"], "condition": document["condition"], "task": task,
                        "nIcos": len(records), "nRcts": len({row["pmcid"] for row in records}),
                        "metrics": calculate(calculator, records),
                        "extraCounts": extra_counts(records, by_id, task),
                        "bootstrap": bootstrap(records, draws, calculator_class, task)})
    return results


def upstream(root):
    sys.path.insert(0, str(root / "evaluation"))
    with contextlib.redirect_stdout(io.StringIO()):
        metrics = importlib.import_module("calculate_metrics")
        utils = importlib.import_module("utils")
    return metrics.MetricsCalculator, utils


def gpt4_preprocessed(root, task):
    """公開 GPT-4 出力を上流の前処理に通し、前処理済みのレコード配列を返す。"""
    import tempfile
    module = importlib.import_module("evaluate_output")
    file = root / "evaluation" / "outputs" / task / f"gpt4_{task}_test_output.json"
    # 上流の引数は (task, output_path, metrics_path, pmc_files_path=None)。指標は書かないので一時フォルダを渡す。
    with tempfile.TemporaryDirectory() as metrics_dir:
        evaluator = module.MetaAnalysisTaskEvaluator(task, str(file), metrics_dir)
        getattr(evaluator, f"_MetaAnalysisTaskEvaluator__preprocess_{task}_results")()
    return evaluator.data


def selftest(root, calculator_class, utils):
    gold = load_json(root / "evaluation/data/annotated_rct_dataset.json")
    passed = True
    # 上流の相対パスは evaluation を基準に解決する。
    import os
    previous = Path.cwd()
    try:
        os.chdir(root / "evaluation")
        for task, outcome_type in TYPES.items():
            with contextlib.redirect_stdout(io.StringIO()):
                processed = gpt4_preprocessed(root, task)
                if not isinstance(processed, list):
                    raise ValueError("上流の前処理がレコード配列を返しませんでした")
                rows = [row for row in gold if row["split"] == "TEST" and row["outcome_type"] == outcome_type]
                by_id = {row["id"]: row for row in processed}
                if len(by_id) != len(processed) or set(by_id) != {row["id"] for row in rows}:
                    raise ValueError("GPT-4 前処理の ICO id 集合が一致しません")
                # 上流の出力ファイルと同じ並びで組み立てる（点推定の誤差の和が並びで末尾桁だけ変わるため）。
                gold_by_id = {row["id"]: row for row in rows}
                records = [build_record(gold_by_id[row["id"]], {field: row[field + "_output"]
                                             for field in FIELDS[task]}, task, utils) for row in processed]
                actual = json.loads(json.dumps(calculate(calculator_class(task), records)))
            expected = load_json(root / "evaluation/metrics" / task / f"gpt4_{task}_test_output_metrics.json")
            ok = actual == expected
            print(f"{'PASS' if ok else 'FAIL'} {task}")
            passed = passed and ok
    finally:
        os.chdir(previous)
    return passed


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--yun-root", required=True, type=Path)
    parser.add_argument("--records", action="append", type=Path)
    parser.add_argument("--draws", type=Path)
    parser.add_argument("--out", type=Path)
    parser.add_argument("--pmcids", type=Path)
    parser.add_argument("--gold-comma-normalized", action="store_true")
    parser.add_argument("--selftest-gpt4", action="store_true")
    args = parser.parse_args(argv)
    root = args.yun_root.resolve()
    calculator_class, utils = upstream(root)
    if args.selftest_gpt4:
        return 0 if selftest(root, calculator_class, utils) else 1
    if not args.records or not args.draws or not args.out:
        parser.error("--records、--draws、--out が必要です")
    gold_file = root / "evaluation/data/annotated_rct_dataset.json"
    gold, draws = load_json(gold_file), load_json(args.draws)
    sets = []
    for file in args.records:
        document = load_json(file)
        pmcids = validate_pmcids(load_json(args.pmcids) if args.pmcids else list({ico["pmcid"] for ico in document["icos"]}))
        validate_draws(draws, pmcids)
        sets.extend(score_file(document, gold, pmcids, draws, calculator_class, utils, args.gold_comma_normalized))
    def single_or_list(values):
        return values[0] if len(values) == 1 else values
    result = {"yunCommit": subprocess.check_output(["git", "-C", str(root), "rev-parse", "HEAD"], text=True).strip(),
              "goldSha256": sha256(gold_file),
              "recordsFile": single_or_list([str(file) for file in args.records]),
              "recordsSha256": single_or_list([sha256(file) for file in args.records]),
              "drawsFile": str(args.draws), "drawsSha256": sha256(args.draws),
              "goldCommaNormalized": args.gold_comma_normalized, "sets": sets}
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
