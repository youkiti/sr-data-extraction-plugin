// RoB 2 プリセットの事前設定（issue #103 PR1）。
// RoB 2 公式 completion template（22 Aug 2019）の "Preliminary considerations"
// （Study design / 比較する介入 / 評価対象 outcome / 評価対象の numerical result /
// effect of interest / adhering 時の deviation 種別）に対応する。
// 事前設定は「レビューチームの決定」であり論文から抽出する値ではないため、
// extract-data プロンプト本文（凍結ベンチマークと同版数）には手を入れず、生成する各行の
// extraction_instruction 冒頭へ read-only の「Review context:（英文サマリ）」として注入する。
// 構造化 JSON は判定行（rob2_judgement）の note に保存し、再挿入時の初期値・監査に使う
// （Schemas タブの既存列のみを使い、Sheets のデータモデルは変更しない — issue #103 D-1）。
import type { SchemaEditorRow } from '../types';
import {
  buildRob2SqTemplateRows,
  ROB_TEMPLATE_ROB2,
  type Rob2DeviationType,
} from './robTemplates';

/** effect of interest（公式 template の二者択一。ITT 効果 ⇄ per-protocol 効果） */
export type Rob2Effect = 'assignment' | 'adhering';

/** 事前設定ダイアログの画面状態（AppState.schema.presetDialog）。テキストは入力中の生値を保持する */
export interface RobPrespecDialogState {
  /** 対象プリセット。rob2（軽量版）= 全項目任意 + スキップ可 / rob2_sq = effect 必須 */
  kind: 'rob2' | 'rob2_sq';
  experimental: string;
  comparator: string;
  outcome: string;
  numericalResult: string;
  /** null = 未選択（rob2 では「指定しない」を許す。rob2_sq では確定時に必須エラー） */
  effect: Rob2Effect | null;
  /** adhering 選択時に扱う deviation 種別（最低 1 つ必須） */
  deviationTypes: readonly Rob2DeviationType[];
  /** 「この内容で挿入」時の検証エラー。入力を変更したらクリアする */
  error: string | null;
}

/** 事前設定の確定値（note へ保存する構造化 JSON の中身）。空入力は null に正規化する */
export interface Rob2Prespec {
  /** v1 は individually-randomized parallel-group のみ（cluster / crossover は RoB 2 の別版） */
  design: 'individually_randomized_parallel_group';
  experimental: string | null;
  comparator: string | null;
  outcome: string | null;
  numericalResult: string | null;
  effect: Rob2Effect | null;
  deviationTypes: readonly Rob2DeviationType[];
}

/** deviation 種別の正準順（公式 template の列挙順。トグル操作でもこの順を維持する） */
const DEVIATION_TYPE_ORDER: readonly Rob2DeviationType[] = [
  'non_protocol_interventions',
  'implementation_failures',
  'non_adherence',
];

/** note JSON の識別子（他用途の note と区別する） */
const NOTE_TYPE = 'rob2_prespec';

/** ダイアログの初期状態（initial = 再挿入時に note から復元した既存の事前設定） */
export function createRobPrespecDialogState(
  kind: 'rob2' | 'rob2_sq',
  initial: Rob2Prespec | null,
): RobPrespecDialogState {
  return {
    kind,
    experimental: initial?.experimental ?? '',
    comparator: initial?.comparator ?? '',
    outcome: initial?.outcome ?? '',
    numericalResult: initial?.numericalResult ?? '',
    effect: initial?.effect ?? null,
    deviationTypes: initial?.deviationTypes ?? [],
    error: null,
  };
}

/** deviation 種別チェックボックスのトグル（正準順を維持した新しい配列を返す） */
export function toggleDeviationType(
  current: readonly Rob2DeviationType[],
  type: Rob2DeviationType,
  checked: boolean,
): Rob2DeviationType[] {
  const next = new Set(current);
  if (checked) {
    next.add(type);
  } else {
    next.delete(type);
  }
  return DEVIATION_TYPE_ORDER.filter((candidate) => next.has(candidate));
}

