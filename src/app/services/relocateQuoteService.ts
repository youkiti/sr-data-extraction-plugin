// relocate-quote skill（issue #94）のオーケストレーション: anchor_status = 'failed' の
// Evidence 1 件を LLM で再特定する。S6 埋め込み検証パネル / S8 単独画面の双方が呼ぶ
// （pilotService.persistPilotRelocateQuote / verifyService.persistVerifyRelocateQuote の
// 薄いラッパ経由。store 依存はそちら側に閉じ、本ファイルは spreadsheetId / Drive フォルダ /
// Evidence / SchemaField / ページ本文を引数で受け取る純粋な非同期関数として持つ）。
//
// 設計判断（Evidence 記録方式。requirements.md §3.2 Evidence 参照）:
// 新しい Evidence 行を追記し（旧行は監査残置。Evidence は追記型）、anchor_status には
// 実際の再アンカリング結果（exact/normalized/fuzzy のいずれか）をそのまま持たせる。
// 「anchor_status に 'relocated' を追加する」案は検討したが、実際のマッチ品質情報が失われ、
// features/verification/highlights.ts のハイライト描画・S9 ダッシュボードの anchor 失敗率集計
// （どちらも anchor_status の実値を見る）に手を入れる必要が生じる。代わりに新設した
// `relocated_from`（元 evidence_id）列で出所を記録する方式を採用した。新行は
// run_id/study_id/field_id/entity_key/document_id を元行と同一に保つため、
// features/verification/cells.ts の「同一セルは後勝ち」畳み込みと
// app/services/verifyService.ts の「run_id が既知 run か」判定は無改修のまま新行を正しく採用する
import type { NormalizedPage } from '../../domain/anchor';
import type { Evidence } from '../../domain/evidence';
import { t } from '../../lib/i18n';
import type { SchemaField } from '../../domain/schemaField';
import { anchorQuote } from '../../features/anchoring/anchorQuote';
import { normalizeText } from '../../features/anchoring/normalizeText';
import {
  appendEvidenceRows,
  ensureEvidenceRelocatedFromColumn,
} from '../../features/extraction/evidenceRepository';
import {
  buildRelocateQuoteUserPrompt,
  parseRelocateQuoteResponse,
  RELOCATE_QUOTE_PROMPT_VERSION,
  RELOCATE_QUOTE_RESPONSE_SCHEMA,
  RELOCATE_QUOTE_SYSTEM_PROMPT,
  selectRelocateQuoteWindow,
} from '../../features/extraction/skills/relocateQuote';
import type { ExtractDataPage } from '../../features/extraction/skills/extractData';
import { ensureChildFolder, uploadTextFile } from '../../lib/google/drive';
import type { GoogleApiDeps } from '../../lib/google/types';
import { appendLlmApiLog } from '../../lib/llm/apiLogRepository';
import { withLogging } from '../../lib/llm/apiLogger';
import type { LLMProvider } from '../../lib/llm/LLMProvider';
import { missingApiKeyMessage } from '../../lib/llm/modelCatalog';
import {
  resolveProviderConfig,
  type ProviderConfig,
  type ProviderResolutionDeps,
} from '../../lib/llm/providerFactory';
import {
  applyRateLimitPolicy,
  UNLIMITED_POLICY,
  type RateLimitPolicy,
} from '../../lib/llm/rateLimitPolicy';
import { FACTORY_DEFAULT_MODEL, loadDefaultModel } from '../../lib/storage/settingsStore';
import { generateUuid } from '../../utils/uuid';

/** 再特定は再現性優先で温度 0 に固定する（extract-data と同じ方針） */
export const RELOCATE_QUOTE_TEMPERATURE = 0;

export interface RelocateQuoteDeps extends ProviderResolutionDeps {
  google: GoogleApiDeps;
  /** provider 生成（実行時は lib/llm/providerFactory.createProvider。テストは fake を注入） */
  buildProvider: (config: ProviderConfig) => LLMProvider;
  /** 実効レート制限ポリシー（429 対策）。未注入は UNLIMITED_POLICY */
  resolveRateLimitPolicy?: () => Promise<RateLimitPolicy>;
  /** Options の既定モデル設定を解決する（未指定は lib/storage/settingsStore.loadDefaultModel） */
  loadDefaultModel?: () => Promise<string | null>;
  newUuid?: () => string;
  now?: () => string;
}

export type RelocateQuoteOutcome =
  | { status: 'relocated'; evidence: Evidence }
  | { status: 'not_found'; message?: string };

export interface RelocateQuoteParams {
  spreadsheetId: string;
  /** logs/llm/ の作成先（プロジェクトの Drive フォルダ） */
  driveFolderId: string;
  /** アンカリングに失敗した元の Evidence 行（anchor_status = 'failed' を呼び出し側で確認済みのこと） */
  evidence: Evidence;
  /** 再特定対象の項目（field_label 等をプロンプトへ提示する） */
  field: SchemaField;
  /** evidence.documentId の extracted_texts（軽量ページ。{page, text}[]）。全ページを渡すこと
   * （プロンプトへは selectRelocateQuoteWindow で絞った部分集合を渡すが、再アンカリングの検証は
   * 文書全体に対して行う方が正確なため） */
  documentPages: readonly ExtractDataPage[];
}

