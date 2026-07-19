// tiab-review スプレッドシートの直読み I/O（issue #68・requirements.md §4.5 / ※Q2）。
// References / Decisions タブを values:batchGet 1 回で読み、Config タブの
// fulltext_ai_active_round（フルテキスト AI 判定の採用ラウンド）を別途読む。
// Config はタブ自体が無い旧シートがあるため、読み出し失敗は null として扱う。
// パース（列名解決・型変換）は tiabReview.ts の純ロジックに委譲する
import {
  getBatchValues,
  getSheetValues,
  isSheetsAccessDenied,
  SheetsAccessDeniedError,
} from '../../lib/google/sheets';
import { GoogleApiError, type GoogleApiDeps } from '../../lib/google/types';
import {
  parseTiabDecisions,
  parseTiabReferences,
  type TiabDecision,
  type TiabReference,
} from './tiabReview';

export interface TiabSheetData {
  references: TiabReference[];
  decisions: TiabDecision[];
  /** tiab の Config.fulltext_ai_active_round（未設定・Config 欠落は null） */
  activeFulltextAiRound: string | null;
}

/**
 * tiab-review のシートであることの判定・読み出しに使う必須タブ
 * （tiab-review-plugin/src/lib/sheets-api.ts の createSpreadsheet が生成するタブのうち
 * データ本体の 2 つ。S1 の誤入力検出〔selectProject〕と直読みで単一の定義を共有する）
 */
export const TIAB_REQUIRED_TABS = ['References', 'Decisions'] as const;

/** GoogleApiError をユーザー向けの文言へ変換する（タブ欠落の典型例。アクセス拒否は別経路） */
function toFriendlyError(err: unknown): Error {
  if (err instanceof GoogleApiError && err.status === 400) {
    return new Error(
      'References / Decisions タブが見つかりません。tiab-review のスプレッドシートを指定してください',
    );
  }
  return err instanceof Error ? err : new Error(String(err));
}

/**
 * tiab-review シートの References / Decisions / Config を読み、パース済みデータを返す。
 * References / Decisions の読み出し・パース失敗は throw（呼び出し側でエラー表示）。
 *
 * drive.file 未許可（403 権限系 / 404）は SheetsAccessDeniedError として伝播させる（issue #142）。
 * tiab-review は別 OAuth クライアント（別アプリ）が作成したシートのため、#128〜#132 の
 * drive.file 移行後は Picker で明示付与するまで所有者本人でも開けない。呼び出し側
 * （tiabImportService）が `err instanceof SheetsAccessDeniedError` で判定して Picker 許可導線を
 * 出せるよう、toFriendlyError で情報が落ちる前に分類する（selectProject.loadProjectMeta と同じ
 * isSheetsAccessDenied の分類ロジックを再利用し、#130 とトンマナを揃える）
 */
export async function readTiabSheet(
  spreadsheetId: string,
  deps: GoogleApiDeps,
): Promise<TiabSheetData> {
  let refValues: string[][];
  let decisionValues: string[][];
  try {
    [refValues, decisionValues] = (await getBatchValues(
      spreadsheetId,
      [...TIAB_REQUIRED_TABS],
      deps,
    )) as [string[][], string[][]];
  } catch (err) {
    if (isSheetsAccessDenied(err)) {
      throw new SheetsAccessDeniedError(spreadsheetId, err.status);
    }
    throw toFriendlyError(err);
  }

  const references = parseTiabReferences(refValues);
  const decisions = parseTiabDecisions(decisionValues);

  let activeFulltextAiRound: string | null = null;
  try {
    const configValues = await getSheetValues(spreadsheetId, 'Config', deps);
    for (const row of configValues) {
      if (row[0] === 'fulltext_ai_active_round') {
        const value = (row[1] ?? '').trim();
        activeFulltextAiRound = value === '' ? null : value;
      }
    }
  } catch {
    // Config タブが無い旧シートは採用ラウンドなしとして扱う
    activeFulltextAiRound = null;
  }

  return { references, decisions, activeFulltextAiRound };
}
