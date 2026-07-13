// ROBINS-I プリセットの事前設定（issue #103 PR2）。
// ROBINS-I tool template（1 Aug 2016）Stage II の study 単位 setup
// （target randomized trial の design / participants / experimental / comparator、
// "Is your aim for this study…?" の effect of interest、outcome + benefit/harm）と、
// detailed guidance Box 1 の protocol 段階リスト（important confounding domains /
// co-interventions）に対応する。
// 事前設定は「レビューチームの決定」であり論文から抽出する値ではないため、
// extract-data プロンプト本文には手を入れず、生成する各行の extraction_instruction 冒頭へ
// read-only の「Review context:（英文サマリ）」として注入する。confounding domains リストは
// SQ 1.4 / 1.7（"all the important confounding domains" の定義）、co-interventions リストは
// SQ 4.3（"important co-interventions" の定義）へ狙い撃ちで注入する（issue #103 D-3）。
// 構造化 JSON は判定行（robins_i_judgement）の note に保存し、再挿入時の初期値・監査に使う
// （Schemas タブの既存列のみを使い、Sheets のデータモデルは変更しない）。
import type { MessageKey } from '../../../lib/i18n';
import type { SchemaEditorRow } from '../types';
import {
  buildRobinsISqTemplateRows,
  ROB_TEMPLATE_ROBINS_I,
  type RobinsIEffect,
} from './robTemplates';

/** outcome が介入の benefit / harm どちらの想定か（tool template の "proposed benefit or harm"） */
export type RobinsIBenefitHarm = 'benefit' | 'harm';

/** 事前設定ダイアログの画面状態（AppState.schema.presetDialog）。テキストは入力中の生値を保持する */
export interface RobinsIPrespecDialogState {
  /** 対象プリセット。robins_i（軽量版）= 全項目任意 + スキップ可 / robins_i_sq = effect 必須 */
  kind: 'robins_i' | 'robins_i_sq';
  /** target trial の design（自由記述。原典の選択肢: individually randomized / cluster randomized / matched） */
  design: string;
  participants: string;
  experimental: string;
  comparator: string;
  outcome: string;
  /** null = 未指定（任意入力） */
  benefitHarm: RobinsIBenefitHarm | null;
  /** null = 未選択（robins_i では「指定しない」を許す。robins_i_sq では確定時に必須エラー） */
  effect: RobinsIEffect | null;
  /** important confounding domains（textarea の生値。1 行 1 項目） */
  confoundingDomains: string;
  /** co-interventions（textarea の生値。1 行 1 項目） */
  coInterventions: string;
  /** 「この内容で挿入」時の検証エラー（表示文字列）。入力を変更したらクリアする */
  error: string | null;
}

/** 事前設定の確定値（note へ保存する構造化 JSON の中身）。空入力は null / 空配列に正規化する */
export interface RobinsIPrespec {
  design: string | null;
  participants: string | null;
  experimental: string | null;
  comparator: string | null;
  outcome: string | null;
  benefitHarm: RobinsIBenefitHarm | null;
  effect: RobinsIEffect | null;
  confoundingDomains: readonly string[];
  coInterventions: readonly string[];
}

/** note JSON の識別子（他用途の note と区別する） */
const NOTE_TYPE = 'robins_i_prespec';

