// ベンチマークの定数一元管理（IMPLEMENTATION.md §5）。runner / score / extractText で共有する。
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** extraction-benchmark/ ディレクトリの絶対パス（src/config.ts の 2 つ上） */
export const benchRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
/** リポジトリルート（tests/fixtures/pdf などの解決に使う） */
export const repoRoot = path.resolve(benchRoot, '../..');

/** 対象論文（README §6.1）。file は tests/fixtures/pdf/ 配下の実ファイル名 */
export const TARGETS = [
  { pdfId: 'udca', file: 'PMC10715657_plosone_udca_rct.pdf' },
  { pdfId: 'thermocov', file: 'PMC10766786_frontmed_thermocov_rct.pdf' },
] as const;

/**
 * 比較対象モデル（README §3）。
 * 2026-07-05 に公式ドキュメント / 料金ページでスナップショット ID と実行時単価を確認済み:
 * - gemini-3.5-flash: 公式に日付付き callable スナップショット ID は列挙されていない（内部版数は 05-2026）。
 *   README §3 のフォールバックに従いエイリアス ID のまま使用し、実行日時を runs JSON に記録する。単価 $1.50 / $9.00。
 * - gemini-3.1-flash-lite: GA 版。callable スナップショット ID は未列挙 → エイリアスのまま。単価 $0.25 / $1.50（text）。
 * - qwen/qwen3-235b-a22b-2507: 既に固定版（Instruct 2507）。単価 $0.09 / $0.10。
 * 単価は src/lib/llm/pricing.ts に反映済み（本表の id と MODEL_PRICING のキーは一致）。
 * keyEnv を明示することで createProvider の自動 provider 解決と .env のキー対応がずれない。
 */
export const MODELS = [
  { id: 'gemini-3.5-flash', keyEnv: 'GEMINI_API_KEY' },
  { id: 'gemini-3.1-flash-lite', keyEnv: 'GEMINI_API_KEY' },
  { id: 'qwen/qwen3-235b-a22b-2507', keyEnv: 'OPENROUTER_API_KEY' },
] as const;

/** 反復回数（README §7。temperature 0 でも応答は揺れるため 3 反復をプールする） */
export const REPEATS = 3;
