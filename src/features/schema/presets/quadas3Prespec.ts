// QUADAS-3 プリセットの事前設定（issue #103 PR3）。
// QUADAS-3 v1.2 の Phase 1（systematic review synthesis question: population /
// index test(s) / target condition。Table 2）と Phase 2（ideal test accuracy trial の
// 主要 component: intended-use population / index test の役割・clinical pathway 上の位置 /
// reference standard / Analysis・unit of analysis。Table 3〜4）に対応する。
// 原典は Phase 1〜2 の事前記述を要求するが、v1 は「注入のみ・挿入はブロックしない」
// （全項目任意 = 軽量版と同じ扱い。Phase 3〜4〔flow 図・estimate 単位の評価〕は
// issue #109 のスコープ）。入力があれば全行へ Review context を注入し、
// 適用可能性判定行（quadas3_applicability_judgement）へ synthesis question の定義を、
// SQ 4.3（"Does the unit of analysis match the ideal test accuracy trial?"）へ
// ideal trial の Analysis / unit を狙い撃ちで注入する（issue #103 D-4）。
// 構造化 JSON は判定行（quadas3_rob_judgement）の note に保存し、再挿入時に復元する。
import type { SchemaEditorRow } from '../types';
import { ROB_TEMPLATE_QUADAS3 } from './robTemplates';

/** 事前設定ダイアログの画面状態（AppState.schema.presetDialog）。テキストは入力中の生値を保持する */
export interface Quadas3PrespecDialogState {
  kind: 'quadas3';
  /** Phase 1: synthesis question の 3 component */
  population: string;
  indexTest: string;
  targetCondition: string;
  /** Phase 2: ideal test accuracy trial の主要 component */
  intendedUsePopulation: string;
  testRole: string;
  referenceStandard: string;
  analysisUnit: string;
  /** 全項目任意のため検証エラーは発生しないが、他ツールと状態の形を揃える */
  error: string | null;
}

/** 事前設定の確定値（note へ保存する構造化 JSON の中身）。空入力は null に正規化する */
export interface Quadas3Prespec {
  population: string | null;
  indexTest: string | null;
  targetCondition: string | null;
  intendedUsePopulation: string | null;
  testRole: string | null;
  referenceStandard: string | null;
  analysisUnit: string | null;
}

/** note JSON の識別子（他用途の note と区別する） */
const NOTE_TYPE = 'quadas3_prespec';

/** ダイアログの初期状態（initial = 再挿入時に note から復元した既存の事前設定） */
export function createQuadas3PrespecDialogState(
  initial: Quadas3Prespec | null,
): Quadas3PrespecDialogState {
  return {
    kind: 'quadas3',
    population: initial?.population ?? '',
    indexTest: initial?.indexTest ?? '',
    targetCondition: initial?.targetCondition ?? '',
    intendedUsePopulation: initial?.intendedUsePopulation ?? '',
    testRole: initial?.testRole ?? '',
    referenceStandard: initial?.referenceStandard ?? '',
    analysisUnit: initial?.analysisUnit ?? '',
    error: null,
  };
}

/** ダイアログ状態 → 確定値（トリム + 空 → null） */
export function quadas3DialogToPrespec(state: Quadas3PrespecDialogState): Quadas3Prespec {
  const normalize = (value: string): string | null => {
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
  };
  return {
    population: normalize(state.population),
    indexTest: normalize(state.indexTest),
    targetCondition: normalize(state.targetCondition),
    intendedUsePopulation: normalize(state.intendedUsePopulation),
    testRole: normalize(state.testRole),
    referenceStandard: normalize(state.referenceStandard),
    analysisUnit: normalize(state.analysisUnit),
  };
}

/** 確定値 → note へ保存する構造化 JSON（キーは Sheets 側の慣例に合わせ snake_case） */
export function serializeQuadas3PrespecNote(prespec: Quadas3Prespec): string {
  return JSON.stringify({
    type: NOTE_TYPE,
    version: 1,
    population: prespec.population,
    index_test: prespec.indexTest,
    target_condition: prespec.targetCondition,
    intended_use_population: prespec.intendedUsePopulation,
    test_role: prespec.testRole,
    reference_standard: prespec.referenceStandard,
    analysis_unit: prespec.analysisUnit,
  });
}

function parseOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/**
 * note の JSON から事前設定を復元する（再挿入時の初期値）。
 * note が無い・JSON でない・型識別子が違う・型が崩れている場合は null（防御的に読む）
 */
export function parseQuadas3PrespecNote(note: string | null): Quadas3Prespec | null {
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
    indexTest: parseOptionalString(record['index_test']),
    targetCondition: parseOptionalString(record['target_condition']),
    intendedUsePopulation: parseOptionalString(record['intended_use_population']),
    testRole: parseOptionalString(record['test_role']),
    referenceStandard: parseOptionalString(record['reference_standard']),
    analysisUnit: parseOptionalString(record['analysis_unit']),
  };
}