/**
 * 「この内容で挿入」の検証。null = 通過。
 * - rob2_sq: effect of interest は SQ セット構成自体を決めるため必須
 * - 両プリセット共通: adhering を選んだら deviation 種別を最低 1 つ
 *   （公式 template: "at least one must be checked"）
 */
export function validateRobPrespecDialog(state: RobPrespecDialogState): string | null {
  if (state.kind === 'rob2_sq' && state.effect === null) {
    return 'effect of interest（assignment / adhering）を選択してください';
  }
  if (state.effect === 'adhering' && state.deviationTypes.length === 0) {
    return 'adhering を選ぶ場合は、扱う deviation 種別を最低 1 つチェックしてください';
  }
  return null;
}

/** ダイアログ状態 → 確定値（トリム + 空 → null。deviation 種別は adhering のときだけ保持） */
export function dialogToPrespec(state: RobPrespecDialogState): Rob2Prespec {
  const normalize = (value: string): string | null => {
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
  };
  return {
    design: 'individually_randomized_parallel_group',
    experimental: normalize(state.experimental),
    comparator: normalize(state.comparator),
    outcome: normalize(state.outcome),
    numericalResult: normalize(state.numericalResult),
    effect: state.effect,
    deviationTypes: state.effect === 'adhering' ? state.deviationTypes : [],
  };
}

/** 確定値 → note へ保存する構造化 JSON（キーは Sheets 側の慣例に合わせ snake_case） */
export function serializeRob2PrespecNote(prespec: Rob2Prespec): string {
  return JSON.stringify({
    type: NOTE_TYPE,
    version: 1,
    design: prespec.design,
    experimental: prespec.experimental,
    comparator: prespec.comparator,
    outcome: prespec.outcome,
    numerical_result: prespec.numericalResult,
    effect: prespec.effect,
    deviation_types: prespec.deviationTypes,
  });
}

const EFFECT_VALUES: readonly Rob2Effect[] = ['assignment', 'adhering'];

function parseOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/**
 * note の JSON から事前設定を復元する（再挿入時の初期値）。
 * note が無い・JSON でない・型識別子が違う・型が崩れている場合は null（防御的に読む）
 */
export function parseRob2PrespecNote(note: string | null): Rob2Prespec | null {
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
  const effectRaw = record['effect'];
  const effect = (EFFECT_VALUES as readonly unknown[]).includes(effectRaw)
    ? (effectRaw as Rob2Effect)
    : null;
  const deviationRaw = record['deviation_types'];
  const deviationTypes = Array.isArray(deviationRaw)
    ? DEVIATION_TYPE_ORDER.filter((candidate) => deviationRaw.includes(candidate))
    : [];
  return {
    design: 'individually_randomized_parallel_group',
    experimental: parseOptionalString(record['experimental']),
    comparator: parseOptionalString(record['comparator']),
    outcome: parseOptionalString(record['outcome']),
    numericalResult: parseOptionalString(record['numerical_result']),
    effect,
    deviationTypes,
  };
}

/** エディタ行から既存の事前設定を探す（再挿入時のダイアログ初期値。無ければ null） */
export function findRob2PrespecInRows(rows: readonly SchemaEditorRow[]): Rob2Prespec | null {
  for (const row of rows) {
    if (row.fieldName === 'rob2_judgement') {
      const parsed = parseRob2PrespecNote(row.note);
      if (parsed !== null) {
        return parsed;
      }
    }
  }
  return null;
}

/** effect of interest の英文（公式 template の文言） */
const EFFECT_PHRASES: Record<Rob2Effect, string> = {
  assignment: "to assess the effect of assignment to intervention (the 'intention-to-treat' effect)",
  adhering: "to assess the effect of adhering to intervention (the 'per-protocol' effect)",
};

/** deviation 種別の英文（公式 template のチェック項目文言） */
const DEVIATION_PHRASES: Record<Rob2DeviationType, string> = {
  non_protocol_interventions: 'occurrence of non-protocol interventions',
  implementation_failures:
    'failures in implementing the intervention that could have affected the outcome',
  non_adherence: 'non-adherence to their assigned intervention by trial participants',
};

