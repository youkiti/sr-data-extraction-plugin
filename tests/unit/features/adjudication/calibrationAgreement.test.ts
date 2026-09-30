// calibration の全ペア一致度を、通常の一致度レポートと同じ規則で検証する。
import type { StudyDataRow, ResultsDataRow } from '../../../../src/domain/annotation';
import { buildAdjudicationCells } from '../../../../src/features/adjudication/cellMatch';
import {
  buildAgreementReport,
  computeCalibrationAgreement,
  type CalibrationAgreementInput,
} from '../../../../src/features/adjudication/agreement';
import { decision, field, study } from '../review/reviewSetFixtures';

function studyRow(annotator: string, studyId: string, country: string | null): StudyDataRow {
  return {
    studyId,
    annotator,
    annotatorType: 'human_with_ai',
    schemaVersion: 1,
    runId: null,
    updatedAt: 't0',
    values: { country },
  };
}
function resultRow(annotator: string, studyId: string, value: string): ResultsDataRow {
  return {
    resultId: `${annotator}-${studyId}`,
    studyId,
    annotator,
    annotatorType: 'human_independent',
    schemaVersion: 1,
    runId: null,
    updatedAt: 't0',
    fieldId: 'arm-field',
    entityKey: 'arm:1',
    value,
    notReported: false,
  };
}
const a = 'a@example.com';
const b = 'b@example.com';
const c = 'c@example.com';
const empty: CalibrationAgreementInput = {
  studies: [],
  fields: [field()],
  studyDataRows: [],
  resultsDataRows: [],
  decisions: [],
};

describe('calibration の全ペア一致度', () => {
  test('3 名なら 3 ペアを昇順で返し、共存した study をプールして一致率と κ を算出する', () => {
    const studies = [
      study({ studyId: 's1', reviewSet: 'calibration' }),
      study({ studyId: 's2', reviewSet: 'calibration' }),
    ];
    const rows = [
      studyRow(c, 's1', '日本'),
      studyRow(b, 's1', '日本'),
      studyRow(a, 's1', '日本'),
      studyRow(a, 's2', '米国'),
      studyRow(b, 's2', '日本'),
      studyRow(c, 's2', '米国'),
    ];
    const input = { ...empty, studies, studyDataRows: rows };
    const result = computeCalibrationAgreement(input);
    expect(
      result.map(({ annotatorA, annotatorB, studyCount, agreementRate, kappa }) => ({
        annotatorA,
        annotatorB,
        studyCount,
        agreementRate,
        kappa,
      })),
    ).toEqual([
      { annotatorA: a, annotatorB: b, studyCount: 2, agreementRate: 0.5, kappa: 0 },
      { annotatorA: a, annotatorB: c, studyCount: 2, agreementRate: 1, kappa: 1 },
      { annotatorA: b, annotatorB: c, studyCount: 2, agreementRate: 0.5, kappa: 0 },
    ]);
    const expected = buildAgreementReport(
      input.fields,
      studies.map((s) => ({
        studyId: s.studyId,
        studyLabel: s.studyLabel,
        cells: buildAdjudicationCells(
          input.fields,
          rows.find((r) => r.studyId === s.studyId && r.annotator === a) as StudyDataRow,
          rows.find((r) => r.studyId === s.studyId && r.annotator === b) as StudyDataRow,
          [],
          [],
        ),
      })),
    );
    expect(result[0]?.report).toEqual(expected);
  });

  test('2 名の study と long 行・判定履歴を使い、共存しないペアと対象外の行を除く', () => {
    const studies = [
      study({ studyId: 's1', reviewSet: 'calibration' }),
      study({ studyId: 's2', reviewSet: 'calibration' }),
      study({ studyId: 'solo', reviewSet: 'calibration' }),
      study({ studyId: 'empty', reviewSet: 'calibration' }),
      study({ studyId: 'group', reviewSet: 'group-1' }),
      study({ studyId: 'unassigned' }),
    ];
    const input = {
      ...empty,
      studies,
      fields: [field(), field({ fieldId: 'arm-field', fieldName: 'count', entityLevel: 'arm' })],
      studyDataRows: [
        studyRow(a, 's1', ' 日本 '),
        studyRow(b, 's1', '日本'),
        { ...studyRow('ai', 's1', '無視'), annotatorType: 'ai' as const },
        { ...studyRow('consensus', 's1', '無視'), annotatorType: 'consensus' as const },
        studyRow('別人', 'group', '無視'),
        studyRow(c, 'solo', '日本'),
      ],
      resultsDataRows: [resultRow(a, 's2', '10'), resultRow(b, 's2', '10')],
      decisions: [
        decision({ annotator: a, studyId: 's2' }),
        decision({ annotator: b, studyId: 's2' }),
      ],
    };
    const result = computeCalibrationAgreement(input);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      annotatorA: a,
      annotatorB: b,
      studyCount: 2,
      agreementRate: 1,
      kappa: 1,
    });
    expect(result[0]?.report.overall.pairCount).toBe(2);
  });

  test('共通 study の数をペアごとに数え、未入力セルは一致率の分母から除く', () => {
    const input = {
      ...empty,
      studies: [
        study({ studyId: 's1', reviewSet: 'calibration' }),
        study({ studyId: 's2', reviewSet: 'calibration' }),
      ],
      studyDataRows: [
        studyRow(a, 's1', '日本'),
        studyRow(b, 's1', '日本'),
        studyRow(c, 's1', null),
        studyRow(b, 's2', '米国'),
        studyRow(c, 's2', '米国'),
      ],
    };
    expect(
      computeCalibrationAgreement(input).map(
        ({ annotatorA, annotatorB, studyCount, agreementRate, kappa }) => ({
          annotatorA,
          annotatorB,
          studyCount,
          agreementRate,
          kappa,
        }),
      ),
    ).toEqual([
      { annotatorA: a, annotatorB: b, studyCount: 1, agreementRate: 1, kappa: null },
      { annotatorA: a, annotatorB: c, studyCount: 1, agreementRate: null, kappa: null },
      { annotatorA: b, annotatorB: c, studyCount: 2, agreementRate: 1, kappa: null },
    ]);
  });

  test('同じ annotator の最新読み込み行を採用する', () => {
    const input = {
      ...empty,
      studies: [study({ reviewSet: 'calibration' })],
      studyDataRows: [
        studyRow(a, 's1', '古い値'),
        studyRow(b, 's1', '日本'),
        studyRow(a, 's1', '日本'),
      ],
    };
    expect(computeCalibrationAgreement(input)[0]?.agreementRate).toBe(1);
  });

  test('共通 study のない annotator はペアを作らず、calibration がなければ空配列', () => {
    expect(computeCalibrationAgreement(empty)).toEqual([]);
    expect(
      computeCalibrationAgreement({
        ...empty,
        studies: [study({ reviewSet: 'group-1' })],
        studyDataRows: [studyRow(a, 's1', '日本'), studyRow(b, 's1', '日本')],
      }),
    ).toEqual([]);
    expect(
      computeCalibrationAgreement({
        ...empty,
        studies: [
          study({ reviewSet: 'calibration' }),
          study({ studyId: 's2', reviewSet: 'calibration' }),
        ],
        studyDataRows: [studyRow(a, 's1', '日本'), studyRow(b, 's2', '米国')],
      }),
    ).toEqual([]);
  });
});
