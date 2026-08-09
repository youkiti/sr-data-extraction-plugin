// Google API 失敗の診断ログ（issue #249）。
//
// 背景: 「特定の文献だけ PDF が表示されない・判定しても記録が残らない」という問い合わせに対し、
// シートの実データからは「その時間帯に判定が書けていない」ことまでしか分からず、原因
// （403/429 クォータ・503 過負荷・401 トークン・404 未許可・ネットワーク遮断のいずれか）を
// 特定できなかった。googleFetch（lib/google/types.ts）は非 2xx を GoogleApiError に変換して
// 画面には答えを出しているが、拡張側に失敗の永続記録が無いため、ユーザーが復旧を待って画面を
// 閉じると何も残らない。本モジュールは Google API 呼び出しの失敗を `ApiErrorLog` タブへ記録し、
// プロジェクト管理者がレビュアーの端末に触れずシートだけで原因を確定できるようにする。
//
// レイヤ制約（重要）: `lib/` は `features/` を import できない（import/no-restricted-paths。
// architecture.md §2.1）。計装対象の getFileBinary が lib/google/drive.ts にあるため、本モジュールも
// lib 層に置く必要がある。そのため「タブが無ければ書き込み時に自動作成する」パターン
// （features/project/reviewerRepository.ts の appendReviewerAssignment が手本）を features 側へ
// 委譲できず、lib/google/sheets.ts の関数を直接使ってこのファイル内に複製している。
//
// 自己再帰の防止（重要）: ApiErrorLog タブへの書き込み自体が失敗しても、その失敗は記録しない。
// flushApiErrorLogQueue は lib/google/sheets.ts の関数を直接呼び、失敗時はローカルキューへ残す
// だけで recordApiErrorLog を呼び返さない（無限ループ・キュー膨張の防止。要件2）。
//
// 並行性（重要。レビュー指摘で追加）: withApiErrorLogging は成功のたびに flush を撃ち、
// 1 操作の中で appendDecisionRows → upsertStudyDataRows/upsertResultsDataRows のように複数の
// 計装対象が連続して走る経路もあるため、record 同士・flush 同士・record と flush が日常的に
// 重なる。素朴な「read → 変更 → write」だと (1) flush の appendRows 待ち中に積まれたエントリが
// 古いスナップショットの書き戻しで消える (2) flush が多重実行されて同じ行が二重に書かれる
// (3) record 同士が競合して片方が消える、の 3 つの欠陥が起きる。これを防ぐため、キューへの
// すべての読み書きを withQueueLock でモジュールレベルの promise チェーンへ直列化し、
// flush 自体にも single-flight ガード（inFlightFlush）を掛ける
import type { ApiErrorLogContext, ApiErrorLogEntry } from '../../domain/apiErrorLog';
import { SHEET_HEADERS } from '../../domain/sheetsSchema';
import { nowIso8601 } from '../../utils/iso8601';
import { generateUuid } from '../../utils/uuid';
import { addSheetTab, appendRows, getSheetTitles, writeHeaderRow } from '../google/sheets';
import { GoogleApiError, type GoogleApiDeps } from '../google/types';
import { getLocal, setLocal } from '../storage/chromeStorage';
import { apiNameFromEndpoint } from './apiName';

const API_ERROR_LOG_TAB = 'ApiErrorLog';

/** ローカル退避キュー（chrome.storage.local）の保存キー。1 拡張インスタンスにつき単一 */
const LOCAL_QUEUE_KEY = 'apiErrorLogQueue';

/** ローカルキューの上限件数。超えたら古い方から捨てる（無制限に溜め続けない。要件1） */
export const API_ERROR_LOG_QUEUE_LIMIT = 200;

/** message 列の打ち切り長。GoogleApiError.responseBody を含みうるため上限を決めておく（要件4） */
export const API_ERROR_LOG_MESSAGE_MAX_LENGTH = 500;

/** 1 回の flush で ApiErrorLog へ書く行数の上限（プロジェクトあたりの無制限な行数増加を防ぐ。要件6） */
export const API_ERROR_LOG_FLUSH_BATCH_LIMIT = 50;