/** エディタ行から既存の事前設定を探す（再挿入時のダイアログ初期値。無ければ null） */
export function findQuadas3PrespecInRows(rows: readonly SchemaEditorRow[]): Quadas3Prespec | null {
  for (const row of rows) {
    if (row.fieldName === 'quadas3_rob_judgement') {
      const parsed = parseQuadas3PrespecNote(row.note);
      if (parsed !== null) {
        return parsed;
      }
    }
  }
  return null;
}

/**
 * 抽出指示の冒頭へ注入する Review context（英文サマリ）。入力があった項目だけを列挙し、
 * 何も入力が無ければ null（スキップ・全項目未入力と同じ扱い = 回帰なし）
 */
export function buildQuadas3ReviewContext(prespec: Quadas3Prespec): string | null {
  const parts: string[] = [];
  if (prespec.population !== null) {
    parts.push(`Synthesis question population: ${prespec.population}.`);
  }
  if (prespec.indexTest !== null) {
    parts.push(`Synthesis question index test(s): ${prespec.indexTest}.`);
  }
  if (prespec.targetCondition !== null) {
    parts.push(`Synthesis question target condition: ${prespec.targetCondition}.`);
  }
  if (prespec.intendedUsePopulation !== null) {
    parts.push(`Intended-use population of the ideal test accuracy trial: ${prespec.intendedUsePopulation}.`);
  }
  if (prespec.testRole !== null) {
    parts.push(
      `Proposed role and position of the index test in the clinical pathway: ${prespec.testRole}.`,
    );
  }
  if (prespec.referenceStandard !== null) {
    parts.push(`Reference standard of the ideal test accuracy trial: ${prespec.referenceStandard}.`);
  }
  if (prespec.analysisUnit !== null) {
    parts.push(`Unit of analysis of the ideal test accuracy trial: ${prespec.analysisUnit}.`);
  }
  if (parts.length === 0) {
    return null;
  }
  return (
    'Review context (pre-specified by the review team; treat as given and do not infer these ' +
    `from the article): ${parts.join(' ')}`
  );
}

/** 適用可能性判定行へ注入する synthesis question の定義文（Phase 1 の入力があるときのみ） */
function synthesisQuestionNote(prespec: Quadas3Prespec): string | null {
  const parts: string[] = [];
  if (prespec.population !== null) {
    parts.push(`population: ${prespec.population}`);
  }
  if (prespec.indexTest !== null) {
    parts.push(`index test(s): ${prespec.indexTest}`);
  }
  if (prespec.targetCondition !== null) {
    parts.push(`target condition: ${prespec.targetCondition}`);
  }
  if (parts.length === 0) {
    return null;
  }
  return `In this review, the systematic review synthesis question is defined as — ${parts.join('; ')}.`;
}

/** SQ 4.3 へ注入する ideal trial の Analysis / unit の定義文（入力があるときのみ） */
function analysisUnitNote(prespec: Quadas3Prespec): string | null {
  if (prespec.analysisUnit === null) {
    return null;
  }
  return `In this review, the unit of analysis of the ideal test accuracy trial is: ${prespec.analysisUnit}.`;
}

/** synthesis question の定義文を注入する行（適用可能性の判定 + 根拠） */
const APPLICABILITY_TARGET_FIELDS: ReadonlySet<string> = new Set([
  'quadas3_applicability_judgement',
]);

/** ideal trial の Analysis / unit を注入する SQ（Phase 5 Domain 4 の 4.3） */
const ANALYSIS_UNIT_TARGET_FIELDS: ReadonlySet<string> = new Set(['quadas3_sq4_3']);

/**
 * quadas3 プリセットの行生成。事前設定が空（スキップ・全項目未入力）なら現行テンプレートと
 * 同一の行を返す（回帰なし）。入力があれば全行へ Review context を注入し、
 * 適用可能性判定行と SQ 4.3 へ対応する定義文を注入、判定行の note に構造化 JSON を保存する
 */
export function buildQuadas3Rows(prespec: Quadas3Prespec): SchemaEditorRow[] {
  const context = buildQuadas3ReviewContext(prespec);
  if (context === null) {
    return ROB_TEMPLATE_QUADAS3.map((row) => ({ ...row }));
  }
  const questionNote = synthesisQuestionNote(prespec);
  const unitNote = analysisUnitNote(prespec);
  return ROB_TEMPLATE_QUADAS3.map((row) => {
    const extras: string[] = [context];
    if (questionNote !== null && APPLICABILITY_TARGET_FIELDS.has(row.fieldName)) {
      extras.push(questionNote);
    }
    if (unitNote !== null && ANALYSIS_UNIT_TARGET_FIELDS.has(row.fieldName)) {
      extras.push(unitNote);
    }
    return {
      ...row,
      extractionInstruction: `${extras.join('\n')}\n${row.extractionInstruction}`,
      note:
        row.fieldName === 'quadas3_rob_judgement' ? serializeQuadas3PrespecNote(prespec) : row.note,
    };
  });
}
