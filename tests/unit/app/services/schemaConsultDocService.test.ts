import { createInitialState, createStore, type Store } from '../../../../src/app/store';
import {
  exportSchemaConsultDoc,
  selectConsultDocVersion,
  type SchemaConsultDocDeps,
} from '../../../../src/app/services/schemaConsultDocService';
import { emptyPilotMatrix } from '../../../../src/app/services/pilotMatrixService';
import { readEvidenceRows } from '../../../../src/features/extraction/evidenceRepository';
import { readPilotRuns } from '../../../../src/features/extraction/runRepository';
import { getSchemaFieldsByVersion } from '../../../../src/features/schema/schemaRepository';
import { readAllDecisions } from '../../../../src/features/verification/decisionRepository';
import { uploadTextFile } from '../../../../src/lib/google/drive';
import { getCurrentUserEmail } from '../../../../src/lib/google/identity';
import type { SchemaVersion } from '../../../../src/domain/schemaVersion';
import { makeDecision, makeEvidence, makeField, makeRun } from '../../features/verification/pilotMatrixFixtures';

jest.mock('../../../../src/features/extraction/evidenceRepository');
jest.mock('../../../../src/features/extraction/runRepository');
jest.mock('../../../../src/features/schema/schemaRepository');
jest.mock('../../../../src/features/verification/decisionRepository');
jest.mock('../../../../src/lib/google/drive');
jest.mock('../../../../src/lib/google/identity');

const evidenceMock = jest.mocked(readEvidenceRows);
const runsMock = jest.mocked(readPilotRuns);
const fieldsMock = jest.mocked(getSchemaFieldsByVersion);
const decisionsMock = jest.mocked(readAllDecisions);
const uploadMock = jest.mocked(uploadTextFile);
const emailMock = jest.mocked(getCurrentUserEmail);

const deps: SchemaConsultDocDeps = {
  google: {} as SchemaConsultDocDeps['google'],
  profile: {} as SchemaConsultDocDeps['profile'],
  nowDate: () => new Date(2026, 9, 5, 12, 0, 0),
};

function version(schemaVersion: number): SchemaVersion {
  return {
    schemaVersion, parentVersion: null, protocolVersion: 1, createdByType: 'user_edit',
    createdAt: '2026-07-01T00:00:00Z', createdBy: 'me@example.com', note: '改訂メモ',
  };
}

function storeOf(): Store {
  const state = createInitialState();
  state.currentProject = { projectId: 'p', spreadsheetId: 'sheet', driveFolderId: 'folder', name: 'テスト SR' };
  state.schema.versions = [version(2), version(1)];
  return createStore(state);
}

function htmlOf(): string {
  return uploadMock.mock.calls[0]![0].content;
}

beforeEach(() => {
  jest.resetAllMocks();
  fieldsMock.mockResolvedValue([makeField()]);
  runsMock.mockResolvedValue([makeRun({ runId: 'run-2', schemaVersion: 2 }), makeRun({ runId: 'run-1', schemaVersion: 1 })]);
  evidenceMock.mockResolvedValue([
    makeEvidence({ runId: 'run-2', value: '120', quote: 'a total of 120' }),
    makeEvidence({ runId: 'run-1', evidenceId: 'old', value: '111', quote: 'old run' }),
  ]);
  decisionsMock.mockResolvedValue([
    makeDecision({ schemaVersion: 2, action: 'edit', value: '130', note: '内緒のメモ' }),
    makeDecision({ annotator: 'other@example.com', action: 'reject', value: null }),
    makeDecision({ annotatorType: 'human_independent', annotator: 'me@example.com', action: 'edit', value: '独立の値' }),
    makeDecision({ studyId: 'study-zzz', action: 'edit', value: '範囲外' }),
  ]);
  emailMock.mockResolvedValue('me@example.com');
  uploadMock.mockResolvedValue({ id: 'doc-id', webViewLink: 'https://docs.google.com/document/d/doc-id/edit' });
});

