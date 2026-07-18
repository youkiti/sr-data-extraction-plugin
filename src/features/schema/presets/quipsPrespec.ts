// QUIPS プリセットの事前設定（issue #103 PR3）。
// QUIPS（Cochrane Prognosis Methods Group 版）には RoB 2 等のような形式的な事前設定
// フェーズは無い（原典調査で確認済み。c:\tmp\rob-prespec\REPORT.md §4）。ただし item 本文が
// "population of interest … key characteristics (LIST)"・"key variables in conceptual
// model (LIST)" 等、レビュー固有の定義を暗黙の参照枠として要求するため、ここで
// population / prognostic factor / outcome（follow-up 含む）/ key characteristics LIST /
// important confounders LIST を任意入力できるようにする（推奨・任意入力の位置づけ =
// issue #103 D-5）。入力があれば全行へ Review context を注入し、key characteristics LIST は
// D1 の item 1.2、important confounders LIST は D5 の item 5.1 / 5.2、PF 定義は D3、
// outcome 定義は D4 の item へ狙い撃ちで注入する。
// 構造化 JSON は判定行（quips_judgement）の note に保存し、再挿入時に復元する。
import type { SchemaEditorRow } from '../types';
import { parseOptionalString, parseStringArray } from './prespecDialog';
import { parseListInput } from './robinsIPrespec';
import { ROB_TEMPLATE_QUIPS } from './robTemplates';

/** 事前設定ダイアログの画面状態（AppState.schema.presetDialog）。テキストは入力中の生値を保持する */
export interface QuipsPrespecDialogState {
  kind: 'quips';
  population: string;
  prognosticFactor: string;
  outcome: string;
  /** key characteristics（textarea の生値。1 行 1 項目） */
  keyCharacteristics: string;
  /** important confounders（textarea の生値。1 行 1 項目） */
  importantConfounders: string;
  /** 全項目任意のため検証エラーは発生しないが、他ツールと状態の形を揃える */
  error: string | null;
}

/** 事前設定の確定値（note へ保存する構造化 JSON の中身）。空入力は null / 空配列に正規化する */
export interface QuipsPrespec {
  population: string | null;
  prognosticFactor: string | null;
  outcome: string | null;
  keyCharacteristics: readonly string[];
  importantConfounders: readonly string[];
}

/** note JSON の識別子（他用途の note と区別する） */
const NOTE_TYPE = 'quips_prespec';

/** ダイアログの初期状態（initial = 再挿入時に note から復元した既存の事前設定） */
export function createQuipsPrespecDialogState(
  initial: QuipsPrespec | null,
): QuipsPrespecDialogState {
  return {
    kind: 'quips',
    population: initial?.population ?? '',
    prognosticFactor: initial?.prognosticFactor ?? '',
    outcome: initial?.outcome ?? '',
    keyCharacteristics: (initial?.keyCharacteristics ?? []).join('\n'),
    importantConfounders: (initial?.importantConfounders ?? []).join('\n'),
    error: null,
  };
}

/** ダイアログ状態 → 確定値（トリム + 空 → null。リストは行分割して正規化） */
export function quipsDialogToPrespec(state: QuipsPrespecDialogState): QuipsPrespec {
  const normalize = (value: string): string | null => {
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
  };
  return {
    population: normalize(state.population),
    prognosticFactor: normalize(state.prognosticFactor),
    outcome: normalize(state.outcome),
    keyCharacteristics: parseListInput(state.keyCharacteristics),
    importantConfounders: parseListInput(state.importantConfounders),
  };
}

/** 確定値 → note へ保存する構造化 JSON（キーは Sheets 側の慣例に合わせ snake_case） */
export function serializeQuipsPrespecNote(prespec: QuipsPrespec): string {
  return JSON.stringify({
    type: NOTE_TYPE,
    version: 1,
    population: prespec.population,
    prognostic_factor: prespec.prognosticFactor,
    outcome: prespec.outcome,
    key_characteristics: prespec.keyCharacteristics,
    important_confounders: prespec.importantConfounders,
  });
}

/**
 * note の JSON から事前設定を復元する（再挿入時の初期値）。
 * note が無い・JSON でない・型識別子が違う・型が崩れている場合は null（防御的に読む）
 */
