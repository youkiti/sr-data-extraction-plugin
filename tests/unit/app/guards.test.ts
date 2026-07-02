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
    test('Evidence 0 行なら不可', () => {
      expect(guardRoute('#/verify', createInitialState()).allowed).toBe(false);
    });

    test('Evidence 1 行以上なら可', () => {
      expect(guardRoute('#/verify', stateWith({ evidenceRows: 1 }))).toEqual({ allowed: true });
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
});
