import { QUADAS3_SECTION } from './presets/robTemplates';
import type { SchemaEditorRow } from './types';

export const DTA_ARM_FIELD_REPLACEMENTS = {
  name: {
    labelKey: 'schema.dtaEstimateGroups',
    extractionInstruction: 'Extract the treatment group(s) whose participants contribute to this accuracy estimate, as reported (e.g., escitalopram, rTMS 10 Hz). If the estimate pools several arms, list each arm name separated by "; " (keep a combination arm such as "escitalopram + bupropion" as one name) and do not split the estimate by arm.',
  },
  size: {
    labelKey: 'schema.dtaEstimateParticipants',
    extractionInstruction: 'Extract the number of participants included in this accuracy estimate (not the number randomized). If the estimate pools several arms, report the pooled number.',
  },
} as const;

export type DtaArmFieldInput = Pick<SchemaEditorRow,
  'section' | 'fieldName' | 'fieldLabel' | 'entityLevel' | 'dataType' | 'extractionInstruction'>;

export interface DtaArmFieldMatch {
  index: number;
  row: DtaArmFieldInput;
  kind: keyof typeof DTA_ARM_FIELD_REPLACEMENTS;
}

/** 診断精度の結果を治療群ごとの行へ分けてしまう項目を点検する。 */
export function checkDtaArmFields(rows: readonly DtaArmFieldInput[]): DtaArmFieldMatch[] {
  const isDta = rows.some((row) =>
    row.section === QUADAS3_SECTION ||
    row.fieldName.startsWith('quadas3_') ||
    (row.entityLevel === 'outcome_result' &&
      (/true_positive|false_positive|false_negative|true_negative|(^|_)(tp|fp|fn|tn)(_|$)/i.test(row.fieldName) ||
        /真陽性|偽陽性|偽陰性|真陰性/.test(row.fieldLabel))),
  );
  if (!isDta) {
    return [];
  }
  const matches: DtaArmFieldMatch[] = [];
  rows.forEach((row, index) => {
    if (row.entityLevel !== 'outcome_result' ||
      !(/(^|_)(arm|group)(_|$)/i.test(row.fieldName) || /治療群|群名|群別/.test(row.fieldLabel))) {
      return;
    }
    if (row.dataType !== 'text' && row.dataType !== 'integer') {
      return;
    }
    if (Object.values(DTA_ARM_FIELD_REPLACEMENTS).some(
      (replacement) => replacement.extractionInstruction === row.extractionInstruction,
    )) {
      return;
    }
    matches.push({ index, row, kind: row.dataType === 'text' ? 'name' : 'size' });
  });
  return matches;
}
