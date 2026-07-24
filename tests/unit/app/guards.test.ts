// ルートガードの網羅テスト（ui-flow.md §4 の表と 1:1 対応）
import { guardRoute } from '../../../src/app/guards';
import { createInitialState, type AppState } from '../../../src/app/store';

function stateWith(counts: Partial<AppState['counts']>): AppState {
  const state = createInitialState();
  state.counts = { ...state.counts, ...counts };
  return state;
}

describe('guardRoute', () => {
  test.each(['#/home', '#/documents', '#/protocol', '#/dashboard'])(
    '%s はいつでも遷移可',
    (hash) => {
      expect(guardRoute(hash, createInitialState())).toEqual({ allowed: true });
    },
  );

  describe('#/schema', () => {
    test('Protocol 0 行なら不可', () => {
      const result = guardRoute('#/schema', createInitialState());
      expect(result).toEqual({ allowed: false, message: 'プロトコルを先に入力してください' });
    });

    test('Protocol 1 行以上なら可', () => {
      expect(guardRoute('#/schema', stateWith({ protocolVersions: 1 }))).toEqual({ allowed: true });
    });
  });

  describe('#/pilot', () => {
    test('スキーマ未確定なら不可', () => {
      expect(guardRoute('#/pilot', stateWith({ documents: 3 })).allowed).toBe(false);
    });

    test('文献 0 件なら不可', () => {
      expect(guardRoute('#/pilot', stateWith({ schemaVersions: 1 })).allowed).toBe(false);
    });

    test('スキーマ確定 + 文献 1 件以上なら可', () => {
      expect(guardRoute('#/pilot', stateWith({ schemaVersions: 1, documents: 1 }))).toEqual({
        allowed: true,
      });
    });
  });

  describe('#/extract', () => {
    test('スキーマ未確定なら不可', () => {
      expect(guardRoute('#/extract', createInitialState()).allowed).toBe(false);
    });

    test('パイロット未実施なら遷移は許可しつつ警告（ui-flow.md §4）', () => {
      expect(guardRoute('#/extract', stateWith({ schemaVersions: 1 }))).toEqual({
        allowed: true,
        warning: 'パイロット抽出を推奨します',
      });
    });

    test('パイロット実施済みなら警告なし', () => {
      expect(guardRoute('#/extract', stateWith({ schemaVersions: 1, pilotRuns: 1 }))).toEqual({
        allowed: true,
      });
    });
  });

  describe('#/verify', () => {
    // AI 抽出が全滅（Evidence 0 行）した study も S8 で「AI 抽出結果なし」として表示し
    // 人手入力へ進めるようにしたため、入場ガードは Evidence 起点の判定をやめ、
    // 「確定スキーマ + 取り込み済み文献」の有無を条件にする
    test('確定スキーマ・文献ともに 0 件なら不可', () => {
      expect(guardRoute('#/verify', createInitialState()).allowed).toBe(false);
    });

    test('Evidence が 0 行でも schemaVersions ≥ 1 かつ documents ≥ 1 なら可', () => {
      expect(
        guardRoute('#/verify', stateWith({ schemaVersions: 1, documents: 1, evidenceRows: 0 })),
      ).toEqual({ allowed: true });
    });

    test('Evidence が 1 行以上あっても schemaVersions が 0 件なら不可', () => {
      expect(guardRoute('#/verify', stateWith({ documents: 1, evidenceRows: 1 })).allowed).toBe(
        false,
      );
    });

    test('schemaVersions はあっても documents が 0 件なら不可', () => {
      expect(guardRoute('#/verify', stateWith({ schemaVersions: 1 })).allowed).toBe(false);
    });

    test('schemaVersions ≥ 1 かつ documents ≥ 1（Evidence 由来 counts 省略時）なら可', () => {
      expect(guardRoute('#/verify', stateWith({ schemaVersions: 1, documents: 1 }))).toEqual({
        allowed: true,
      });
    });
  });

  describe('#/export', () => {
    test('データ行 0 なら不可', () => {
      expect(guardRoute('#/export', createInitialState()).allowed).toBe(false);
    });

    test('データ行 1 以上なら可', () => {
      expect(guardRoute('#/export', stateWith({ dataRows: 1 }))).toEqual({ allowed: true });
    });
  });

  describe('reviewer 系ロールのナビ制限（docs/design-independent-dual-review.md §3.1）', () => {
    test.each([
      'reviewer_with_ai',
      'reviewer_independent',
      'adjudicator',
    ] as const)('%s は #/home と #/verify 以外へ遷移できない', (role) => {
      const state = stateWith({ evidenceRows: 1 });
      state.role = { ...state.role, folderAccessGranted: true };
      for (const hash of ['#/documents', '#/protocol', '#/schema', '#/pilot', '#/extract', '#/dashboard', '#/export']) {
        expect(guardRoute(hash, state, role)).toEqual({
          allowed: false,
          message: 'このプロジェクトではレビュアー権限のため利用できません',
        });
      }
    });

    test('reviewer 系ロールでも #/home は常に許可', () => {
      const state = createInitialState();
      expect(guardRoute('#/home', state, 'reviewer_with_ai')).toEqual({ allowed: true });
    });

    test('owner は制限なし（既定値と同じ）', () => {
      const state = stateWith({ evidenceRows: 1 });
      expect(guardRoute('#/documents', state, 'owner')).toEqual({ allowed: true });
    });

    test('role 省略時は owner 相当（ロール未解決の間は制限しない）', () => {
      const state = stateWith({ evidenceRows: 1 });
      expect(guardRoute('#/schema', state)).toEqual({
        allowed: false,
        message: 'プロトコルを先に入力してください',
      });
    });
  });

  describe('#/adjudicate（S12。owner / adjudicator のみ許可・counts は問わない）', () => {
    test('owner は counts・ファイルアクセス付与に関わらず許可される', () => {
      expect(guardRoute('#/adjudicate', createInitialState(), 'owner')).toEqual({ allowed: true });
    });

    test('adjudicator はファイルアクセス未付与なら不可（PDF 読込に drive.file の付与が必要。issue #139）', () => {
      expect(guardRoute('#/adjudicate', createInitialState(), 'adjudicator')).toEqual({
        allowed: false,
        message: 'プロジェクトファイルへのアクセス付与が必要です（Home から付与してください）',
      });
    });

    test('adjudicator はファイルアクセス付与済みなら counts に関わらず許可される', () => {
      const state = createInitialState();
      state.role = { ...state.role, folderAccessGranted: true };
      expect(guardRoute('#/adjudicate', state, 'adjudicator')).toEqual({ allowed: true });
    });

    test.each(['reviewer_with_ai', 'reviewer_independent'] as const)(
      '%s は不可（裁定権限メッセージ）',
      (role) => {
        expect(guardRoute('#/adjudicate', createInitialState(), role)).toEqual({
          allowed: false,
          message: 'このプロジェクトでは裁定権限のため利用できません',
        });
      },
    );
  });

  describe('#/verify のフォルダアクセス付与ゲート（§7.2）', () => {
    test('reviewer 系ロールで未付与なら不可（Evidence があっても）', () => {
      const state = stateWith({ evidenceRows: 1 });
      expect(state.role.folderAccessGranted).toBe(false);
      expect(guardRoute('#/verify', state, 'reviewer_with_ai')).toEqual({
        allowed: false,
        message: 'プロジェクトファイルへのアクセス付与が必要です（Home から付与してください）',
      });
    });

    test('reviewer 系ロールで付与済みなら許可される（counts は問わない）', () => {
      const state = stateWith({ evidenceRows: 1 });
      state.role = { ...state.role, folderAccessGranted: true };
      expect(guardRoute('#/verify', state, 'reviewer_with_ai')).toEqual({ allowed: true });
    });

    test('バグ修正: reviewer 系ロールは counts が全 0 でもフォルダアクセス付与済みなら許可される（本番の永久ブロック回避）', () => {
      // reviewer 系ロールは loadProgressCounts を読まない（盲検）ため state.counts は
      // 常に初期値 0 のまま。counts ベースの判定を課すと folderAccess を付与しても
      // 永久に #/verify へ入れなくなる（監査で発見した実バグ）
      const state = createInitialState();
      expect(state.counts).toEqual({
        documents: 0,
        protocolVersions: 0,
        schemaVersions: 0,
        pilotRuns: 0,
        evidenceRows: 0,
        dataRows: 0,
      });
      state.role = { ...state.role, folderAccessGranted: true };
      expect(guardRoute('#/verify', state, 'reviewer_with_ai')).toEqual({ allowed: true });
      expect(guardRoute('#/verify', state, 'reviewer_independent')).toEqual({ allowed: true });
      expect(guardRoute('#/verify', state, 'adjudicator')).toEqual({ allowed: true });
    });

    test('owner はフォルダアクセス未付与でも #/verify に到達できる', () => {
      const state = stateWith({ schemaVersions: 1, documents: 1 });
      expect(state.role.folderAccessGranted).toBe(false);
      expect(guardRoute('#/verify', state, 'owner')).toEqual({ allowed: true });
    });
  });
});