export function parseQuipsPrespecNote(note: string | null): QuipsPrespec | null {
  if (note === null) {
    return null;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(note);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  if (record['type'] !== NOTE_TYPE) {
    return null;
  }
  return {
    population: parseOptionalString(record['population']),
    prognosticFactor: parseOptionalString(record['prognostic_factor']),
    outcome: parseOptionalString(record['outcome']),
    keyCharacteristics: parseStringArray(record['key_characteristics']),
    importantConfounders: parseStringArray(record['important_confounders']),
  };
}

/** エディタ行から既存の事前設定を探す（再挿入時のダイアログ初期値。無ければ null） */
export function findQuipsPrespecInRows(rows: readonly SchemaEditorRow[]): QuipsPrespec | null {
  for (const row of rows) {
    if (row.fieldName === 'quips_judgement') {
      const parsed = parseQuipsPrespecNote(row.note);
      if (parsed !== null) {
        return parsed;
      }
    }
  }
  return null;
}

/**
 * 抽出指示の冒頭へ注入する Review context（英文サマリ）。入力があった項目だけを列挙し、
 * 何も入力が無ければ null（スキップ・全項目未入力と同じ扱い = 回帰なし）。
 * リスト（key characteristics / important confounders）は対象 item への狙い撃ち注入に
 * 委ねるため共通 context には含めない（リスト単独入力でも狙い撃ち注入を有効にする判定は
 * buildQuipsRows が行う）
 */
export function buildQuipsReviewContext(prespec: QuipsPrespec): string | null {
  const parts: string[] = [];
  if (prespec.population !== null) {
    parts.push(`Population of interest: ${prespec.population}.`);
  }
  if (prespec.prognosticFactor !== null) {
    parts.push(`Prognostic factor: ${prespec.prognosticFactor}.`);
  }
  if (prespec.outcome !== null) {
    parts.push(`Outcome (including duration of follow-up): ${prespec.outcome}.`);
  }
  if (parts.length === 0) {
    return null;
  }
  return (
    'Review context (pre-specified by the review team; treat as given and do not infer these ' +
    `from the article): ${parts.join(' ')}`
  );
}

/** key characteristics LIST を注入する item（D1 の 1.2 "described for key characteristics (LIST)"） */
const KEY_CHARACTERISTICS_TARGET_FIELDS: ReadonlySet<string> = new Set(['quips_pi1_2']);

/** important confounders LIST を注入する item（D5 の 5.1 / 5.2） */
const CONFOUNDERS_TARGET_FIELDS: ReadonlySet<string> = new Set(['quips_pi5_1', 'quips_pi5_2']);

/** prognostic factor の定義を注入する item（D3 の 3.1 / 3.2） */
const PF_TARGET_FIELDS: ReadonlySet<string> = new Set(['quips_pi3_1', 'quips_pi3_2']);

/** outcome の定義を注入する item（D4 の 4.1 / 4.2） */
const OUTCOME_TARGET_FIELDS: ReadonlySet<string> = new Set(['quips_pi4_1', 'quips_pi4_2']);

/** 確定値が完全に空か（Review context もリストも無い = スキップと同じ扱い） */
function isEmptyQuipsPrespec(prespec: QuipsPrespec): boolean {
  return (
    buildQuipsReviewContext(prespec) === null &&
    prespec.keyCharacteristics.length === 0 &&
    prespec.importantConfounders.length === 0
  );
}

/**
 * quips プリセットの行生成。事前設定が空（スキップ・全項目未入力）なら現行テンプレートと
 * 同一の行を返す（回帰なし）。入力があれば全行へ Review context を注入し、
 * LIST / PF / outcome の定義を対応する item へ注入、判定行の note に構造化 JSON を保存する
 */
export function buildQuipsRows(prespec: QuipsPrespec): SchemaEditorRow[] {
  if (isEmptyQuipsPrespec(prespec)) {
    return ROB_TEMPLATE_QUIPS.map((row) => ({ ...row }));
  }
  const context = buildQuipsReviewContext(prespec);
  const keyCharacteristicsNote =
    prespec.keyCharacteristics.length === 0
      ? null
      : `In this review, the key characteristics (LIST) are: ${prespec.keyCharacteristics.join('; ')}.`;
  const confoundersNote =
    prespec.importantConfounders.length === 0
      ? null
      : 'In this review, the important confounders (key variables in the conceptual model) are: ' +
        `${prespec.importantConfounders.join('; ')}.`;
  const pfNote =
    prespec.prognosticFactor === null
      ? null
      : `In this review, the prognostic factor is defined as: ${prespec.prognosticFactor}.`;
  const outcomeNote =
    prespec.outcome === null
      ? null
      : `In this review, the outcome (including duration of follow-up) is defined as: ${prespec.outcome}.`;
  return ROB_TEMPLATE_QUIPS.map((row) => {
    const extras: string[] = [];
    if (context !== null) {
      extras.push(context);
    }
    if (keyCharacteristicsNote !== null && KEY_CHARACTERISTICS_TARGET_FIELDS.has(row.fieldName)) {
      extras.push(keyCharacteristicsNote);
    }
    if (confoundersNote !== null && CONFOUNDERS_TARGET_FIELDS.has(row.fieldName)) {
      extras.push(confoundersNote);
    }
    if (pfNote !== null && PF_TARGET_FIELDS.has(row.fieldName)) {
      extras.push(pfNote);
    }
    if (outcomeNote !== null && OUTCOME_TARGET_FIELDS.has(row.fieldName)) {
      extras.push(outcomeNote);
    }
    return {
      ...row,
      extractionInstruction:
        extras.length === 0
          ? row.extractionInstruction
          : `${extras.join('\n')}\n${row.extractionInstruction}`,
      note: row.fieldName === 'quips_judgement' ? serializeQuipsPrespecNote(prespec) : row.note,
    };
  });
}
