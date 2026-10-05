// 共同研究者との相談用ドキュメント（Google ドキュメント）の本文 HTML を組み立てる純関数。
// Drive は text/html を Google ドキュメントへ変換して保存できるため、ここでは完全な HTML 文字列だけを返す
// （Drive 呼び出しは app/services/schemaConsultDocService.ts の責務）。
// 載せるもの: スキーマ項目・パイロットの AI 例・項目別の判定内訳・RoB 等の事前設定。
// 載せないもの: 判定のメモ（Decision.note）、アンカリング結果（anchor_status）、独立二重レビュー
// （human_independent）の行。判定は human_with_ai の行だけを入力に使う。
import type { Decision } from '../../domain/decision';
import type { Evidence } from '../../domain/evidence';
import type { ExtractionRun } from '../../domain/extractionRun';
import type { SchemaField } from '../../domain/schemaField';
import type { SchemaVersion } from '../../domain/schemaVersion';
import { cellKeyOf } from '../verification/cellState';
import { entityKeyLabel } from '../verification/cells';
import { bundleEvidence } from '../verification/evidenceBundles';
import { buildPilotMatrix, type PilotEntity } from '../verification/pilotMatrix';
import { parseQuadas3PrespecNote, type Quadas3Prespec } from './presets/quadas3Prespec';
import { parseQuipsPrespecNote, type QuipsPrespec } from './presets/quipsPrespec';
import { parseRob2PrespecNote, type Rob2Prespec } from './presets/robPrespec';
import type { Rob2DeviationType } from './presets/robTemplates';
import { parseRobinsIPrespecNote, type RobinsIPrespec } from './presets/robinsIPrespec';

/** パイロットの素材。decisions は本人の human_with_ai 行（呼び出し側で絞る。ここでも防御的に絞る） */
export interface SchemaConsultDocPilot {
  run: ExtractionRun;
  evidence: readonly Evidence[];
  decisions: readonly Decision[];
  /** study_id → 表示ラベル。無い study は study_id をそのまま出す */
  studyLabels: ReadonlyMap<string, string>;
}

export interface SchemaConsultDocInput {
  projectName: string;
  schemaVersion: SchemaVersion;
  fields: readonly SchemaField[];
  /** 出力日（YYYY-MM-DD）。ファイル名と同じ日付 */
  exportedDate: string;
  /** null = この版のパイロットなし（AI 例と判定内訳を省く） */
  pilot: SchemaConsultDocPilot | null;
}

/** HTML 特殊文字をエスケープする（利用者・LLM 由来の文字列は必ず通す） */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const TABLE_ATTRS = 'border="1" cellpadding="4" style="border-collapse:collapse"';
const DIFF_MARK = '★ AI と異なる';

const e = escapeHtml;
const dateOf = (iso: string | null): string => (iso === null ? '—' : iso.slice(0, 10));
const cell = (html: string): string => `<td>${html}</td>`;
const head = (labels: readonly string[]): string =>
  `<tr>${labels.map((label) => `<th>${label}</th>`).join('')}</tr>`;

function renderHeader(input: SchemaConsultDocInput): string {
  const { schemaVersion, pilot } = input;
  const lines = [
    `<p>プロジェクト: ${e(input.projectName)}</p>`,
    `<p>スキーマ版: v${schemaVersion.schemaVersion}（確定日: ${e(dateOf(schemaVersion.createdAt))}、` +
      `依拠したプロトコル版: v${schemaVersion.protocolVersion}）</p>`,
    `<p>出力日: ${e(input.exportedDate)}</p>`,
  ];
  if (pilot === null) {
    lines.push('<p>この版のパイロット抽出はありません。AI の抽出例と判定内訳は載せていません。</p>');
  } else {
    const { run } = pilot;
    const model = run.modelVersion !== null && run.modelVersion !== run.requestedModel
      ? `${run.requestedModel}（実モデル: ${run.modelVersion}）`
      : run.requestedModel;
    lines.push(
      `<p>パイロット抽出: 開始 ${e(dateOf(run.startedAt))} / 終了 ${e(dateOf(run.finishedAt))}、` +
        `モデル ${e(model)}、対象 ${run.studyIds.length} 論文</p>`,
    );
  }
  return lines.join('\n');
}

interface Counts {
  accept: number;
  edit: number;
  reject: number;
  notReported: number;
  undecided: number;
}

