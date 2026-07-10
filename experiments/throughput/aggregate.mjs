#!/usr/bin/env node
// 一括抽出のスループット実測 集計スクリプト（docs/handoff-20260710-throughput.md §4 / §5）。
//
// Sheets から落とした CSV（LLMApiLog / ExtractionRuns）を食わせると、
// 完了 run ごとに「実効スループット / レイテンシ p50・p90・max / 入力 TPM / 429 率」を集計する。
// LLMApiLog には run_id 列が無いため、ExtractionRuns の [started_at, finished_at] の
// 時間窓で extract_study のログ行を run に割り当てる（time-window join）。
//
// 使い方:
//   node experiments/throughput/aggregate.mjs \
//     --llmlog data/llmapilog.csv --runs data/extractionruns.csv [--labels data/labels.json]
//
//   - --llmlog: LLMApiLog タブを CSV で書き出したもの（必須）
//   - --runs:   ExtractionRuns タブを CSV で書き出したもの（省略時は全 extract_study ログの
//               レイテンシ / トークン / 429 の全体分布だけを出す）
//   - --labels: {"<run_id>": "<ラベル>"} の JSON（例 {"abc-123":"concurrency=4"}）。任意。
//               同時実行数 1→2→4→8 の各 run にラベルを付けると出力が読みやすくなる。
//
// 依存なし・Node 18+（ESM）。列名は正規化（小文字化 + 英数字以外を除去）して解決するため、
// ヘッダの表記ゆれ（latency_ms / latencyMs / "Latency (ms)"）を吸収する。
import { readFileSync } from 'node:fs';

/** RFC 4180 準拠の最小 CSV パーサ（クオート・エスケープ・改行含みフィールド対応） */
function parseCsv(text) {
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1); // BOM 除去
  }
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += c;
      i += 1;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (c === ',') {
      row.push(field);
      field = '';
      i += 1;
      continue;
    }
    if (c === '\r') {
      i += 1;
      continue;
    }
    if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i += 1;
      continue;
    }
    field += c;
    i += 1;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const normalizeHeader = (h) => h.toLowerCase().replace(/[^a-z0-9]/g, '');

/** ヘッダ行から「正規化名 → 列インデックス」の引き当て器を作る */
function makeTable(rows) {
  const header = (rows[0] ?? []).map(normalizeHeader);
  const data = rows.slice(1).filter((r) => r.some((cell) => cell.trim() !== ''));
  const indexOf = (name) => header.indexOf(normalizeHeader(name));
  const pick = (r, name) => {
    const idx = indexOf(name);
    return idx >= 0 ? (r[idx] ?? '') : '';
  };
  return { data, indexOf, pick };
}

/** 昇順ソート済み配列の最近接順位パーセンタイル */
function percentile(sortedAsc, p) {
  if (sortedAsc.length === 0) {
    return null;
  }
  const rank = Math.ceil((p / 100) * sortedAsc.length);
  return sortedAsc[Math.min(sortedAsc.length - 1, Math.max(0, rank - 1))];
}

const num = (s) => {
  const v = Number(String(s).trim());
  return Number.isFinite(v) ? v : null;
};
const ms = (iso) => {
  const t = Date.parse(String(iso).trim());
  return Number.isFinite(t) ? t : null;
};

/** study_ids セル（JSON 配列 / カンマ / 空白 / パイプ区切りのいずれか）を件数へ */
function studyCount(cell) {
  const raw = String(cell).trim();
  if (raw === '') {
    return 0;
  }
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((x) => String(x).trim() !== '').length;
    }
  } catch {
    // JSON でなければ区切り文字で分割
  }
  return raw
    .split(/[,|\s]+/)
    .map((x) => x.trim())
    .filter((x) => x !== '' && x !== '[]').length;
}

const is429 = (err) => {
  const e = String(err);
  return /429|resource_exhausted|too many requests/i.test(e);
};

/** extract_study のログ 1 群からレイテンシ / トークン / 429 の要約を作る */
function summarizeLogs(logs) {
  const latencies = logs
    .map((l) => l.latencyMs)
    .filter((v) => v !== null)
    .sort((a, b) => a - b);
  const errorLogs = logs.filter((l) => l.error !== '');
  return {
    calls: logs.length,
    latP50: percentile(latencies, 50),
    latP90: percentile(latencies, 90),
    latMax: latencies.length ? latencies[latencies.length - 1] : null,
    tokensInSum: logs.reduce((s, l) => s + (l.tokensIn ?? 0), 0),
    tokensOutSum: logs.reduce((s, l) => s + (l.tokensOut ?? 0), 0),
    tokensInAvg: logs.length
      ? Math.round(logs.reduce((s, l) => s + (l.tokensIn ?? 0), 0) / logs.length)
      : null,
    errors: errorLogs.length,
    errors429: errorLogs.filter((l) => is429(l.error)).length,
  };
}

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('--')) {
      args[a.slice(2)] = argv[i + 1];
      i += 1;
    }
  }
  return args;
}

function fmt(v, digits = 0) {
  if (v === null || v === undefined) {
    return '—';
  }
  return typeof v === 'number' ? v.toFixed(digits) : String(v);
}