/**
 * 抽出指示の冒頭へ注入する Review context（英文サマリ）。入力があった項目だけを列挙し、
 * 何も入力が無ければ null（軽量版のスキップ・全項目未入力と同じ扱い = 回帰なし）。
 * includeDesign は SQ 完全版のみ true（SQ セットが individually-randomized parallel-group
 * 前提のため。軽量版の判定 + 根拠は design を固定しない）
 */
export function buildRob2ReviewContext(
  prespec: Rob2Prespec,
  options: { includeDesign: boolean },
): string | null {
  const parts: string[] = [];
  if (options.includeDesign) {
    parts.push('Study design: individually-randomized parallel-group trial.');
  }
  if (prespec.experimental !== null) {
    parts.push(`Experimental intervention: ${prespec.experimental}.`);
  }
  if (prespec.comparator !== null) {
    parts.push(`Comparator: ${prespec.comparator}.`);
  }
  if (prespec.outcome !== null) {
    parts.push(`Outcome being assessed for risk of bias: ${prespec.outcome}.`);
  }
  if (prespec.numericalResult !== null) {
    parts.push(`Numerical result being assessed: ${prespec.numericalResult}.`);
  }
  if (prespec.effect !== null) {
    parts.push(`The review team's aim for this result is ${EFFECT_PHRASES[prespec.effect]}.`);
    if (prespec.effect === 'adhering' && prespec.deviationTypes.length > 0) {
      const listed = prespec.deviationTypes.map((type) => DEVIATION_PHRASES[type]).join('; ');
      parts.push(`Deviations from intended intervention addressed in this assessment: ${listed}.`);
    }
  }
  if (parts.length === 0) {
    return null;
  }
  return (
    'Review context (pre-specified by the review team; treat as given and do not infer these ' +
    `from the article): ${parts.join(' ')}`
  );
}

/**
 * rob2（軽量版）の行生成。事前設定が空（スキップ・全項目未入力）なら現行テンプレートと
 * 同一の行を返す（回帰なし）。入力があれば各行へ Review context を注入し、
 * 判定行の note に構造化 JSON を保存する
 */
export function buildRob2LiteRows(prespec: Rob2Prespec): SchemaEditorRow[] {
  const context = buildRob2ReviewContext(prespec, { includeDesign: false });
  if (context === null) {
    return ROB_TEMPLATE_ROB2.map((row) => ({ ...row }));
  }
  return ROB_TEMPLATE_ROB2.map((row) => ({
    ...row,
    extractionInstruction: `${context}\n${row.extractionInstruction}`,
    note: row.fieldName === 'rob2_judgement' ? serializeRob2PrespecNote(prespec) : row.note,
  }));
}

/**
 * rob2_sq（SQ 完全版）の行生成。effect of interest（必須）に応じて D2 の SQ セットを切り替え、
 * 全行へ Review context を注入し、判定行の note に構造化 JSON を保存する
 */
export function buildRob2SqRows(prespec: Rob2Prespec): SchemaEditorRow[] {
  if (prespec.effect === null) {
    // validateRobPrespecDialog で確定前に弾かれる想定（プログラミングエラーの検出）
    throw new Error('rob2_sq の挿入には effect of interest の選択が必要です');
  }
  const rows =
    prespec.effect === 'assignment'
      ? buildRob2SqTemplateRows({ effect: 'assignment' })
      : buildRob2SqTemplateRows({ effect: 'adhering', deviationTypes: prespec.deviationTypes });
  // effect が非 null のため Review context は必ず生成される（buildRob2ReviewContext の不変条件）
  const context = buildRob2ReviewContext(prespec, { includeDesign: true }) as string;
  return rows.map((row) => ({
    ...row,
    extractionInstruction: `${context}\n${row.extractionInstruction}`,
    note: row.fieldName === 'rob2_judgement' ? serializeRob2PrespecNote(prespec) : row.note,
  }));
}
