// #/protocol（S4）のサービス層。lib/google + features/protocol を 1 段抽象化し、
// 画面状態（AppState.protocol）の遷移を一手に引き受ける。
// view は render(state, ctx) の純粋関数のまま、コールバック経由でここを呼ぶ（architecture.md §2.2）
import { parseDocxFile, type DocxExtractor } from '../../features/protocol/parseDocx';
import { parseManualProtocol } from '../../features/protocol/parseManual';
import { parseMarkdownFile } from '../../features/protocol/parseMarkdown';
import { listProtocols } from '../../features/protocol/protocolRepository';
import { saveProtocol } from '../../features/protocol/saveProtocol';
import type { ProtocolSubmitInput } from '../../features/protocol/submitInput';
import type { ParsedProtocolFile } from '../../features/protocol/types';
import { ensureChildFolder } from '../../lib/google/drive';
import { getCurrentUserEmail, type ProfileDeps } from '../../lib/google/identity';
import type { GoogleApiDeps } from '../../lib/google/types';
import type { Protocol } from '../../domain/protocol';
import type { ProtocolState, Store } from '../store';
import { showToast } from '../ui/toast';

export interface ProtocolServiceDeps {
  google: GoogleApiDeps;
  profile: ProfileDeps;
  /** lib/docx/extractDocxText.ts（mammoth）を注入する（テストは fake で完結させるため） */
  extractDocxText: DocxExtractor;
}

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** protocol スライスだけを差し替える setState ヘルパ（他スライスは維持） */
function patchProtocol(store: Store, patch: Partial<ProtocolState>): void {
  store.setState({ protocol: { ...store.getState().protocol, ...patch } });
}

/** 一覧の反映と同時に進捗カウント（#/schema ガード / #/home サマリ）も揃える */
function setRecords(store: Store, records: Protocol[], patch: Partial<ProtocolState>): void {
  const state = store.getState();
  store.setState({
    protocol: { ...state.protocol, loading: false, loadError: null, records, ...patch },
    counts: { ...state.counts, protocolVersions: records.length },
  });
}

/**
 * Protocol タブから全 version を読み込む。読込済み（records !== null）なら force 指定時のみ再読込。
 * プロジェクト未選択・読込中は no-op
 */
export async function loadProtocols(
  store: Store,
  deps: ProtocolServiceDeps,
  options: { force?: boolean } = {},
): Promise<void> {
  const state = store.getState();
  if (!state.currentProject || state.protocol.loading) {
    return;
  }
  if (state.protocol.records !== null && options.force !== true) {
    return;
  }
  patchProtocol(store, { loading: true, loadError: null });
  try {
    const records = await listProtocols(state.currentProject.spreadsheetId, deps.google);
    setRecords(store, records, { selectedVersion: null });
  } catch (err) {
    patchProtocol(store, { loading: false, loadError: toMessage(err) });
  }
}

/** 送信内容を入力方法ごとのパーサへ振り分ける */
async function parseSubmitInput(
  input: ProtocolSubmitInput,
  extractDocxText: DocxExtractor,
): Promise<ParsedProtocolFile> {
  if (input.sourceType === 'manual') {
    return parseManualProtocol(input.inlineText);
  }
  if (input.sourceType === 'markdown') {
    return parseMarkdownFile(input.file);
  }
  return parseDocxFile(input.file, extractDocxText);
}

/**
 * フォーム送信を保存まで進める（S4 の中核フロー）。
 * パース → raw_protocols/ フォルダ解決 →（md / docx のみ）Drive 退避 → Protocol タブへ新 version 追記。
 * 失敗はフォームのエラー領域（saveError）へ出し、手入力の本文は draftText で保全する
 */
export async function submitProtocol(
  store: Store,
  deps: ProtocolServiceDeps,
  input: ProtocolSubmitInput,
): Promise<void> {
  const state = store.getState();
  const project = state.currentProject;
  if (!project || state.protocol.saving) {
    return;
  }
  patchProtocol(store, {
    saving: true,
    saveError: null,
    draftText: input.sourceType === 'manual' ? input.inlineText : '',
  });
  try {
    const parsed = await parseSubmitInput(input, deps.extractDocxText);
    // プロジェクト生成時のサブフォルダを名前で解決する（Meta にはトップフォルダ ID しか持たないため）
    const rawProtocolsFolder = await ensureChildFolder(
      'raw_protocols',
      project.driveFolderId,
      deps.google,
    );
    const createdBy = (await getCurrentUserEmail(deps.profile)) ?? '';
    const protocol = await saveProtocol(
      {
        spreadsheetId: project.spreadsheetId,
        rawProtocolsFolderId: rawProtocolsFolder.id,
        parsed,
        createdBy,
      },
      { google: deps.google },
    );
    const records = [protocol, ...(store.getState().protocol.records ?? [])];
    setRecords(store, records, {
      saving: false,
      saveError: null,
      editing: false,
      selectedVersion: null,
      draftText: '',
    });
    showToast(`プロトコル v${protocol.version} を保存しました`);
  } catch (err) {
    patchProtocol(store, { saving: false, saveError: toMessage(err) });
  }
}

/** 「新しい版を入力」: 読み取り専用 → 再入力フォーム */
export function startEditProtocol(store: Store): void {
  patchProtocol(store, { editing: true, saveError: null });
}

/** 再入力フォームのキャンセル: 読み取り専用へ戻る（下書きは破棄） */
export function cancelEditProtocol(store: Store): void {
  patchProtocol(store, { editing: false, saveError: null, draftText: '' });
}

/** バージョン切替（読み取り専用表示の対象を変えるだけ。Sheets は再読込しない） */
export function selectProtocolVersion(store: Store, version: number): void {
  patchProtocol(store, { selectedVersion: version });
}
