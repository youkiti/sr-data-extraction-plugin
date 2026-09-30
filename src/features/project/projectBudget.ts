// Meta の予算列だけを現在値として更新する。基本列と他の行は変更しない。
import { META_BUDGET_COLUMNS, SHEET_HEADERS } from '../../domain/sheetsSchema';
import { getSheetValues, updateRange } from '../../lib/google/sheets';
import type { GoogleApiDeps } from '../../lib/google/types';

export interface ProjectBudget {
  budgetUsd: number | null;
  updatedBy: string | null;
  updatedAt: string | null;
}

/** 列名で予算を読む。旧ヘッダ・空セルは未設定として扱う。 */
export async function readProjectBudget(
  spreadsheetId: string,
  deps: GoogleApiDeps,
): Promise<ProjectBudget> {
  const rows = await getSheetValues(spreadsheetId, 'Meta', deps);
  const header = rows[0] ?? [];
  const row = rows[1] ?? [];
  const cell = (name: string): string | null => {
    const value = row[header.indexOf(name)];
    return value === undefined || value === '' ? null : value;
  };
  const rawBudget = cell('budget_usd');
  const number = rawBudget === null ? Number.NaN : Number(rawBudget);
  return {
    // 手編集で壊れた予算があってもプロジェクトの読み込みを妨げない。
    budgetUsd: Number.isFinite(number) && number >= 0 ? number : null,
    updatedBy: cell('budget_updated_by'),
    updatedAt: cell('budget_updated_at'),
  };
}

/**
 * 予算列だけは追記型の例外として上書きする。null は解除。
 * 監査は最新の更新者・時刻と、過去分の Google Sheets 版履歴による。
 */
export async function saveProjectBudget(
  spreadsheetId: string,
  budget: ProjectBudget,
  deps: GoogleApiDeps,
): Promise<void> {
  if (budget.budgetUsd !== null && (!Number.isFinite(budget.budgetUsd) || budget.budgetUsd <= 0)) {
    throw new Error('予算は 0 より大きい有限の数値を指定してください');
  }
  const rows = await getSheetValues(spreadsheetId, 'Meta', deps);
  const header = rows[0] ?? [];
  const base = SHEET_HEADERS.Meta;
  base.forEach((name, i) => {
    if ((header[i] ?? '') !== name) {
      throw new Error(
        `Meta のヘッダ ${i + 1} 列目が "${name}" ではありません（実際: "${header[i] ?? ''}"）。予算の保存を中止します`,
      );
    }
  });
  // 未知の列を予算列として上書きしない。基本列の直後に予算列が並ぶ配置だけを保存する。
  META_BUDGET_COLUMNS.forEach((name, i) => {
    const existing = header[base.length + i];
    if (existing !== undefined && existing !== name) {
      throw new Error('Meta の予算列の配置が想定と異なります。予算の保存を中止します');
    }
  });
  // 基本 7 列という配置はテストでも固定し、更新範囲を予算 3 列に限定する。
  const firstColumn = String.fromCharCode(65 + base.length);
  const lastColumn = String.fromCharCode(65 + base.length + META_BUDGET_COLUMNS.length - 1);
  if (budget.budgetUsd === null) {
    if (header.length > base.length) {
      const empty = META_BUDGET_COLUMNS.map(() => '');
      await updateRange(spreadsheetId, `Meta!${firstColumn}1:${lastColumn}2`, [empty, empty], deps);
    }
    return;
  }
  if (header.length < base.length + META_BUDGET_COLUMNS.length) {
    await updateRange(
      spreadsheetId,
      `Meta!${firstColumn}1:${lastColumn}1`,
      [META_BUDGET_COLUMNS],
      deps,
    );
  }
  await updateRange(
    spreadsheetId,
    `Meta!${firstColumn}2:${lastColumn}2`,
    [[budget.budgetUsd, budget.updatedBy, budget.updatedAt]],
    deps,
  );
}