/** 表示幅（全角 CJK・全角記号は 2、それ以外は 1）。CSV 列そろえ用 */
function displayWidth(s) {
  let w = 0;
  for (const ch of String(s)) {
    const code = ch.codePointAt(0);
    const wide =
      (code >= 0x1100 && code <= 0x115f) ||
      (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe30 && code <= 0xfe4f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6) ||
      code === 0x2014; // —（全角ダッシュ）
    w += wide ? 2 : 1;
  }
  return w;
}

/** 表示幅に合わせて左側を空白詰め（右寄せ） */
function padStartW(s, width) {
  return ' '.repeat(Math.max(0, width - displayWidth(s))) + s;
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.llmlog) {
    console.error(
      'usage: node experiments/throughput/aggregate.mjs --llmlog <LLMApiLog.csv> [--runs <ExtractionRuns.csv>] [--labels <labels.json>]',
    );
    process.exit(1);
  }

  const llm = makeTable(parseCsv(readFileSync(args.llmlog, 'utf8')));
  const logs = llm.data
    .map((r) => ({
      timestamp: ms(llm.pick(r, 'timestamp')),
      purpose: normalizeHeader(llm.pick(r, 'purpose')),
      tokensIn: num(llm.pick(r, 'tokens_in')),
      tokensOut: num(llm.pick(r, 'tokens_out')),
      latencyMs: num(llm.pick(r, 'latency_ms')),
      error: String(llm.pick(r, 'error')).trim(),
    }))
    // 抽出の呼び出しだけを対象にする（draft_schema 等は除外）
    .filter((l) => l.purpose === 'extractstudy');

  console.log(`\n=== LLMApiLog: extract_study の呼び出し ${logs.length} 件（全体） ===`);
  const overall = summarizeLogs(logs);
  console.log(
    `レイテンシ p50/p90/max = ${fmt(overall.latP50)} / ${fmt(overall.latP90)} / ${fmt(
      overall.latMax,
    )} ms ｜ 入力トークン平均 = ${fmt(overall.tokensInAvg)} ｜ エラー ${overall.errors}（うち 429: ${
      overall.errors429
    }）`,
  );

  if (!args.runs) {
    console.log('\n（--runs を渡すと run 別の実効スループット / TPM も集計します）\n');
    return;
  }

  const labels = args.labels ? JSON.parse(readFileSync(args.labels, 'utf8')) : {};
  const runsTable = makeTable(parseCsv(readFileSync(args.runs, 'utf8')));
  // 2 行プロトコル: run_id ごとに finished_at のある完了行を採用する
  const completed = new Map();
  for (const r of runsTable.data) {
    const runId = String(runsTable.pick(r, 'run_id')).trim();
    const finishedAt = ms(runsTable.pick(r, 'finished_at'));
    if (runId === '' || finishedAt === null) {
      continue; // running 行（finished_at 空）はスキップ
    }
    completed.set(runId, {
      runId,
      label: labels[runId] ?? '',
      runType: runsTable.pick(r, 'run_type'),
      status: runsTable.pick(r, 'status'),
      model: runsTable.pick(r, 'model_version') || runsTable.pick(r, 'requested_model'),
      startedAt: ms(runsTable.pick(r, 'started_at')),
      finishedAt,
      studies: studyCount(runsTable.pick(r, 'study_ids')),
    });
  }

  const runs = [...completed.values()].sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0));
  console.log(`\n=== ExtractionRuns: 完了 run ${runs.length} 件（開始時刻順） ===\n`);

  const header = [
    'ラベル/run',
    'model',
    'status',
    'study数',
    '所要s',
    'study/分',
    '呼出',
    'p50ms',
    'p90ms',
    'maxms',
    '入力TPM',
    '429',
  ];
  const table = [header];
  for (const run of runs) {
    const durationSec =
      run.startedAt !== null ? Math.max(0, (run.finishedAt - run.startedAt) / 1000) : null;
    // 時間窓で当該 run のログを抽出（started_at ≤ timestamp ≤ finished_at）
    const windowLogs = logs.filter(
      (l) =>
        l.timestamp !== null &&
        run.startedAt !== null &&
        l.timestamp >= run.startedAt &&
        l.timestamp <= run.finishedAt,
    );
    const s = summarizeLogs(windowLogs);
    const durationMin = durationSec !== null && durationSec > 0 ? durationSec / 60 : null;
    const studiesPerMin = durationMin ? run.studies / durationMin : null;
    const inputTpm = durationMin ? Math.round(s.tokensInSum / durationMin) : null;
    table.push([
      run.label || run.runId.slice(0, 8),
      String(run.model || '—'),
      String(run.status),
      String(run.studies),
      fmt(durationSec, 1),
      fmt(studiesPerMin, 2),
      String(s.calls),
      fmt(s.latP50),
      fmt(s.latP90),
      fmt(s.latMax),
      fmt(inputTpm),
      String(s.errors429),
    ]);
  }

  // 列幅をそろえて出力（全角 CJK を 2 幅として計算）
  const widths = header.map((_, c) => Math.max(...table.map((row) => displayWidth(row[c]))));
  for (const row of table) {
    console.log(row.map((cell, c) => padStartW(cell, widths[c])).join('  '));
  }
  console.log(
    '\nヒント: 同時実行数を 1→2→4→8 と変えた各 run に --labels でラベルを付けると比較しやすいです。',
  );
  console.log(
    '判断材料: study/分 が伸びても 429 が増え partial_failure（status）が出る水準の 1 つ手前が「安全な同時実行数」。\n',
  );
}

main();
