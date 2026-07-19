import {
  loadProjectMeta,
  ProjectSchemaError,
} from '../../../../src/features/project/selectProject';
import { CURRENT_SCHEMA_VERSION } from '../../../../src/domain/project';
import { SHEET_HEADERS } from '../../../../src/domain/sheetsSchema';
import { SheetsAccessDeniedError } from '../../../../src/lib/google/sheets';
import type { GoogleApiDeps } from '../../../../src/lib/google/types';

const META_HEADER = [...SHEET_HEADERS.Meta];
const META_ROW = [
  'pid-1',
  '肺炎 SR',
  'SID',
  'FOLDER',
  CURRENT_SCHEMA_VERSION,
  '2026-07-02T00:00:00.000Z',
  'me@example.com',
];

const ALL_TABS = ['Meta', 'Documents', 'SchemaFields'];

/**
 * getSheetTitles（メタデータ GET）と getSheetValues（values GET）だけ返すスタブ。
 */
function makeDeps(options: {
  tabs?: string[];
  rows?: string[][];
  metadataStatus?: number;
  /** metadataStatus 非 200 のときのレスポンス本文（403 の reason 分類テスト用） */
  metadataBody?: string;
  /** values GET だけ失敗させる（タブ一覧成功後の許可失効ケース） */
  valuesStatus?: number;
}): GoogleApiDeps {
  return {
    getAccessToken: async () => 'tok',
    fetch: (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('?fields=sheets.properties.title')) {
        const status = options.metadataStatus ?? 200;
        if (status !== 200) {
          return {
            ok: false,
            status,
            json: async () => ({}),
            text: async () => options.metadataBody ?? 'not found',
          } as Response;
        }
        const json = {
          sheets: (options.tabs ?? ALL_TABS).map((title) => ({ properties: { title } })),
        };
        return {
          ok: true,
          status: 200,
          json: async () => json,
          text: async () => JSON.stringify(json),
        } as Response;
      }
      const valuesStatus = options.valuesStatus ?? 200;
      if (valuesStatus !== 200) {
        return {
          ok: false,
          status: valuesStatus,
          json: async () => ({}),
          text: async () => 'not found',
        } as Response;
      }
      const json = { values: options.rows ?? [] };
      return {
        ok: true,
        status: 200,
        json: async () => json,
        text: async () => JSON.stringify(json),
      } as Response;
    }) as typeof fetch,
  };
}