/**
 * relocate-quote 1 回ぶんを実行する。LLM 呼び出し → 応答の形式検証 →
 * 既存のアンカリング中核（anchorQuote）での再検証 → fuzzy 以上のときだけ Evidence 追記。
 * LLM が not_found を返した場合・応答が壊れている場合・再アンカリングが failed だった場合・
 * API キー未設定/呼び出し失敗の場合は、いずれも { status: 'not_found' } を返す
 * （1 クリック = 1 Evidence の軽量操作のため、失敗理由の細分化は行わず message に理由を残すのみ。
 * ユーザーには「本文内検索をお試しください」という従来の手動導線を案内すれば十分 — issue #94）
 */
export async function relocateQuote(
  params: RelocateQuoteParams,
  deps: RelocateQuoteDeps,
): Promise<RelocateQuoteOutcome> {
  if (params.documentPages.length === 0) {
    return { status: 'not_found', message: t('verify.noTextTitle') };
  }
  const model = (await (deps.loadDefaultModel ?? loadDefaultModel)()) ?? FACTORY_DEFAULT_MODEL;
  const providerResolution = await resolveProviderConfig(model, deps);
  if (providerResolution.config === null) {
    return { status: 'not_found', message: missingApiKeyMessage(providerResolution.provider) };
  }

  try {
    const logsFolder = await ensureChildFolder('logs', params.driveFolderId, deps.google);
    const llmFolder = await ensureChildFolder('llm', logsFolder.id, deps.google);
    const baseProvider = deps.buildProvider(providerResolution.config);
    const policy = await (deps.resolveRateLimitPolicy ?? (async () => UNLIMITED_POLICY))();
    const provider = applyRateLimitPolicy(
      withLogging(baseProvider, 'relocate_quote', {
        uploadJson: async ({ filename, content }) => {
          const file = await uploadTextFile(
            { name: filename, content, parentId: llmFolder.id, mimeType: 'application/json' },
            deps.google,
          );
          return { webViewLink: file.webViewLink };
        },
        appendLogEntry: (entry) => appendLlmApiLog(params.spreadsheetId, entry, deps.google),
        promptVersion: RELOCATE_QUOTE_PROMPT_VERSION,
        newUuid: deps.newUuid,
        now: deps.now,
      }),
      policy,
    );

    const windowPages = selectRelocateQuoteWindow(params.documentPages, params.evidence.page);
    const response = await provider.chat(
      [
        { role: 'system', content: RELOCATE_QUOTE_SYSTEM_PROMPT },
        {
          role: 'user',
          content: buildRelocateQuoteUserPrompt({
            field: params.field,
            value: params.evidence.value,
            originalQuote: params.evidence.quote,
            originalPage: params.evidence.page,
            pages: windowPages,
          }),
        },
      ],
      { temperature: RELOCATE_QUOTE_TEMPERATURE, responseSchema: RELOCATE_QUOTE_RESPONSE_SCHEMA },
    );
    const parsed = parseRelocateQuoteResponse(response.text);
    if (!parsed.found || parsed.quote === null) {
      return { status: 'not_found' };
    }

    // 再アンカリングの検証は文書全体（プロンプトへ渡した窓ではなく documentPages 全部）に対して行う。
    // プロンプトの窓はトークン節約のためであり、LLM の申告ページが実際とズレていても
    // 文書全体から正しい一致を拾えるようにする（executeRun.ts の buildEvidenceRow と同じ考え方）
    const normalizedPages: NormalizedPage[] = params.documentPages.map((page) => ({
      page: page.page,
      text: normalizeText(page.text),
    }));
    const anchor = anchorQuote(normalizeText(parsed.quote), normalizedPages, parsed.page);
    if (anchor.status === 'failed') {
      return { status: 'not_found' };
    }

    const uuid = deps.newUuid ?? generateUuid;
    const relocated: Evidence = {
      evidenceId: uuid(),
      runId: params.evidence.runId,
      studyId: params.evidence.studyId,
      fieldId: params.evidence.fieldId,
      documentId: params.evidence.documentId,
      entityKey: params.evidence.entityKey,
      // 値は変えない（再特定は quote の位置だけを直す操作）。confidence も元の値を維持する
      value: params.evidence.value,
      notReported: false,
      quote: parsed.quote,
      page: anchor.page,
      confidence: params.evidence.confidence,
      anchorStatus: anchor.status,
      bboxPage: null,
      bbox: null,
      relocatedFrom: params.evidence.evidenceId,
    };
    await ensureEvidenceRelocatedFromColumn(params.spreadsheetId, deps.google);
    await appendEvidenceRows(params.spreadsheetId, [relocated], deps.google);
    return { status: 'relocated', evidence: relocated };
  } catch (err) {
    return { status: 'not_found', message: err instanceof Error ? err.message : String(err) };
  }
}