/** app/bootstrap.ts がプロジェクト選択時に設定する記録先 */
export interface ApiErrorLogConfig {
  spreadsheetId: string;
  /** サインイン中のメール。annotator と同じ値 */
  loggedBy: string;
  appVersion: string;
  google: GoogleApiDeps;
}

let config: ApiErrorLogConfig | null = null;

/**
 * 記録先を設定する。null を渡すと未設定に戻す（プロジェクト未選択・テストのリセット用）。
 * 未設定のままでも recordApiErrorLog はローカルキューへ積む（フラッシュだけ行わない。要件「未設定でも壊れない」）
 */
export function configureApiErrorLog(next: ApiErrorLogConfig | null): void {
  config = next;
}

async function loadQueue(): Promise<ApiErrorLogEntry[]> {
  return (await getLocal<ApiErrorLogEntry[]>(LOCAL_QUEUE_KEY)) ?? [];
}

async function saveQueue(items: readonly ApiErrorLogEntry[]): Promise<void> {
  await setLocal(LOCAL_QUEUE_KEY, items.slice());
}

/**
 * キュー変更（loadQueue → 変更 → saveQueue の組）を直列化するための待ち行列。
 * `withQueueLock` はこの promise の末尾に自分の処理をつなげ、末尾を自分の処理へ差し替える。
 * 前段が失敗しても鎖が切れないよう、チェーン自体は常に成功（undefined）で継続させる
 * （個々の呼び出し側へのエラー伝播は withQueueLock の戻り値 `run` が担う）
 */
let queueChain: Promise<unknown> = Promise.resolve();

/**
 * fn を「直前にキューへ加えられた操作がすべて終わってから」実行する（F1/F3 対策）。
 * fn の中では chrome.storage.local の読み書き（loadQueue/saveQueue）だけを行うこと。
 * ネットワーク呼び出し（ensureApiErrorLogTab / appendRows）は絶対にここへ入れない —
 * 本業と無関係な待ちでキュー操作全体が塞がれ、record が長時間ブロックされてしまうため
 */
function withQueueLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = queueChain.then(fn, fn);
  queueChain = run.catch(() => undefined);
  return run;
}

function truncateMessage(message: string): string {
  return message.length > API_ERROR_LOG_MESSAGE_MAX_LENGTH
    ? message.slice(0, API_ERROR_LOG_MESSAGE_MAX_LENGTH)
    : message;
}

interface ClassifiedError {
  httpStatus: number | null;
  message: string;
  retryCount: number;
}

/**
 * error から ApiErrorLog へ記録する情報を取り出す。
 * - GoogleApiError: HTTP ステータス・再試行回数を保持する。message は
 *   `${error.message}: ${responseBody}`（responseBody は Google 側のエラー説明文。
 *   アクセストークン・Authorization ヘッダ・リクエストボディは一切含まれない）を truncate する
 * - それ以外（fetch 自体が reject するネットワーク層の失敗等）は httpStatus を null にする（要件どおり）
 */
function classifyError(error: unknown): ClassifiedError {
  if (error instanceof GoogleApiError) {
    const detail = error.responseBody ? `: ${error.responseBody}` : '';
    return {
      httpStatus: error.status,
      message: truncateMessage(`${error.message}${detail}`),
      retryCount: error.retryCount,
    };
  }
  const message = error instanceof Error ? error.message : String(error);
  return { httpStatus: null, message: truncateMessage(message), retryCount: 0 };
}

export interface RecordApiErrorLogInput {
  context: ApiErrorLogContext;
  error: unknown;
  studyId?: string | null;
  documentId?: string | null;
  /** テスト用に固定する seam。既定は crypto.randomUUID */
  newUuid?: () => string;
  /** テスト用に固定する seam。既定は現在時刻の ISO 8601 */
  now?: () => string;
}

/**
 * Google API 呼び出しの失敗を記録する（fire-and-forget）。
 * - まずローカルのリングバッファへ積む（上限を超えたら古い方から捨てる）
 * - 記録先（configureApiErrorLog）が設定済みなら、続けてフラッシュを試みる
 * - 本処理は決して例外を投げない（呼び出し元の catch から `void` で呼ぶ想定。
 *   ログの失敗・遅延で本業の判定保存・PDF 表示を止めないため。要件5）
 */