describe('exportSchemaConsultDoc', () => {
  test('履歴未読込なら Sheets から読み、選んだ版の最新 run で Google ドキュメントを作る', async () => {
    const store = storeOf();
    store.setState({ documents: { ...store.getState().documents, studies: [
      { studyId: 'study-1', studyLabel: 'Smith 2020', registrationId: null, createdAt: '', createdBy: '', note: null, reviewSet: null },
    ] } });
    await exportSchemaConsultDoc(store, deps, 2);
    expect(fieldsMock).toHaveBeenCalledWith('sheet', 2, deps.google);
    expect(uploadMock).toHaveBeenCalledTimes(1);
    const [params, google] = uploadMock.mock.calls[0]!;
    expect(google).toBe(deps.google);
    expect(params).toMatchObject({
      name: 'スキーマ v2 相談用 2026-10-05',
      parentId: 'folder',
      mimeType: 'text/html',
      targetMimeType: 'application/vnd.google-apps.document',
    });
    const html = htmlOf();
    expect(html).toContain('Smith 2020');
    expect(html).toContain('「a total of 120」');
    expect(html).toContain('修正後: 130');
    // 他版の run の根拠、他人・独立入力・範囲外の判定、メモは載らない
    expect(html).not.toContain('old run');
    expect(html).not.toContain('独立の値');
    expect(html).not.toContain('範囲外');
    expect(html).not.toContain('内緒のメモ');
    expect(html).not.toContain('改訂メモ');
    expect(store.getState().schema.consultDoc).toEqual({
      version: 2, exporting: false, error: null,
      link: 'https://docs.google.com/document/d/doc-id/edit',
    });
  });

  test('読み込み済みのパイロットは Sheets を読み直さない（人の判定だけ使う）', async () => {
    const store = storeOf();
    const run = makeRun({ runId: 'run-2', schemaVersion: 2 });
    const pilot = store.getState().pilot;
    store.setState({
      pilot: {
        ...pilot, run, history: [run],
        evidence: [makeEvidence({ runId: 'run-2', value: '120', quote: 'loaded quote' })],
        matrix: { ...emptyPilotMatrix(), runId: 'run-2', decisions: [
          makeDecision({ action: 'edit', value: '140' }),
          makeDecision({ annotatorType: 'human_independent', action: 'edit', value: '独立の値' }),
        ] },
      },
    });
    await exportSchemaConsultDoc(store, deps, 2);
    expect(runsMock).not.toHaveBeenCalled();
    expect(evidenceMock).not.toHaveBeenCalled();
    expect(decisionsMock).not.toHaveBeenCalled();
    expect(htmlOf()).toContain('loaded quote');
    expect(htmlOf()).toContain('修正後: 140');
    expect(htmlOf()).not.toContain('独立の値');
  });

  test('読み込み済みの run が別の版・別の run なら読み直す。メールが取れなければ空として扱う', async () => {
    const store = storeOf();
    const pilot = store.getState().pilot;
    store.setState({ pilot: { ...pilot, run: makeRun({ runId: 'run-1', schemaVersion: 1 }),
      history: [makeRun({ runId: 'run-2', schemaVersion: 2 })] } });
    emailMock.mockResolvedValue(null);
    await exportSchemaConsultDoc(store, deps, 2);
    expect(runsMock).not.toHaveBeenCalled();
    expect(evidenceMock).toHaveBeenCalledTimes(1);
    expect(decisionsMock).toHaveBeenCalledTimes(1);
    expect(htmlOf()).not.toContain('修正後');
  });

  test('その版のパイロットが無ければ AI 例と内訳なしで作る', async () => {
    const store = storeOf();
    runsMock.mockResolvedValue([makeRun({ runId: 'run-1', schemaVersion: 1 })]);
    // nowDate 未注入なら現在日時を使う
    await exportSchemaConsultDoc(store, { google: deps.google, profile: deps.profile }, 2);
    expect(uploadMock.mock.calls[0]![0].name).toMatch(/^スキーマ v2 相談用 \d{4}-\d{2}-\d{2}$/);
    expect(evidenceMock).not.toHaveBeenCalled();
    expect(htmlOf()).toContain('この版のパイロット抽出はありません');
    expect(store.getState().schema.consultDoc.link).not.toBeNull();
  });

  test('版のメタが無い・アップロード失敗はエラーとして state に入れる', async () => {
    const store = storeOf();
    await exportSchemaConsultDoc(store, deps, 9);
    expect(store.getState().schema.consultDoc).toMatchObject({
      exporting: false, link: null, error: expect.stringContaining('v9'),
    });
    expect(uploadMock).not.toHaveBeenCalled();

    uploadMock.mockRejectedValueOnce(new Error('403 forbidden'));
    await exportSchemaConsultDoc(store, deps, 2);
    expect(store.getState().schema.consultDoc.error).toBe('403 forbidden');
    uploadMock.mockRejectedValueOnce('plain failure');
    await exportSchemaConsultDoc(store, deps, 2);
    expect(store.getState().schema.consultDoc.error).toBe('plain failure');
    // 再実行で前回のエラーを消す
    await exportSchemaConsultDoc(store, deps, 2);
    expect(store.getState().schema.consultDoc.error).toBeNull();
  });

  test('versions 未読込なら見つからないエラー', async () => {
    const store = storeOf();
    store.setState({ schema: { ...store.getState().schema, versions: null } });
    await exportSchemaConsultDoc(store, deps, 2);
    expect(store.getState().schema.consultDoc.error).toContain('v2');
  });

  test('プロジェクト未選択・作成中は何もしない', async () => {
    const noProject = createStore(createInitialState());
    await exportSchemaConsultDoc(noProject, deps, 2);
    const busy = storeOf();
    busy.setState({ schema: { ...busy.getState().schema, consultDoc: { version: 2, exporting: true, error: null, link: null } } });
    await exportSchemaConsultDoc(busy, deps, 2);
    expect(fieldsMock).not.toHaveBeenCalled();
    expect(uploadMock).not.toHaveBeenCalled();
  });
});

describe('selectConsultDocVersion', () => {
  test('版を選ぶと前のリンクとエラーを消す。作成中は変えない', () => {
    const store = storeOf();
    store.setState({ schema: { ...store.getState().schema, consultDoc: { version: 2, exporting: false, error: 'e', link: 'l' } } });
    selectConsultDocVersion(store, 1);
    expect(store.getState().schema.consultDoc).toEqual({ version: 1, exporting: false, error: null, link: null });
    store.setState({ schema: { ...store.getState().schema, consultDoc: { version: 1, exporting: true, error: null, link: null } } });
    selectConsultDocVersion(store, 2);
    expect(store.getState().schema.consultDoc.version).toBe(1);
  });
});