describe('loadProjectMeta', () => {
  test('正常系: Meta タブ 1 行を ProjectMeta に変換する', async () => {
    const deps = makeDeps({ rows: [META_HEADER, META_ROW] });
    await expect(loadProjectMeta('SID', deps)).resolves.toEqual({
      projectId: 'pid-1',
      projectTitle: '肺炎 SR',
      spreadsheetId: 'SID',
      driveFolderId: 'FOLDER',
      schemaVersion: CURRENT_SCHEMA_VERSION,
      createdAt: '2026-07-02T00:00:00.000Z',
      createdBy: 'me@example.com',
    });
  });

  test('欠損セルは空文字で埋める', async () => {
    const deps = makeDeps({ rows: [META_HEADER, ['pid-1', 'T']] });
    await expect(loadProjectMeta('SID', deps)).rejects.toThrow(/サポート外のスキーマバージョン/);
  });

  test('404 は SheetsAccessDeniedError（drive.file では未許可と不存在を区別できない。issue #130）', async () => {
    const deps = makeDeps({ metadataStatus: 404 });
    const err = await loadProjectMeta('missing', deps).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SheetsAccessDeniedError);
    expect((err as SheetsAccessDeniedError).spreadsheetId).toBe('missing');
    expect((err as SheetsAccessDeniedError).status).toBe(404);
  });

  test('権限系 403（PERMISSION_DENIED）も SheetsAccessDeniedError', async () => {
    const deps = makeDeps({
      metadataStatus: 403,
      metadataBody: JSON.stringify({ error: { status: 'PERMISSION_DENIED' } }),
    });
    await expect(loadProjectMeta('SID', deps)).rejects.toBeInstanceOf(SheetsAccessDeniedError);
  });

  test('権限系でない 403（本文が JSON でない等）はそのまま伝播する', async () => {
    const deps = makeDeps({ metadataStatus: 403 });
    await expect(loadProjectMeta('SID', deps)).rejects.toThrow(/HTTP 403/);
  });

  test('タブ一覧成功後の values GET のアクセス拒否も SheetsAccessDeniedError に分類する', async () => {
    const deps = makeDeps({ valuesStatus: 404 });
    await expect(loadProjectMeta('SID', deps)).rejects.toBeInstanceOf(SheetsAccessDeniedError);
  });

  test('values GET のアクセス拒否以外のエラーはそのまま伝播する', async () => {
    const deps = makeDeps({ valuesStatus: 500 });
    await expect(loadProjectMeta('SID', deps)).rejects.toThrow(/HTTP 500/);
  });

  test('Meta タブが無ければ初期化されていないエラー', async () => {
    const deps = makeDeps({ tabs: ['Documents', 'SchemaFields'] });
    await expect(loadProjectMeta('SID', deps)).rejects.toThrow(/Meta タブがありません/);
  });

  test('Documents / SchemaFields タブが無ければ本拡張のプロジェクトではない（docs/ui-states.md §1）', async () => {
    // sr-query-builder のシート（Meta はあるが Documents / SchemaFields が無い）を想定
    const deps = makeDeps({ tabs: ['Meta', 'Protocol', 'SeedPapers'] });
    await expect(loadProjectMeta('SID', deps)).rejects.toThrow(
      /sr-data-extraction のプロジェクトではありません（Documents \/ SchemaFields タブが見つかりません）/,
    );
  });

  describe('tiab-review シートの誤入力（docs/ui-states.md §1。Meta 欠落の一般文言より優先）', () => {
    test('References / Decisions を持ち Meta が無ければ tiab-review 専用文言で reject する', async () => {
      const deps = makeDeps({ tabs: ['References', 'Decisions', 'Config'] });
      await expect(loadProjectMeta('SID', deps)).rejects.toThrow(
        /これは tiab-review のスプレッドシートのようです/,
      );
    });

    test('References / Decisions を持ち Documents / SchemaFields が無ければ同エラー', async () => {
      const deps = makeDeps({ tabs: ['Meta', 'References', 'Decisions'] });
      await expect(loadProjectMeta('SID', deps)).rejects.toThrow(
        /これは tiab-review のスプレッドシートのようです/,
      );
    });
  });

  test('Meta タブが空なら ProjectSchemaError', async () => {
    const deps = makeDeps({ rows: [] });
    await expect(loadProjectMeta('SID', deps)).rejects.toBeInstanceOf(ProjectSchemaError);
    await expect(loadProjectMeta('SID', deps)).rejects.toThrow(/Meta タブが空です/);
  });

  test('列構成が異なると ProjectSchemaError', async () => {
    const deps = makeDeps({ rows: [['project_id', 'unexpected'], META_ROW] });
    await expect(loadProjectMeta('SID', deps)).rejects.toThrow(/列構成が想定と異なります/);
  });

  test('列数が同じでも列名が違えば ProjectSchemaError', async () => {
    const header = [...META_HEADER];
    header[1] = 'wrong_name';
    const deps = makeDeps({ rows: [header, META_ROW] });
    await expect(loadProjectMeta('SID', deps)).rejects.toThrow(/列構成が想定と異なります/);
  });

  test('データ行が無ければ ProjectSchemaError', async () => {
    const deps = makeDeps({ rows: [META_HEADER] });
    await expect(loadProjectMeta('SID', deps)).rejects.toThrow(/データ行がありません/);
  });

  test('サポート外 schema_version は ProjectSchemaError', async () => {
    const row = [...META_ROW];
    row[4] = '99.0';
    const deps = makeDeps({ rows: [META_HEADER, row] });
    await expect(loadProjectMeta('SID', deps)).rejects.toThrow(
      /サポート外のスキーマバージョンです: 99\.0/,
    );
  });
});