export function recordApiErrorLog(input: RecordApiErrorLogInput): void {
  void recordApiErrorLogAsync(input).catch(() => {
    // chrome.storage.local が例外を投げるような極端な状況でも、呼び出し元へは伝播させない保険
  });
}

async function recordApiErrorLogAsync(input: RecordApiErrorLogInput): Promise<void> {
  const uuid = input.newUuid ?? generateUuid;
  const now = input.now ?? nowIso8601;
  const { httpStatus, message, retryCount } = classifyError(input.error);
  const endpoint = input.error instanceof GoogleApiError ? input.error.endpoint : null;

  const entry: ApiErrorLogEntry = {
    logId: uuid(),
    occurredAt: now(),
    loggedBy: config?.loggedBy ?? '',
    context: input.context,
    api: endpoint !== null ? apiNameFromEndpoint(endpoint) : 'unknown',
    httpStatus,
    message,
    studyId: input.studyId ?? null,
    documentId: input.documentId ?? null,
    retryCount,
    appVersion: config?.appVersion ?? '',
  };

  // 追記はキューロックの中で行う（F3 対策）: record 同士が並行して走っても
  // 「読む → 加える → 書く」が丸ごと直列化され、片方の追記が消えることはない
  await withQueueLock(async () => {
    const queue = await loadQueue();
    // 古い方から捨てるリングバッファ（末尾が最新）。slice(-N) で先頭超過分を落とす
    const next = [...queue, entry].slice(-API_ERROR_LOG_QUEUE_LIMIT);
    await saveQueue(next);
  });

  if (config) {
    await flushApiErrorLogQueue();
  }
}

/** ApiErrorLogEntry → シート行。列順は SHEET_HEADERS.ApiErrorLog（domain/sheetsSchema.ts）に対応 */
function entryToRow(entry: ApiErrorLogEntry): (string | number | null)[] {
  return [
    entry.logId,
    entry.occurredAt,
    entry.loggedBy,
    entry.context,
    entry.api,
    entry.httpStatus,
    entry.message,
    entry.studyId,
    entry.documentId,
    entry.retryCount,
    entry.appVersion,
  ];
}

/**
 * ApiErrorLog タブが無ければ作成する（Reviewers と同じ自動作成パターン。
 * features/project/reviewerRepository.ts の appendReviewerAssignment を参照。lib からは
 * features を import できないためロジックをここに複製している）
 */
async function ensureApiErrorLogTab(spreadsheetId: string, google: GoogleApiDeps): Promise<void> {
  const titles = await getSheetTitles(spreadsheetId, google);
  if (!titles.includes(API_ERROR_LOG_TAB)) {
    await addSheetTab(spreadsheetId, API_ERROR_LOG_TAB, google);
    await writeHeaderRow(spreadsheetId, API_ERROR_LOG_TAB, SHEET_HEADERS.ApiErrorLog, google);
  }
}

export interface FlushApiErrorLogResult {
  flushedCount: number;
  remainingCount: number;
}

/**
 * 実行中の flush（あれば）。single-flight ガード（F2 対策）: 呼び出しが重なったときに
 * 同じ batch を 2 回 appendRows してしまう（ApiErrorLog への重複行 + 書き込みクォータの浪費）のを防ぐ。
 * 新しい呼び出しは新たに fetch を起こさず、進行中の Promise へ合流させる方式を選んだ
 * （「何もせず返す」も検討したが、それだと recordApiErrorLogAsync の
 * `if (config) { await flushApiErrorLogQueue(); }` が「フラッシュを試みたのに実際には
 * 何もしていない」という誤解を生む。合流方式なら呼び出し元は常に実際の flush 結果を受け取れる）
 */
let inFlightFlush: Promise<FlushApiErrorLogResult> | null = null;

