// dataset1 の人手 gold（numeric triplet の行B + string long の human 列）を
// gold/{paperId}.json（GoldFile 形状）へ変換する。
//
// 入力（raw/ 配下・convert 前に decode 済み）:
//   - raw/dataset1_conventional_n-shot.xlsx : 数値 58 変数。1 arm = 3 行（行A=LLM, 行B=人手gold, 行C=突合）。
//   - raw/dataset1_string.xlsx              : 文字列 10 変数。long 形式（C4=変数, C7=human=gold）。
// gold 行の同定は compareGold.ts で確認済み（行B が手法間で不変 = 人手 gold）。
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import * as XLSX from 'xlsx';
import { selectGoldBlocks } from './goldBlocks';
import { benchRoot } from './config';
import { ALL_FIELDS, NUMERIC_FIELDS, STRING_FIELDS, toFieldId, type FieldDef } from './fields';

const NUMERIC_XLSX = path.join(benchRoot, 'raw', 'dataset1_conventional_n-shot.xlsx');
const STRING_XLSX = path.join(benchRoot, 'raw', 'dataset1_string.xlsx');
const GOLD_DIR = path.join(benchRoot, 'gold');
const SCHEMA_VERSION = 1;

/** gold として「未報告」とみなすセル値（正規化前の生値） */
const MISSING = new Set(['', '*', 'na', 'n/a', 'nan', 'none', 'null']);
function isMissing(v: string): boolean {
  return MISSING.has(v.trim().toLowerCase());
}

interface GoldRow {
  field_id: string;
  entity_key: string;
  not_reported: boolean;
  value_gold: string | null;
  acceptable_values: string[];
  source_page: number | null;
  source_quote: string | null;
  note: string | null;
}

function makeRow(fieldId: string, entityKey: string, rawValue: string): GoldRow {
  const reported = !isMissing(rawValue);
  return {
    field_id: fieldId,
    entity_key: entityKey,
    not_reported: !reported,
    value_gold: reported ? rawValue.trim() : null,
    acceptable_values: [],
    source_page: null,
    source_quote: null,
    note: null,
  };
}

function cellStr(ws: XLSX.WorkSheet, r: number, c: number): string {
  const cell = ws[XLSX.utils.encode_cell({ r, c })];
  if (!cell || cell.v === undefined || cell.v === null) return '';
  return String(cell.v);
}

const differentPapers = new Set<string>();
let skippedBlocks = 0;

/** 生の gold 値をブロック内の群・項目順に比較し、採用行を返す。 */
function acceptedRows(ws: XLSX.WorkSheet, numeric: boolean): Set<number> {
  const range = XLSX.utils.decode_range(ws['!ref']!);
  const rows: Array<{ paper: string; block: string; row: number; values: string[] }> = [];
  for (let r = range.s.r + 1; r <= range.e.r; r++) {
    const paper = cellStr(ws, r, numeric ? 4 : 3).trim();
    if (!paper || (!numeric && !cellStr(ws, r, 4).trim())) continue;
    const start = numeric ? 1 : 0;
    const block = JSON.stringify([0, 1, 2].map((i) => cellStr(ws, r, start + i)));
    const values = numeric
      ? NUMERIC_FIELDS.map((_, i) => cellStr(ws, r + 1, 6 + i))
      : [cellStr(ws, r, 4), cellStr(ws, r, 7)];
    rows.push({ paper, block, row: r, values });
  }
  const accepted = selectGoldBlocks(rows);
  const blocks = new Map<string, Map<string, string[][]>>();
  rows.forEach(({ paper, block, values }) => {
    if (!blocks.has(paper)) blocks.set(paper, new Map());
    const byBlock = blocks.get(paper)!;
    if (!byBlock.has(block)) byBlock.set(block, []);
    byBlock.get(block)!.push(values);
  });
  for (const [paper, byBlock] of blocks) {
    const [first, ...others] = [...byBlock.values()];
    skippedBlocks += others.length;
    if (others.some((values) => JSON.stringify(values) !== JSON.stringify(first))) differentPapers.add(paper);
  }
  return new Set(rows.filter((_, i) => accepted[i]).map((row) => row.row));
}