/** リスト入力（1 行 1 項目）→ 正規化済み配列（トリム + 空行除去） */
export function parseListInput(raw: string): string[] {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

/** ダイアログの初期状態（initial = 再挿入時に note から復元した既存の事前設定） */
export function createRobinsIPrespecDialogState(
  kind: 'robins_i' | 'robins_i_sq',
  initial: RobinsIPrespec | null,
): RobinsIPrespecDialogState {
  return {
    kind,
    design: initial?.design ?? '',
    participants: initial?.participants ?? '',
    experimental: initial?.experimental ?? '',
    comparator: initial?.comparator ?? '',
    outcome: initial?.outcome ?? '',
    benefitHarm: initial?.benefitHarm ?? null,
    effect: initial?.effect ?? null,
    confoundingDomains: (initial?.confoundingDomains ?? []).join('\n'),
    coInterventions: (initial?.coInterventions ?? []).join('\n'),
    error: null,
  };
}

/**
 * 「この内容で挿入」の検証。null = 通過。
 * robins_i_sq は effect of interest が D4 の SQ セット構成自体を決めるため必須
 * （軽量版 robins_i は全項目任意）。エラーは表示用のメッセージキーで返し、
 * サービス層が t() で現在言語に解決する（本モジュールは i18n に実行時依存しない）
 */
export function validateRobinsIPrespecDialog(
  state: RobinsIPrespecDialogState,
): MessageKey | null {
  if (state.kind === 'robins_i_sq' && state.effect === null) {
    return 'schema.prespecErrRobinsIEffectRequired';
  }
  return null;
}

/** ダイアログ状態 → 確定値（トリム + 空 → null。リストは行分割して正規化） */
export function robinsIDialogToPrespec(state: RobinsIPrespecDialogState): RobinsIPrespec {
  const normalize = (value: string): string | null => {
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
  };
  return {
    design: normalize(state.design),
    participants: normalize(state.participants),
    experimental: normalize(state.experimental),
    comparator: normalize(state.comparator),
    outcome: normalize(state.outcome),
    benefitHarm: state.benefitHarm,
    effect: state.effect,
    confoundingDomains: parseListInput(state.confoundingDomains),
    coInterventions: parseListInput(state.coInterventions),
  };
}

/** 確定値 → note へ保存する構造化 JSON（キーは Sheets 側の慣例に合わせ snake_case） */
export function serializeRobinsIPrespecNote(prespec: RobinsIPrespec): string {
  return JSON.stringify({
    type: NOTE_TYPE,
    version: 1,
    design: prespec.design,
    participants: prespec.participants,
    experimental: prespec.experimental,
    comparator: prespec.comparator,
    outcome: prespec.outcome,
    benefit_harm: prespec.benefitHarm,
    effect: prespec.effect,
    confounding_domains: prespec.confoundingDomains,
    co_interventions: prespec.coInterventions,
  });
}

const EFFECT_VALUES: readonly RobinsIEffect[] = ['assignment', 'starting_adhering'];
const BENEFIT_HARM_VALUES: readonly RobinsIBenefitHarm[] = ['benefit', 'harm'];

function parseOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === 'string' && item.trim() !== '');
}

/**
 * note の JSON から事前設定を復元する（再挿入時の初期値）。
 * note が無い・JSON でない・型識別子が違う・型が崩れている場合は null（防御的に読む）
 */
export function parseRobinsIPrespecNote(note: string | null): RobinsIPrespec | null {
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
  const benefitHarmRaw = record['benefit_harm'];
  return {
    design: parseOptionalString(record['design']),
    participants: parseOptionalString(record['participants']),
    experimental: parseOptionalString(record['experimental']),
    comparator: parseOptionalString(record['comparator']),
    outcome: parseOptionalString(record['outcome']),
    benefitHarm: (BENEFIT_HARM_VALUES as readonly unknown[]).includes(benefitHarmRaw)
      ? (benefitHarmRaw as RobinsIBenefitHarm)
      : null,
    effect: (EFFECT_VALUES as readonly unknown[]).includes(effectRaw)
      ? (effectRaw as RobinsIEffect)
      : null,
    confoundingDomains: parseStringArray(record['confounding_domains']),
    coInterventions: parseStringArray(record['co_interventions']),
  };
}

/** エディタ行から既存の事前設定を探す（再挿入時のダイアログ初期値。無ければ null） */
export function findRobinsIPrespecInRows(rows: readonly SchemaEditorRow[]): RobinsIPrespec | null {
  for (const row of rows) {
    if (row.fieldName === 'robins_i_judgement') {
      const parsed = parseRobinsIPrespecNote(row.note);
      if (parsed !== null) {
        return parsed;
      }
    }
  }
  return null;
}

/** effect of interest の英文（tool template の "Is your aim for this study…?" の選択肢文言） */
const EFFECT_PHRASES: Record<RobinsIEffect, string> = {
  assignment: 'to assess the effect of assignment to intervention',
  starting_adhering: 'to assess the effect of starting and adhering to intervention',
};

/**
 * 抽出指示の冒頭へ注入する Review context（英文サマリ）。入力があった項目だけを列挙し、
 * 何も入力が無ければ null（軽量版のスキップ・全項目未入力と同じ扱い = 回帰なし）。
 * includeLists: 軽量版（判定 + 根拠の 2 行のみ）は confounding domains / co-interventions も
 * 共通 context に含める。SQ 完全版では全 30 問超への重複注入を避け、SQ 1.4 / 1.7 / 4.3 への
 * 狙い撃ち注入（buildRobinsISqRows）に委ねるため false にする
 */