function countEntities(entities: readonly PilotEntity[]): Counts {
  const counts: Counts = { accept: 0, edit: 0, reject: 0, notReported: 0, undecided: 0 };
  for (const entity of entities) {
    if (entity.decision === null) counts.undecided += 1;
    else if (entity.status === 'accept') counts.accept += 1;
    else if (entity.status === 'edit') counts.edit += 1;
    else if (entity.status === 'reject') counts.reject += 1;
    else counts.notReported += 1; // nrAccepted / nrMiss
  }
  return counts;
}

/** 0 より大きい修正・棄却は太字にして目立たせる */
const strongIfPositive = (count: number): string => (count > 0 ? `<b>${count}</b>` : String(count));

function renderOverview(
  fields: readonly SchemaField[],
  entitiesByField: ReadonlyMap<string, readonly PilotEntity[]> | null,
): string {
  const labels = ['#', 'セクション', '項目名', 'データ型'];
  if (entitiesByField !== null) {
    labels.push('採用', '修正', '棄却', '未報告', '未判定', '要確認');
  }
  const rows = fields.map((field, index) => {
    const cols = [
      cell(String(index + 1)),
      cell(e(field.section)),
      cell(e(field.fieldLabel)),
      cell(e(field.dataType)),
    ];
    if (entitiesByField !== null) {
      const counts = countEntities(entitiesByField.get(field.fieldId) as readonly PilotEntity[]);
      cols.push(
        cell(String(counts.accept)),
        cell(strongIfPositive(counts.edit)),
        cell(strongIfPositive(counts.reject)),
        cell(String(counts.notReported)),
        cell(String(counts.undecided)),
        cell(counts.edit + counts.reject > 0 ? '★' : ''),
      );
    }
    return `<tr>${cols.join('')}</tr>`;
  });
  return `<h2>項目の一覧</h2>\n<table ${TABLE_ATTRS}>\n${head(labels)}\n${rows.join('\n')}\n</table>`;
}

function renderFieldSpec(field: SchemaField): string {
  const items = [
    `項目名: ${e(field.fieldLabel)}（${e(field.fieldName)}）`,
    `エンティティ: ${e(field.entityLevel)} / データ型: ${e(field.dataType)}` +
      ` / 単位: ${e(field.unit ?? '—')} / 必須: ${field.required ? 'はい' : 'いいえ'}`,
  ];
  if (field.allowedValues !== null && field.allowedValues !== '') {
    const values = field.allowedValues.split('|').map((value) => value.trim());
    items.push(`許容値: ${e(values.join(' / '))}`);
  }
  if (field.multiSelect !== null) {
    const { exclusiveValues, freeTextValues } = field.multiSelect;
    items.push('複数選択: 可');
    if (exclusiveValues.length > 0) {
      items.push(`単独で選ぶ選択肢: ${e(exclusiveValues.join(' / '))}`);
    }
    if (freeTextValues.length > 0) {
      items.push(`自由記述を付ける選択肢: ${e(freeTextValues.join(' / '))}`);
    }
  }
  if (field.maxQuotes !== null) {
    items.push(`引用の上限: ${field.maxQuotes} 件（複数の根拠を引用する項目）`);
  }
  items.push(`抽出指示: ${e(field.extractionInstruction)}`);
  if (field.example !== null && field.example !== '') {
    items.push(`例: ${e(field.example)}`);
  }
  return `<ul>\n${items.map((item) => `<li>${item}</li>`).join('\n')}\n</ul>`;
}

/** 判定後の値の説明。AI と同じ判定は null（印を付けない） */
function describeDecision(entity: PilotEntity): string | null {
  const { decision, status } = entity;
  if (decision === null) return null;
  if (status === 'edit') return `修正後: ${e(decision.value ?? '')}`;
  if (status === 'reject') return '棄却（値なし）';
  if (status === 'nrMiss') return '未報告と判定（AI は値あり）';
  return null;
}

function renderQuotes(quotes: readonly Evidence[]): string {
  const lines = quotes
    .filter((quote) => quote.quote !== null && quote.quote !== '')
    .map((quote) => {
      const where = [
        quote.page === null ? null : `p.${quote.page}`,
        quote.section === null || quote.section === '' ? null : quote.section,
      ].filter((part): part is string => part !== null);
      const suffix = where.length > 0 ? `（${e(where.join(' / '))}）` : '';
      return `「${e(quote.quote as string)}」${suffix}`;
    });
  return lines.length > 0 ? lines.join('<br>') : '—';
}