// ---- 数値 xlsx（triplet） ----
interface NumericArm {
  labelFromNumeric: string;
  /** fieldId -> 生セル値（行B = 人手 gold） */
  values: Map<string, string>;
}
interface NumericPaper {
  arms: NumericArm[];
}

function parseNumeric(ws: XLSX.WorkSheet): Map<string, NumericPaper> {
  const range = XLSX.utils.decode_range(ws['!ref']!);
  // ヘッダ検証: C6..C63 が NUMERIC_FIELDS と一致しているか
  for (let i = 0; i < NUMERIC_FIELDS.length; i++) {
    const header = cellStr(ws, 0, 6 + i);
    if (toFieldId(header) !== NUMERIC_FIELDS[i]!.fieldId) {
      throw new Error(
        `数値 xlsx の列 ${6 + i} ヘッダ "${header}"（=${toFieldId(header)}）が想定 "${NUMERIC_FIELDS[i]!.fieldId}" と一致しません`,
      );
    }
  }

  const accepted = acceptedRows(ws, true);
  const papers = new Map<string, NumericPaper>();
  for (let r = range.s.r + 1; r <= range.e.r; r++) {
    const paperName = cellStr(ws, r, 4).trim(); // 行A（メタ付き）に paper_name
    if (paperName === '') continue;
    if (!accepted.has(r)) continue;
    const goldRow = r + 1; // 行B = 人手 gold
    const values = new Map<string, string>();
    for (let i = 0; i < NUMERIC_FIELDS.length; i++) {
      values.set(NUMERIC_FIELDS[i]!.fieldId, cellStr(ws, goldRow, 6 + i));
    }
    const armLabel = cellStr(ws, goldRow, 5).trim() || cellStr(ws, r, 5).trim();
    const paper = papers.get(paperName) ?? { arms: [] };
    paper.arms.push({ labelFromNumeric: armLabel, values });
    papers.set(paperName, paper);
  }
  return papers;
}

// ---- 文字列 xlsx（long） ----
interface StringArm {
  armName: string; // human 列の arm_name
  /** fieldId -> 生 human 値 */
  values: Map<string, string>;
}
interface StringPaper {
  /** study 級文字列変数（arm 間で共通。最初の arm から採取） */
  study: Map<string, string>;
  arms: StringArm[];
}

const STRING_STUDY_IDS = new Set(STRING_FIELDS.filter((f) => f.entityLevel === 'study').map((f) => f.fieldId));

function parseString(ws: XLSX.WorkSheet): Map<string, StringPaper> {
  const range = XLSX.utils.decode_range(ws['!ref']!);
  const accepted = acceptedRows(ws, false);
  const papers = new Map<string, StringPaper>();
  let curPaper: string | null = null;
  let curArm: StringArm | null = null;

  for (let r = range.s.r + 1; r <= range.e.r; r++) {
    const paperName = cellStr(ws, r, 3).trim();
    const varName = cellStr(ws, r, 4).trim();
    const human = cellStr(ws, r, 7);
    if (paperName === '' || varName === '' || !accepted.has(r)) continue;

    if (paperName !== curPaper) {
      curPaper = paperName;
      curArm = null;
      if (!papers.has(paperName)) papers.set(paperName, { study: new Map(), arms: [] });
    }
    const paper = papers.get(paperName)!;
    const fieldId = toFieldId(varName);

    if (fieldId === 'arm_name') {
      curArm = { armName: human, values: new Map() };
      paper.arms.push(curArm);
      continue;
    }
    if (STRING_STUDY_IDS.has(fieldId)) {
      if (!paper.study.has(fieldId)) paper.study.set(fieldId, human); // 最初の arm 分だけ採用
    } else if (curArm) {
      curArm.values.set(fieldId, human);
    }
  }
  return papers;
}

const NUMERIC_STUDY = NUMERIC_FIELDS.filter((f) => f.entityLevel === 'study');
const NUMERIC_ARM = NUMERIC_FIELDS.filter((f) => f.entityLevel === 'arm');

