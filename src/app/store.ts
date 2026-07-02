// メインビューの中央ストア（単方向フロー）。view は render(state) の純粋関数とし、
// 状態変更は必ず setState 経由で行う（architecture.md §2.2）
import type { DocumentRecord } from '../domain/document';
import type { ProjectRef } from '../domain/project';

/** ガード判定・進捗サマリに使う各タブの行数サマリ（ui-flow.md §4） */
export interface ProgressCounts {
  /** Documents タブの行数 */
  documents: number;
  /** Protocol の版数（1 以上でスキーマ設計へ進める） */
  protocolVersions: number;
  /** 確定済み schema_version の数 */
  schemaVersions: number;
  /** pilot run の実行数（0 のとき一括抽出前に警告バナー） */
  pilotRuns: number;
  /** Evidence タブの行数（1 以上で検証へ進める） */
  evidenceRows: number;
  /** StudyData / ResultsData の行数合計（1 以上でエクスポートへ進める） */
  dataRows: number;
}

/** 取り込み進捗 1 行の段階（ui-states.md §3「コピー → テキスト抽出の 2 段階表示」+ 前後の状態） */
export type ImportRowStatus = 'queued' | 'copy' | 'extract' | 'done' | 'failed';

export interface ImportRow {
  sourceFileId: string;
  filename: string;
  status: ImportRowStatus;
  /** failed のときの詳細（失敗段階 + 理由）。それ以外は null */
  detail: string | null;
}

/** #/documents（S3）の画面状態 */
export interface DocumentsState {
  /** Documents タブの一覧。null = 未読込（画面表示時に読み込む） */
  records: DocumentRecord[] | null;
  loading: boolean;
  loadError: string | null;
  importing: boolean;
  /** 直近の取り込みの進捗行（次の取り込み開始まで残す） */
  importRows: ImportRow[];
}

export interface AppState {
  currentProject: ProjectRef | null;
  counts: ProgressCounts;
  documents: DocumentsState;
}

export type StateListener = (state: AppState) => void;

export interface Store {
  getState(): AppState;
  setState(patch: Partial<AppState>): void;
  subscribe(listener: StateListener): () => void;
}

export function createInitialState(): AppState {
  return {
    currentProject: null,
    counts: {
      documents: 0,
      protocolVersions: 0,
      schemaVersions: 0,
      pilotRuns: 0,
      evidenceRows: 0,
      dataRows: 0,
    },
    documents: {
      records: null,
      loading: false,
      loadError: null,
      importing: false,
      importRows: [],
    },
  };
}

export function createStore(initial: AppState = createInitialState()): Store {
  let state = initial;
  const listeners = new Set<StateListener>();
  return {
    getState: () => state,
    setState(patch) {
      state = { ...state, ...patch };
      for (const listener of listeners) {
        listener(state);
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
