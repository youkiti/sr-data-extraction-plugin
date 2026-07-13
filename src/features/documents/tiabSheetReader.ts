// tiab-review スプレッドシートの直読み I/O（issue #68・requirements.md §4.5 / ※Q2）。
// References / Decisions タブを values:batchGet 1 回で読み、Config タブの
// fulltext_ai_active_round（フルテキスト AI 判定の採用ラウンド）を別途読む。
// Config はタブ自体が無い旧シートがあるため、読み出し失敗は null として扱う。
// パース（列名解決・型変換）は tiabReview.ts の純ロジックに委譲する
import { getBatchValues, getSheetValues } from '../../lib/google/sheets';
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

/** GoogleApiError をユーザー向けの文言へ変換する（タブ欠落・アクセス不可の典型例） */
function toFriendlyError(err: unknown): Error {
  if (err instanceof GoogleApiError) {
    if (err.status === 400) {
      return new Error(
        'References / Decisions タブが見つかりません。tiab-review のスプレッドシートを指定してください',
      );
    }
    if (err.status === 403 || err.status === 404) {
      return new Error(
        'スプレッドシートを開けません。URL / ID と、同じ Google アカウントでアクセスできることを確認してください',
      );
    }
  }
  return err instanceof Error ? err : new Error(String(err));
}

/**
 * tiab-review シートの References / Decisions / Config を読み、パース済みデータを返す。
 * References / Decisions の読み出し・パース失敗は throw（呼び出し側でエラー表示）
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
      ['References', 'Decisions'],
      deps,
    )) as [string[][], string[][]];
  } catch (err) {
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
