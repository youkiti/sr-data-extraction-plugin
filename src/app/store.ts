// メインビューの中央ストア（単方向フロー）。view は render(state) の純粋関数とし、
// 状態変更は必ず setState 経由で行う（architecture.md §2.2）
import type { DocumentRecord } from '../domain/document';
import type { ProjectRef } from '../domain/project';
import type { Protocol } from '../domain/protocol';
import type { SchemaField } from '../domain/schemaField';
import type { SchemaVersion } from '../domain/schemaVersion';
import type { SchemaEditorRow } from '../features/schema/types';
import type { FieldValidationError } from '../features/schema/validateField';

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

/** #/protocol（S4）の画面状態 */
export interface ProtocolState {
  /** Protocol タブの全 version（降順）。null = 未読込（画面表示時に読み込む） */
  records: Protocol[] | null;
  loading: boolean;
  loadError: string | null;
  saving: boolean;
  /** 保存・パース失敗の文言（フォームのエラー領域に表示） */
  saveError: string | null;
  /** 既存版があるときに再入力フォームを開いているか（読み取り専用 ↔ フォームの分岐） */
  editing: boolean;
  /** 読み取り専用表示で選択中の版。null = 最新 */
  selectedVersion: number | null;
  /** 保存中・保存失敗の再描画でフォーム本文を復元するための下書き（手入力のみ） */
  draftText: string;
}

/** #/schema（S5）の画面状態 */
export interface SchemaState {
  /** SchemaVersions タブの全版（降順）。null = 未読込 */
  versions: SchemaVersion[] | null;
  /** 最新版（versions[0]）の項目。確定済みサマリに使う */
  currentFields: SchemaField[] | null;
  loading: boolean;
  loadError: string | null;
  /** ドラフト生成の実行状態。経過時間も store で持ち再描画に耐える（ui-states.md §3） */
  drafting: boolean;
  draftElapsedSeconds: number;
  draftError: string | null;
  /** ドラフトフォームの選択状態（サンプル論文 1〜3 本 + requested_model） */
  selectedDocumentIds: string[];
  model: string;
  /** エディタ行。null = エディタ非表示 */
  editorRows: SchemaEditorRow[] | null;
  editorErrors: FieldValidationError[];
  /** 確定時の created_by_type（AI ドラフト直後 = ai_draft。人が触ったら user_edit） */
  editorOrigin: 'ai_draft' | 'user_edit';
  confirming: boolean;
}

export interface AppState {
  currentProject: ProjectRef | null;
  counts: ProgressCounts;
  documents: DocumentsState;
  protocol: ProtocolState;
  schema: SchemaState;
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
    protocol: {
      records: null,
      loading: false,
      loadError: null,
      saving: false,
      saveError: null,
      editing: false,
      selectedVersion: null,
      draftText: '',
    },
    schema: {
      versions: null,
      currentFields: null,
      loading: false,
      loadError: null,
      drafting: false,
      draftElapsedSeconds: 0,
      draftError: null,
      selectedDocumentIds: [],
      model: '',
      editorRows: null,
      editorErrors: [],
      editorOrigin: 'user_edit',
      confirming: false,
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
