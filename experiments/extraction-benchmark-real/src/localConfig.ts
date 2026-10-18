// 非公開の入力と項目定義を一か所で読み込み、欠落したファイル・キーを明示する。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { FieldDef } from './fields';

export interface MultiSelectFieldSpec {
  fieldId: string;
  fieldName: string;
  dataType: 'text' | 'enum';
  instruction: string;
  allowedValues?: string;
  multi?: { exclusiveValues: string[]; freeTextValues: string[] };
}

export interface LocalConfig {
  testFixtures: { armInvariant: { armNames: [string, string] } };
  targets: Array<{ pdfId: string; file: string }>;
  cleanDir: string;
  fields: {
    string: Array<Omit<FieldDef, 'fieldId'>>;
    numeric: Array<Omit<FieldDef, 'fieldId'>>;
  };
  outcome: {
    free: { or_mean: string; or_sd: string; or_n: string; or_events: string };
    continuous: string;
    events: string;
  };
  probes: {
    cachePdfId: string;
    draftConditions: Array<{ name: string; papers: string[] }>;
    jevPdfId: string;
    robTargets: string[];
    multiSelect: { pdfDir: string; papers: string[]; fields: MultiSelectFieldSpec[] };
    qualitative: {
      pdfDir: string;
      papers: string[];
      fields: Array<{
        fieldId: string;
        fieldName: string;
        fieldIndex: number;
        instruction: string;
        maxQuotes: number | null;
      }>;
    };
  };
}

type Shape = string | Shape[] | { [key: string]: Shape };
const fieldShape: Shape = {
  rawName: 'string',
  entityLevel: 'study|arm|outcome_result|rob_domain',
  dataType: 'text|integer|float|boolean|enum|date',
  extractionInstruction: 'string',
};
const configShape: Shape = {
  testFixtures: { armInvariant: { armNames: ['string'] } },
  targets: [{ pdfId: 'string', file: 'string' }],
  cleanDir: 'string',
  fields: { string: [fieldShape], numeric: [fieldShape] },
  outcome: {
    free: { or_mean: 'string', or_sd: 'string', or_n: 'string', or_events: 'string' },
    continuous: 'string',
    events: 'string',
  },
  probes: {
    cachePdfId: 'string',
    draftConditions: [{ name: 'string', papers: ['string'] }],
    jevPdfId: 'string',
    robTargets: ['string'],
    multiSelect: {
      pdfDir: 'string',
      papers: ['string'],
      fields: [{
        fieldId: 'string',
        fieldName: 'string',
        dataType: 'text|enum',
        instruction: 'string',
        'allowedValues?': 'string',
        'multi?': { exclusiveValues: ['string'], freeTextValues: ['string'] },
      }],
    },
    qualitative: {
      pdfDir: 'string',
      papers: ['string'],
      fields: [{
        fieldId: 'string',
        fieldName: 'string',
        fieldIndex: 'number',
        instruction: 'string',
        maxQuotes: 'nullableNumber',
      }],
    },
  },
};

export const localConfigPath = fileURLToPath(new URL('../local/benchmark.json', import.meta.url));

function validate(value: unknown, shape: Shape, file: string, key: string): void {
  const fail = (): never => {
    throw new Error(`${file}: キー ${key} が不足しているか形式が不正です`);
  };
  if (typeof shape === 'string') {
    if (shape === 'nullableNumber' && value === null) {
      return;
    }
    if (shape === 'number' || shape === 'nullableNumber') {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        fail();
      }
    } else if (typeof value !== 'string' || value.length === 0 ||
        (shape !== 'string' && !shape.split('|').includes(value))) {
      fail();
    }
    return;
  }
  if (Array.isArray(shape)) {
    if (!Array.isArray(value)) {
      fail();
    }
    // 選択肢の特殊扱いは空配列でもよい。入力と項目の一覧は空のまま実行しない。
    const entries = value as unknown[];
    if (entries.length === 0 && !/\.(exclusiveValues|freeTextValues)$/.test(key)) {
      fail();
    }
    entries.forEach((entry, index) => validate(entry, shape[0]!, file, `${key}[${index}]`));
    return;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail();
  }
  const record = value as Record<string, unknown>;
  for (const [property, child] of Object.entries(shape)) {
    const optional = property.endsWith('?');
    const name = optional ? property.slice(0, -1) : property;
    if (optional && !Object.hasOwn(record, name)) {
      continue;
    }
    validate(record[name], child, file, `${key}.${name}`);
  }
}

/** 検証時にも同じ読み込み経路を使い、設定値をエラー本文へ出さない。 */
export function loadLocalConfig(file = localConfigPath): LocalConfig {
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? 'unknown';
    throw new Error(`${file}: キー $ を読み込めません（${code}）。src/local.example/ を local/ に写して設定してください`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${file}: キー $ の JSON が不正です`);
  }
  validate(parsed, configShape, file, '$');
  const config = parsed as LocalConfig;
  if (config.testFixtures.armInvariant.armNames.length !== 2) {
    throw new Error(`${file}: キー $.testFixtures.armInvariant.armNames は二つの群名が必要です`);
  }
  return config;
}