export function buildRobinsIReviewContext(
  prespec: RobinsIPrespec,
  options: { includeLists: boolean },
): string | null {
  const parts: string[] = [];
  if (prespec.design !== null) {
    parts.push(`Target trial design: ${prespec.design}.`);
  }
  if (prespec.participants !== null) {
    parts.push(`Target trial participants: ${prespec.participants}.`);
  }
  if (prespec.experimental !== null) {
    parts.push(`Target trial experimental intervention: ${prespec.experimental}.`);
  }
  if (prespec.comparator !== null) {
    parts.push(`Target trial comparator: ${prespec.comparator}.`);
  }
  if (prespec.outcome !== null) {
    parts.push(`Outcome being assessed for risk of bias: ${prespec.outcome}.`);
  }
  if (prespec.benefitHarm !== null) {
    parts.push(`This outcome is a proposed ${prespec.benefitHarm} of intervention.`);
  }
  if (prespec.effect !== null) {
    parts.push(`The review team's aim for this study is ${EFFECT_PHRASES[prespec.effect]}.`);
  }
  if (options.includeLists) {
    if (prespec.confoundingDomains.length > 0) {
      parts.push(
        `Important confounding domains pre-specified by the review team: ${prespec.confoundingDomains.join('; ')}.`,
      );
    }
    if (prespec.coInterventions.length > 0) {
      parts.push(
        'Co-interventions that could be different between intervention groups and that could ' +
          `impact on outcomes: ${prespec.coInterventions.join('; ')}.`,
      );
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

/** SQ 1.4 / 1.7 に注入する "all the important confounding domains" の定義文（リスト入力時のみ） */
function confoundingDomainsNote(prespec: RobinsIPrespec): string | null {
  if (prespec.confoundingDomains.length === 0) {
    return null;
  }
  return (
    'In this review, "all the important confounding domains" refers to: ' +
    `${prespec.confoundingDomains.join('; ')}.`
  );
}

/** SQ 4.3 に注入する "important co-interventions" の定義文（リスト入力時のみ） */
function coInterventionsNote(prespec: RobinsIPrespec): string | null {
  if (prespec.coInterventions.length === 0) {
    return null;
  }
  return (
    'In this review, the important co-interventions to consider are: ' +
    `${prespec.coInterventions.join('; ')}.`
  );
}

/** confounding domains の定義文を注入する SQ の field_name（Box 4 の 1.4 / 1.7） */
const CONFOUNDING_TARGET_FIELDS: ReadonlySet<string> = new Set([
  'robins_i_sq1_4',
  'robins_i_sq1_7',
]);

/** co-interventions の定義文を注入する SQ の field_name（Box 7 の 4.3） */
const CO_INTERVENTION_TARGET_FIELDS: ReadonlySet<string> = new Set(['robins_i_sq4_3']);

/**
 * robins_i（軽量版）の行生成。事前設定が空（スキップ・全項目未入力）なら現行テンプレートと
 * 同一の行を返す（回帰なし）。入力があれば各行へ Review context（リスト込み）を注入し、
 * 判定行の note に構造化 JSON を保存する
 */
export function buildRobinsILiteRows(prespec: RobinsIPrespec): SchemaEditorRow[] {
  const context = buildRobinsIReviewContext(prespec, { includeLists: true });
  if (context === null) {
    return ROB_TEMPLATE_ROBINS_I.map((row) => ({ ...row }));
  }
  return ROB_TEMPLATE_ROBINS_I.map((row) => ({
    ...row,
    extractionInstruction: `${context}\n${row.extractionInstruction}`,
    note: row.fieldName === 'robins_i_judgement' ? serializeRobinsIPrespecNote(prespec) : row.note,
  }));
}

/**
 * robins_i_sq（SQ 完全版）の行生成。effect of interest（必須）に応じて D4 の SQ セットを
 * 排他生成し、全行へ Review context を注入する。confounding domains リストは SQ 1.4 / 1.7、
 * co-interventions リストは SQ 4.3 の instruction に定義文として注入し、
 * 判定行の note に構造化 JSON を保存する
 */
export function buildRobinsISqRows(prespec: RobinsIPrespec): SchemaEditorRow[] {
  if (prespec.effect === null) {
    // validateRobinsIPrespecDialog で確定前に弾かれる想定（プログラミングエラーの検出）
    throw new Error('robins_i_sq の挿入には effect of interest の選択が必要です');
  }
  const rows = buildRobinsISqTemplateRows(prespec.effect);
  // effect が非 null のため Review context は必ず生成される（buildRobinsIReviewContext の不変条件）
  const context = buildRobinsIReviewContext(prespec, { includeLists: false }) as string;
  const confoundingNote = confoundingDomainsNote(prespec);
  const coInterventionNote = coInterventionsNote(prespec);
  return rows.map((row) => {
    const extras: string[] = [context];
    if (confoundingNote !== null && CONFOUNDING_TARGET_FIELDS.has(row.fieldName)) {
      extras.push(confoundingNote);
    }
    if (coInterventionNote !== null && CO_INTERVENTION_TARGET_FIELDS.has(row.fieldName)) {
      extras.push(coInterventionNote);
    }
    return {
      ...row,
      extractionInstruction: `${extras.join('\n')}\n${row.extractionInstruction}`,
      note:
        row.fieldName === 'robins_i_judgement' ? serializeRobinsIPrespecNote(prespec) : row.note,
    };
  });
}