function renderExamples(
  field: SchemaField,
  pilot: SchemaConsultDocPilot,
  rows: readonly {
    studyId: string;
    entities: readonly PilotEntity[];
    quotesByCell: ReadonlyMap<string, readonly Evidence[]>;
  }[],
): string {
  const body: string[] = [];
  for (const row of rows) {
    for (const entity of row.entities) {
      const evidence = entity.evidence;
      const label = pilot.studyLabels.get(row.studyId) ?? row.studyId;
      const entityText = field.entityLevel === 'study' ? '—' : entityKeyLabel(evidence.entityKey);
      const aiValue = evidence.notReported ? '未報告' : (evidence.value ?? '');
      // 行列の entity は同じ根拠から作られるため、束の引用は必ずある
      const quotes = row.quotesByCell.get(cellKeyOf(evidence.fieldId, evidence.entityKey)) as readonly Evidence[];
      const decided = describeDecision(entity);
      const decisionHtml = decided === null ? '' : `<b>${DIFF_MARK}</b><br>${decided}`;
      body.push(
        `<tr>${cell(e(label))}${cell(e(entityText))}${cell(e(aiValue))}` +
          `${cell(renderQuotes(quotes))}${cell(decisionHtml)}</tr>`,
      );
    }
  }
  if (body.length === 0) return '<p>AI の抽出例: この項目の抽出結果はありません。</p>';
  return (
    `<p>AI の抽出例（パイロット）</p>\n<table ${TABLE_ATTRS}>\n` +
    `${head(['論文', '対象', 'AI の値', '根拠の引用', '人の判定'])}\n${body.join('\n')}\n</table>`
  );
}

function renderDetails(
  fields: readonly SchemaField[],
  examplesByField: ReadonlyMap<string, string> | null,
): string {
  const sections: string[] = [];
  const order: string[] = [];
  const bySection = new Map<string, SchemaField[]>();
  for (const field of fields) {
    if (!bySection.has(field.section)) {
      order.push(field.section);
      bySection.set(field.section, []);
    }
    (bySection.get(field.section) as SchemaField[]).push(field);
  }
  for (const section of order) {
    sections.push(`<h3>セクション: ${e(section)}</h3>`);
    for (const field of bySection.get(section) as SchemaField[]) {
      sections.push(`<h4>${e(field.fieldLabel)}</h4>`, renderFieldSpec(field));
      const examples = examplesByField?.get(field.fieldId);
      if (examples !== undefined) sections.push(examples);
    }
  }
  return `<h2>項目の詳細</h2>\n${sections.join('\n')}`;
}

const ROB2_DEVIATION_LABELS: Record<Rob2DeviationType, string> = {
  non_protocol_interventions: 'プロトコル外の介入の発生',
  implementation_failures: '介入の実施の不備',
  non_adherence: '参加者の割付け介入への非遵守',
};

type PrespecLine = readonly [label: string, value: string | null];

function renderPrespecBlock(title: string, lines: readonly PrespecLine[]): string {
  const items = lines
    .filter((line): line is readonly [string, string] => line[1] !== null && line[1] !== '')
    .map(([label, value]) => `<li>${e(label)}: ${e(value)}</li>`);
  const body = items.length > 0 ? `<ul>\n${items.join('\n')}\n</ul>` : '<p>入力なし</p>';
  return `<h3>${e(title)}</h3>\n${body}`;
}

const joinList = (values: readonly string[]): string | null => (values.length > 0 ? values.join(' / ') : null);

function rob2Lines(p: Rob2Prespec): PrespecLine[] {
  const effect = p.effect === null ? null
    : p.effect === 'assignment' ? '割付けの効果（ITT）' : '遵守の効果（per-protocol）';
  return [
    ['試験デザイン', '個別無作為化・並行群間比較試験'],
    ['試験介入', p.experimental], ['対照', p.comparator], ['アウトカム', p.outcome],
    ['評価する数値結果', p.numericalResult], ['関心のある効果', effect],
    // 逸脱の種類は遵守の効果（adhering）を選んだときだけ意味を持つ
    ['扱う逸脱の種類', p.effect === 'adhering' ? joinList(p.deviationTypes.map((type) => ROB2_DEVIATION_LABELS[type])) : null],
  ];
}

function robinsILines(p: RobinsIPrespec): PrespecLine[] {
  const effect = p.effect === null ? null
    : p.effect === 'assignment' ? '割付けの効果' : '介入の開始と遵守の効果';
  const benefitHarm = p.benefitHarm === null ? null : p.benefitHarm === 'benefit' ? '介入の益' : '介入の害';
  return [
    ['目標とする試験のデザイン', p.design], ['対象者', p.participants], ['試験介入', p.experimental],
    ['対照', p.comparator], ['アウトカム', p.outcome], ['益か害か', benefitHarm],
    ['評価する数値結果', p.numericalResult], ['関心のある効果', effect],
    ['重要な交絡の領域', joinList(p.confoundingDomains)], ['併用介入', joinList(p.coInterventions)],
  ];
}