/**
 * ローカルキューを ApiErrorLog タブへ書き出す。古い順に最大 API_ERROR_LOG_FLUSH_BATCH_LIMIT 件だけ
 * 1 回の appendRows にまとめ、成功した分だけキューから除く（要件6）。
 * 失敗時（= まだ Sheets に書けない）はキューをそのまま残し、次回の flush 呼び出しで再試行する。
 *
 * 重要: この関数内で起きた失敗は recordApiErrorLog を呼ばない（自己再帰の防止。要件2）。
 * 未設定（configureApiErrorLog 未呼び出し）なら何もフラッシュしない（flushedCount は常に 0）が、
 * remainingCount にはローカルキューの実件数を返す（「未設定 = 記録が消えている」わけではないことを
 * 呼び出し側が確認できるようにするため）
 */
export async function flushApiErrorLogQueue(): Promise<FlushApiErrorLogResult> {
  if (!config) {
    return { flushedCount: 0, remainingCount: (await loadQueue()).length };
  }
  if (inFlightFlush) {
    return inFlightFlush;
  }
  const activeConfig = config;
  const run = runFlush(activeConfig);
  inFlightFlush = run.finally(() => {
    inFlightFlush = null;
  });
  return inFlightFlush;
}

/**
 * flushApiErrorLogQueue の実処理。batch の選定はロック外の読み取り（他の record を長時間
 * ブロックしないため）、appendRows も当然ロック外（ネットワーク往復をキューロックへ入れない）。
 * 送信できた分をキューから除く最終ステップだけ withQueueLock で直列化し、appendRows の待ちの
 * 間に record された分をキューへ読み直して残す（F1 対策: logId で除外するため、batch 選定後に
 * 積まれた新規エントリは対象に含まれず失われない）
 */
async function runFlush(activeConfig: ApiErrorLogConfig): Promise<FlushApiErrorLogResult> {
  const queue = await loadQueue();
  if (queue.length === 0) {
    return { flushedCount: 0, remainingCount: 0 };
  }
  const batch = queue.slice(0, API_ERROR_LOG_FLUSH_BATCH_LIMIT);
  try {
    await ensureApiErrorLogTab(activeConfig.spreadsheetId, activeConfig.google);
    await appendRows(
      activeConfig.spreadsheetId,
      API_ERROR_LOG_TAB,
      batch.map(entryToRow),
      activeConfig.google,
    );
  } catch {
    // Sheets へまだ書けない（本業も落ちている可能性が高い状態）。キューはそのまま残し、
    // 次に記録対象の API 呼び出しが成功したタイミングで再試行する。このエラー自体は記録しない
    return { flushedCount: 0, remainingCount: (await loadQueue()).length };
  }
  const flushedIds = new Set(batch.map((entry) => entry.logId));
  const remainingCount = await withQueueLock(async () => {
    const latest = await loadQueue();
    const remaining = latest.filter((entry) => !flushedIds.has(entry.logId));
    await saveQueue(remaining);
    return remaining.length;
  });
  return { flushedCount: batch.length, remainingCount };
}

export interface WithApiErrorLoggingOptions {
  studyId?: string | null;
  documentId?: string | null;
  /**
   * true を返したときだけ ApiErrorLog へ記録する（既定は常に記録する）。
   * AnnotationConflictError のような「Google API 障害ではないアプリ内の業務エラー」を
   * 除外したい呼び出し側だけ渡す（features/extraction/annotationRepository.ts 参照）
   */
  shouldLog?: (error: unknown) => boolean;
}

/**
 * 計装ヘルパ: fn を実行し、
 * - 成功したら（直近の失敗をローカルに抱えている可能性があるため）flush を試みてから結果を返す
 *   （fire-and-forget。ここで await すると本業のレスポンスが遅れるため待たない）
 * - 失敗したら recordApiErrorLog で記録してから、元のエラーをそのまま rethrow する（要件5）
 *
 * lib/google/drive.ts の getFileBinary、features/**Repository.ts の appendEvidenceRows /
 * appendDecisionRows / upsertStudyDataRows / upsertResultsDataRows が使う共通の計装 seam
 */
export async function withApiErrorLogging<T>(
  context: ApiErrorLogContext,
  options: WithApiErrorLoggingOptions,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    const result = await fn();
    void flushApiErrorLogQueue();
    return result;
  } catch (error) {
    if (options.shouldLog?.(error) ?? true) {
      recordApiErrorLog({
        context,
        error,
        studyId: options.studyId ?? null,
        documentId: options.documentId ?? null,
      });
    }
    throw error;
  }
}