function buildGoldFile(
  paperId: string,
  num: NumericPaper | undefined,
  str: StringPaper | undefined,
): { rows: GoldRow[]; armCount: number } {
  const rows: GoldRow[] = [];
  const armCount = Math.max(num?.arms.length ?? 0, str?.arms.length ?? 0);

  // --- study 級 ---
  // 数値 study（year/icc/sleep_diary_weeks/r_weeks_long）: numeric arm1 から
  if (num && num.arms.length > 0) {
    for (const f of NUMERIC_STUDY) {
      rows.push(makeRow(f.fieldId, '-', num.arms[0]!.values.get(f.fieldId) ?? ''));
    }
  }
  // 文字列 study: string.study から
  if (str) {
    for (const f of STRING_FIELDS) {
      if (f.entityLevel !== 'study') continue;
      if (str.study.has(f.fieldId)) rows.push(makeRow(f.fieldId, '-', str.study.get(f.fieldId)!));
    }
  }

  // --- arm 級（arm:1..） ---
  for (let a = 0; a < armCount; a++) {
    const entityKey = `arm:${a + 1}`;
    const strArm = str?.arms[a];
    const numArm = num?.arms[a];
    // arm_name（文字列 gold）。無ければ numeric のラベルで代替
    const armName = strArm?.armName ?? numArm?.labelFromNumeric ?? '';
    rows.push(makeRow('arm_name', entityKey, armName));
    // 数値 arm 変数
    if (numArm) {
      for (const f of NUMERIC_ARM) {
        rows.push(makeRow(f.fieldId, entityKey, numArm.values.get(f.fieldId) ?? ''));
      }
    }
  }
  return { rows, armCount };
}

async function main(): Promise<void> {
  const numWb = XLSX.read(await readFile(NUMERIC_XLSX), { type: 'buffer' });
  const strWb = XLSX.read(await readFile(STRING_XLSX), { type: 'buffer' });
  const numeric = parseNumeric(numWb.Sheets[numWb.SheetNames[0]!]!);
  const stringly = parseString(strWb.Sheets[strWb.SheetNames[0]!]!);

  const allPapers = new Set<string>([...numeric.keys(), ...stringly.keys()]);
  await mkdir(GOLD_DIR, { recursive: true });

  // 診断: gold セルの sentinel 分布（-1 が gold にどれだけ出るか）
  let dashCount = 0;
  let starCount = 0;
  for (const p of numeric.values())
    for (const arm of p.arms)
      for (const v of arm.values.values()) {
        if (v.trim() === '-1') dashCount++;
        if (v.trim() === '*') starCount++;
      }

  const inventory: Array<{ paper: string; numArms: number; strArms: number; inBoth: boolean; rows: number }> = [];
  for (const paper of [...allPapers].sort()) {
    const num = numeric.get(paper);
    const str = stringly.get(paper);
    const { rows, armCount } = buildGoldFile(paper, num, str);
    const goldFile = {
      pdf_id: paper,
      pmcid: '',
      schema_version: SCHEMA_VERSION,
      created_by: 'insomnia DE (human, imported from dataset1 analysis xlsx)',
      created_at: '',
      rows,
    };
    await writeFile(path.join(GOLD_DIR, `${paper}.json`), JSON.stringify(goldFile, null, 2), 'utf8');
    inventory.push({
      paper,
      numArms: num?.arms.length ?? 0,
      strArms: str?.arms.length ?? 0,
      inBoth: !!num && !!str,
      rows: rows.length,
    });
  }

  console.log(`読み飛ばしたブロック: ${skippedBlocks} 件（数値・文字列の合計）`);
  console.log(`gold 値が異なる論文: ${differentPapers.size} 件（${[...differentPapers].sort().join(', ')}）`);
  console.log(`gold 生成: ${allPapers.size} 本 -> ${path.relative(benchRoot, GOLD_DIR)}`);
  console.log(`スキーマ項目数: ${ALL_FIELDS.length}（gold セル sentinel: '*'=${starCount} / '-1'=${dashCount}）`);
  console.log('paper\tnumArms\tstrArms\tinBoth\trows');
  for (const row of inventory) {
    console.log(`${row.paper}\t${row.numArms}\t${row.strArms}\t${row.inBoth ? 'Y' : '-'}\t${row.rows}`);
  }
  const both = inventory.filter((r) => r.inBoth).length;
  console.log(`両ファイルに存在（完全 gold 候補）: ${both} 本 / 全 ${inventory.length} 本`);
}

await main();
