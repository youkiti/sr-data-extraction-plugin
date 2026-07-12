// レビュアー間一致度レポート（issue #66）。
// 独立二重レビュー（v0.11）で human annotator 2 名の値が StudyData / ResultsData に揃うため、
// 項目単位の一致率・Cohen's κ・不一致セル一覧を計算する。セル突き合わせ自体は
// features/adjudication/cellMatch.ts（buildAdjudicationCells）の正準実装をそのまま入力に使い、
// このモジュールは統計の集計 + CSV 化のみを担う（突き合わせ規則〔trim 完全一致・
// NOT_REPORTED_TOKEN 同士は一致・片側未入力は不一致〕の再実装はしない）。
//
// 【一致率・κ の分母】両者とも入力済み（valueA・valueB とも非 null）のセルのみを対象にする。
// 片側未入力は「まだ検証が終わっていないだけ」で評価不能（検証の完了度の問題）として統計からは
// 除外するが、実務上は要確認セルのため不一致一覧には含める（cellMatch の `matches` は片側 null も
// 不一致として扱うため、そのままフィルタなしで不一致一覧に使い回せる）。
//
// 【Cohen's κ（Cohen, J. 1960. "A coefficient of agreement for nominal scales."
// Educational and Psychological Measurement, 20(1), 37-46.）】
// カテゴリ = trim 後の値文字列（NOT_REPORTED_TOKEN も 1 カテゴリとして扱う。自由記述・数値項目でも
// 「trim 後に完全一致した文字列 = 同じカテゴリ」という形式的な定義で κ を計算できる、という整理）。
//   po（観測一致率） = agreementCount / pairCount
//   pe（偶然一致率） = Σ_v pA(v)・pB(v)（pA / pB は各レビュアーのカテゴリ周辺分布。v は両者の値の和集合）
//   κ = (po − pe) / (1 − pe)
// 1 − pe が 0（例: 両者が全セルで同一カテゴリのみを使っている）のときは κ が定義できないため
// null を返す（UI は「—」+ 注記を表示する）。pairCount = 0 も同様に null。
//
// 【項目の集計単位】study によって human annotator ペアが異なりうるが、v1 は「2 名の評価者間一致」
// として全 ready study をプールして fieldId ごとに集計する（study ごとの κ を出して平均する、
// といった加重はしない素朴な集計）。
import type { SchemaField } from '../../domain/schemaField';
import { buildCsv } from '../export/csvEncode';
import type { AdjudicationCell } from './cellMatch';

/** 1 study ぶんの突き合わせ済みセル（cellMatch.buildAdjudicationCells の出力をそのまま渡す） */
export interface AgreementStudyInput {
  studyId: string;
  studyLabel: string;
  cells: readonly AdjudicationCell[];
}

export interface FieldAgreement {
  fieldId: string;
  fieldName: string;
  fieldLabel: string;
  /** 両者とも入力済み（valueA・valueB とも非 null）のセル数 = 分母 */
  pairCount: number;
  agreementCount: number;
  /** pairCount 0 → null */
  agreementRate: number | null;
  /** pairCount 0 または 1 − pe が 0 → null */
  kappa: number | null;
}

export interface AgreementDisagreement {
  studyId: string;
  studyLabel: string;
  entityKey: string;
  fieldId: string;
  fieldLabel: string;
  /** null = 未入力 */
  valueA: string | null;
  valueB: string | null;
}

export interface AgreementReport {
  /** レポート対象（ready ペア）の study 数 */
  studyCount: number;
  /** 最新確定スキーマの項目順 */
  fields: FieldAgreement[];
  /** 全項目プールの合算（fields と同じ規則） */
  overall: Pick<FieldAgreement, 'pairCount' | 'agreementCount' | 'agreementRate' | 'kappa'>;
  /** 不一致セル一覧（study → セル出現順。片側未入力の不一致も含む） */
  disagreements: AgreementDisagreement[];
}

type AgreementStats = Pick<FieldAgreement, 'pairCount' | 'agreementCount' | 'agreementRate' | 'kappa'>;

/** 1 − pe の丸め誤差許容差（浮動小数演算で厳密に 0 にならないケースを吸収する） */
const KAPPA_DENOM_EPSILON = 1e-9;

/**
 * セル集合から一致率・κ を計算する（分母は両者とも入力済みのセルのみ。ファイル冒頭コメント参照）。
 * cell.matches（cellMatch.ts の trim 完全一致判定）をそのまま観測一致率へ採用し、
 * κ のカテゴリ分布だけこの関数内で trim 後の値文字列として組み直す
 */