function quadas3Lines(p: Quadas3Prespec): PrespecLine[] {
  return [
    ['統合の問いの対象集団', p.population], ['対象の検査', p.indexTest], ['対象の病態', p.targetCondition],
    ['理想的な試験の想定対象集団', p.intendedUsePopulation], ['検査の役割と位置づけ', p.testRole],
    ['参照基準', p.referenceStandard], ['解析の単位', p.analysisUnit],
  ];
}

function quipsLines(p: QuipsPrespec): PrespecLine[] {
  return [
    ['対象集団', p.population], ['予後因子', p.prognosticFactor], ['アウトカム（追跡期間を含む）', p.outcome],
    ['主要な特性', joinList(p.keyCharacteristics)], ['重要な交絡因子', joinList(p.importantConfounders)],
  ];
}

/** 項目の note から RoB 等の事前設定を探し、ツールごとに最初の 1 件を読みやすい形で並べる */
function renderPrespec(fields: readonly SchemaField[]): string {
  const finders: readonly {
    title: string;
    find: (note: string | null) => readonly PrespecLine[] | null;
  }[] = [
    { title: 'RoB 2', find: (note) => { const p = parseRob2PrespecNote(note); return p && rob2Lines(p); } },
    { title: 'ROBINS-I', find: (note) => { const p = parseRobinsIPrespecNote(note); return p && robinsILines(p); } },
    { title: 'QUADAS-3', find: (note) => { const p = parseQuadas3PrespecNote(note); return p && quadas3Lines(p); } },
    { title: 'QUIPS', find: (note) => { const p = parseQuipsPrespecNote(note); return p && quipsLines(p); } },
  ];
  const blocks: string[] = [];
  for (const { title, find } of finders) {
    for (const field of fields) {
      const lines = find(field.note);
      if (lines !== null) {
        blocks.push(renderPrespecBlock(title, lines));
        break;
      }
    }
  }
  return blocks.length > 0 ? `<h2>事前設定（RoB 等）</h2>\n${blocks.join('\n')}` : '';
}

/** 相談用ドキュメントの HTML 全文を返す。 */
export function buildSchemaConsultDocHtml(input: SchemaConsultDocInput): string {
  const fields = [...input.fields].sort((a, b) => a.fieldIndex - b.fieldIndex);
  let entitiesByField: Map<string, PilotEntity[]> | null = null;
  let examplesByField: Map<string, string> | null = null;
  const { pilot } = input;
  if (pilot !== null) {
    const evidence = pilot.evidence.filter((item) => item.runId === pilot.run.runId);
    const decisions = pilot.decisions.filter((item) => item.annotatorType === 'human_with_ai');
    const matrix = buildPilotMatrix(pilot.run.studyIds, fields, evidence, decisions);
    entitiesByField = new Map();
    examplesByField = new Map();
    const quotesByStudy = new Map(pilot.run.studyIds.map((studyId) => [
      studyId,
      new Map([...bundleEvidence(evidence.filter((item) => item.studyId === studyId))]
        .map(([key, bundle]) => [key, bundle.quotes.length > 0 ? bundle.quotes : [bundle.evidence]] as const)),
    ]));
    for (const row of matrix) {
      entitiesByField.set(row.field.fieldId, row.cells.flatMap((c) => c.entities));
      examplesByField.set(row.field.fieldId, renderExamples(row.field, pilot, row.cells.map((c) => ({
        studyId: c.studyId,
        entities: c.entities,
        quotesByCell: quotesByStudy.get(c.studyId) as Map<string, readonly Evidence[]>,
      }))));
    }
  }
  const body = [
    `<h1>データ抽出スキーマ v${input.schemaVersion.schemaVersion} 相談用</h1>`,
    renderHeader(input),
    renderOverview(fields, entitiesByField),
    renderDetails(fields, examplesByField),
    renderPrespec(fields),
  ].filter((part) => part !== '');
  return (
    '<!DOCTYPE html>\n<html lang="ja">\n<head><meta charset="UTF-8">' +
    `<title>${e(input.projectName)} スキーマ v${input.schemaVersion.schemaVersion} 相談用</title></head>\n` +
    `<body>\n${body.join('\n')}\n</body>\n</html>`
  );
}