function computeAgreementStats(cells: readonly AdjudicationCell[]): AgreementStats {
  const paired = cells.filter((cell) => cell.valueA !== null && cell.valueB !== null);
  const pairCount = paired.length;
  if (pairCount === 0) {
    return { pairCount: 0, agreementCount: 0, agreementRate: null, kappa: null };
  }
  const agreementCount = paired.filter((cell) => cell.matches).length;
  const agreementRate = agreementCount / pairCount;

  const countsA = new Map<string, number>();
  const countsB = new Map<string, number>();
  for (const cell of paired) {
    // pairCount 分母のフィルタ済みなので valueA / valueB は非 null
    const a = (cell.valueA as string).trim();
    const b = (cell.valueB as string).trim();
    countsA.set(a, (countsA.get(a) ?? 0) + 1);
    countsB.set(b, (countsB.get(b) ?? 0) + 1);
  }
  const categories = new Set<string>([...countsA.keys(), ...countsB.keys()]);
  let pe = 0;
  for (const category of categories) {
    const pA = (countsA.get(category) ?? 0) / pairCount;
    const pB = (countsB.get(category) ?? 0) / pairCount;
    pe += pA * pB;
  }
  const denom = 1 - pe;
  const kappa = Math.abs(denom) < KAPPA_DENOM_EPSILON ? null : (agreementRate - pe) / denom;
  return { pairCount, agreementCount, agreementRate, kappa };
}

/**
 * 項目単位の一致率・κ + 不一致セル一覧を組み立てる。
 * fields は最新確定スキーマの全項目（fieldIndex 順に並べ直す）、studies は ready ペア
 * （human annotator ちょうど 2 名）が確定した study のみを渡すこと（呼び出し元の責務）
 */
export function buildAgreementReport(
  fields: readonly SchemaField[],
  studies: readonly AgreementStudyInput[],
): AgreementReport {
  const orderedFields = [...fields].sort((a, b) => a.fieldIndex - b.fieldIndex);

  const fieldAgreements: FieldAgreement[] = orderedFields.map((field) => {
    const cellsForField: AdjudicationCell[] = [];
    for (const study of studies) {
      for (const cell of study.cells) {
        if (cell.field.fieldId === field.fieldId) {
          cellsForField.push(cell);
        }
      }
    }
    return {
      fieldId: field.fieldId,
      fieldName: field.fieldName,
      fieldLabel: field.fieldLabel,
      ...computeAgreementStats(cellsForField),
    };
  });

  const allCells: AdjudicationCell[] = [];
  const disagreements: AgreementDisagreement[] = [];
  for (const study of studies) {
    for (const cell of study.cells) {
      allCells.push(cell);
      if (!cell.matches) {
        disagreements.push({
          studyId: study.studyId,
          studyLabel: study.studyLabel,
          entityKey: cell.entityKey,
          fieldId: cell.field.fieldId,
          fieldLabel: cell.field.fieldLabel,
          valueA: cell.valueA,
          valueB: cell.valueB,
        });
      }
    }
  }

  return {
    studyCount: studies.length,
    fields: fieldAgreements,
    overall: computeAgreementStats(allCells),
    disagreements,
  };
}

// --- CSV ビルダー（RFC 4180 の引用処理は features/export/csvEncode.ts の buildCsv を再利用） ---

/** 浮動小数の桁化け（0.5714285714285714 等）を避けるため小数 4 桁に丸めて文字列化する */
function roundForCsv(value: number): string {
  return String(Math.round(value * 10000) / 10000);
}

function numericCsvCell(value: number | null): string {
  return value === null ? '' : roundForCsv(value);
}

/** ヘッダ: field_id,field_name,field_label,pair_count,agreement_count,agreement_rate,kappa（末尾に overall 行） */
export function buildAgreementSummaryCsv(report: AgreementReport): string {
  const header = ['field_id', 'field_name', 'field_label', 'pair_count', 'agreement_count', 'agreement_rate', 'kappa'];
  const rows: string[][] = report.fields.map((field) => [
    field.fieldId,
    field.fieldName,
    field.fieldLabel,
    String(field.pairCount),
    String(field.agreementCount),
    numericCsvCell(field.agreementRate),
    numericCsvCell(field.kappa),
  ]);
  rows.push([
    '(overall)',
    '',
    '(overall)',
    String(report.overall.pairCount),
    String(report.overall.agreementCount),
    numericCsvCell(report.overall.agreementRate),
    numericCsvCell(report.overall.kappa),
  ]);
  return buildCsv(header, rows);
}

/** ヘッダ: study_id,study_label,entity_key,field_id,field_label,value_a,value_b（null = 空セル） */
export function buildAgreementDisagreementsCsv(report: AgreementReport): string {
  const header = ['study_id', 'study_label', 'entity_key', 'field_id', 'field_label', 'value_a', 'value_b'];
  const rows: string[][] = report.disagreements.map((item) => [
    item.studyId,
    item.studyLabel,
    item.entityKey,
    item.fieldId,
    item.fieldLabel,
    item.valueA ?? '',
    item.valueB ?? '',
  ]);
  return buildCsv(header, rows);
}
