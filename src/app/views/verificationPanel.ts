// 検証パネル（S8 の 2 ペイン UI 基盤。S6 パイロットへ埋め込み、S8 単独画面でも再利用する）。
// - 左ペイン: pdfViewer（根拠ハイライト + クリックで対応項目へフォーカス）
// - 右ペイン: verificationForm（判定チップ / 判定操作 / anchor failed フォールバック）
// - 判定はパネル内へ楽観反映し、永続化は onDecision コールバック（サービス層）へ委譲する
// - キーボードショートカット（ui-flow.md §7）はパネルが DOM に接続されている間だけ反応し、
//   入力フィールドにフォーカスがある間は発火しない（判定誤爆の防止。ui-states.md §4）
//
// ストア再描画（route render）とライフサイクルの整合は renderCachedVerificationPanel が取る:
// 同じ VerificationData 参照なら同一インスタンス（DOM / PDF canvas / 判定の楽観状態）を返し、
// データが差し替わったときだけ作り直す
import { NOT_REPORTED_TOKEN } from '../../domain/annotation';
import type { ConfirmedArmStructure } from '../../domain/armStructure';
import type { Decision, DecisionAction } from '../../domain/decision';
import { DOCUMENT_ROLE_LABELS } from '../../domain/document';
import type { Evidence } from '../../domain/evidence';
import type { EntityLevel } from '../../domain/schemaField';
import {
  draftArms,
  isArmDependentLevel,
  needsArmConfirmation,
  type DraftArm,
} from '../../features/verification/armDraft';
import {
  availableTabs,
  buildTabModel,
  entityInstances,
  splitDecidedCells,
  type TabModel,
  type VerificationCell,
} from '../../features/verification/cells';
import {
  cellKeyOf,
  deriveCellStates,
  undoRevertValue,
  type CellState,
} from '../../features/verification/cellState';
import {
  buildFocusUnits,
  nextPendingCellInUnit,
  nextPendingUnit,
  unitOfCell,
  unitProgress,
  type FocusUnit,
} from '../../features/verification/focusUnits';
import {
  buildDocumentHighlights,
  buildStudyTextMatches,
  type EvidenceHighlight,
  type EvidenceTextMatch,
  type HighlightOccurrence,
} from '../../features/verification/highlights';
import { buildOutcomeDeclarationDecisions } from '../../features/verification/instanceDeclarations';
import { verificationProgress } from '../../features/verification/progress';
import { findQuoteContext } from '../../features/verification/textContext';
import type {
  LoadedPdfView,
  VerificationData,
  VerificationDocumentView,
} from '../../features/verification/types';
import type { VerifyLayoutMode } from '../../lib/storage/settingsStore';
import type { renderPdfPageToCanvas } from '../../lib/pdf/renderPage';
import { nowIso8601 } from '../../utils/iso8601';
import { nextOutcomeId } from '../../utils/entityKey';
import { el } from '../ui/dom';
import { createPdfViewer, type PdfViewerHandle, type ViewerHighlight } from '../ui/pdfViewer';
import { createTextViewer, type TextViewerSnippet } from '../ui/textViewer';
import type { VerificationFocusCardModel } from './verificationFocusCard';
import {
  renderVerificationForm,
  type CellHighlightInfo,
  type VerificationFormHandlers,
  type VerificationFormModel,
} from './verificationForm';

export interface VerificationPanelOptions {
  data: VerificationData;
  /** 判定 1 操作ごとに呼ばれる（永続化 + オフラインキュー退避はサービス層の責務） */
  onDecision: (decision: Decision) => void;
  /** 群構成の確定・改訂ごとに呼ばれる（ArmStructures への追記はサービス層の責務） */
  onArmConfirm?: (arms: readonly DraftArm[]) => void;
  /** AI が作らなかった entity インスタンスの宣言（Decisions 追記）はサービス層の責務 */
  onInstanceDeclare?: (decisions: readonly Decision[]) => void;
  /**
   * URL クエリ ?entity= のセル単位ディープリンク（ui-flow.md §3。S9 ダッシュボードのセルクリック）。
   * renderCachedVerificationPanel が値の変化を検知して focusEntity を呼ぶ
   */
  focusEntityKey?: string | null;
  /**
   * レイアウトモードの初期表示（issue #38。未指定は 'focus'）。読込はサービス層が
   * 検証データ束の読込時に settingsStore から行う（S6 / S8 で設定を共有）
   */
  layoutMode?: VerifyLayoutMode;
  /** トグル操作（`#verify-layout-toggle`）のたびに呼ばれる。永続化はサービス層の責務 */
  onLayoutModeChange?: (mode: VerifyLayoutMode) => void;
  now?: () => string;
  /** テスト差し替え用（pdfViewer へ渡す） */
  renderPage?: typeof renderPdfPageToCanvas;
}

export interface VerificationPanelHandle {
  root: HTMLElement;
  /** 指定 entity のタブへ切替え、先頭セルへスクロール・フォーカスする（?entity= ディープリンク） */
  focusEntity(entityKey: string): void;
  /** 現在フォーカス中のセルを可視域へスクロールする（新規パネルの初期表示用） */
  scrollFocusedIntoView(): void;
  dispose(): void;
}

/** cells 中の startIndex 以降で最初の未判定セル。末尾まで無ければ先頭へ回り込む。全て判定済みなら null */
function nextUndecidedKey(cells: readonly VerificationCell[], startIndex: number): string | null {
  for (let offset = 0; offset < cells.length; offset++) {
    const cell = cells[(startIndex + offset) % cells.length] as VerificationCell;
    if (cell.state.status === 'unverified') {
      return cell.cellKey;
    }
  }
  return null;
}

/** 初期・タブ切替時のフォーカス先。最初の未判定セル → 無ければ先頭セル → それも無ければ null */
function initialFocusKey(cells: readonly VerificationCell[]): string | null {
  return nextUndecidedKey(cells, 0) ?? cells[0]?.cellKey ?? null;
}

/**
 * ユニット内の最初のセル（null をスキップした先頭）。ユニットが空なら null（実データでは
 * 起こらない防御パス）。export はテスト専用（locateCellInUnit と同じ理由）
 */
export function firstCellKeyOfUnit(unit: FocusUnit): string | null {
  for (const row of unit.rows) {
    for (const cell of row.cells) {
      if (cell !== null) {
        return cell.cellKey;
      }
    }
  }
  return null;
}

/**
 * フォーカスモードの初期 / タブ切替時のフォーカス先: 未判定セルを含む最初のユニットの
 * 最初の未判定セル → 全て判定済みなら先頭ユニットの先頭セル → ユニットが無ければ null
 */
function initialFocusKeyForUnits(units: readonly FocusUnit[]): string | null {
  const unit = nextPendingUnit(units, null) ?? units[0] ?? null;
  if (unit === null) {
    return null;
  }
  return nextPendingCellInUnit(unit, null) ?? firstCellKeyOfUnit(unit);
}

/**
 * ユニット内でのセル位置（行 / 列インデックス）。見つからなければ null。
 * export はテスト専用（null セルを含むユニットは buildFocusUnits の防御パスでしか
 * 生成されず実データでは再現できないため、focusUnits.test.ts と同様に手組みの
 * FocusUnit を使って直接検証する）
 */
export function locateCellInUnit(unit: FocusUnit, cellKey: string): { row: number; col: number } | null {
  for (let row = 0; row < unit.rows.length; row++) {
    const cells = (unit.rows[row] as FocusUnit['rows'][number]).cells;
    for (let col = 0; col < cells.length; col++) {
      if (cells[col]?.cellKey === cellKey) {
        return { row, col };
      }
    }
  }
  return null;
}

/**
 * from の位置から axis 方向へ delta 分だけ移動し、null セルはスキップする（行 / 列とも同様に扱う。
 * ui-flow.md §7）。範囲外に出たら null（呼び出し側は現在位置に留まる = 「端で停止」）。
 * export はテスト専用（locateCellInUnit と同じ理由）
 */
export function stepUnitPosition(
  unit: FocusUnit,
  from: { row: number; col: number },
  axis: 'row' | 'col',
  delta: number,
): string | null {
  let row = from.row;
  let col = from.col;
  for (;;) {
    row += axis === 'row' ? delta : 0;
    col += axis === 'col' ? delta : 0;
    const rowCells = unit.rows[row]?.cells;
    if (row < 0 || row >= unit.rows.length || rowCells === undefined || col < 0 || col >= rowCells.length) {
      return null;
    }
    const cell = rowCells[col] ?? null;
    if (cell !== null) {
      return cell.cellKey;
    }
  }
}

export function createVerificationPanel(
  options: VerificationPanelOptions,
): VerificationPanelHandle {
  const { data } = options;
  const now = options.now ?? nowIso8601;

  // --- パネル内状態 -------------------------------------------------------
  // 判定は自分の annotator 行への操作だけを畳み込む（他 annotator の判定は状態に影響しない）
  const ownDecisions: Decision[] = data.decisions.filter(
    (decision) => decision.annotator === data.annotator,
  );
  // テキストのみで再特定した出現位置（rects なし。study 全文書ぶんを一度だけ計算し、
  // PDF のロード状態に関係なく matchCount / ページ表示に使う。issue #28 案3）
  const textMatches = buildStudyTextMatches(data.documents, data.evidence);
  const textMatchByCell = new Map(textMatches.map((m) => [m.cellKey, m]));
  const evidenceByCell = new Map<string, Evidence>(
    data.evidence.map((item) => [cellKeyOf(item.fieldId, item.entityKey), item]),
  );
  const fieldLabelById = new Map(data.fields.map((field) => [field.fieldId, field.fieldLabel]));
  /** 複数一致の表示中出現（cellKey → occurrences の index）。未設定は selectedIndex */
  const matchSelection = new Map<string, number>();

  // --- 群構成（arm 確定ゲート。requirements.md §4.2 / ui-states.md §3） -----
  // 確定は判定と同じく楽観反映し、永続化は onArmConfirm へ委譲する
  const armRequired = needsArmConfirmation(data.fields);
  let armStructure: ConfirmedArmStructure | null = data.armStructure;
  let armEditing = armRequired && armStructure === null;
  let armRows: DraftArm[] =
    armStructure !== null
      ? armStructure.arms.map((arm) => ({ ...arm }))
      : draftArms(data.fields, data.evidence);
  let armError: string | null = null;
  const armLocked = (): boolean => armRequired && armStructure === null;
  // ロックは群構成に依存するタブだけ（study / rob_domain は arm 未確定でも検証できる）
  const tabLocked = (tab: EntityLevel): boolean => armLocked() && isArmDependentLevel(tab);

  const tabs = availableTabs(data.fields);
  let activeTab: EntityLevel = tabs.find((tab) => !tabLocked(tab)) ?? tabs[0] ?? 'study';
  // --- レイアウトモード（フォーカス / リスト。issue #38） ------------------
  // 既定はフォーカス。初期値はサービス層が settingsStore から読んで options 経由で渡す
  let layoutMode: VerifyLayoutMode = options.layoutMode ?? 'focus';
  let focusedCellKey: string | null = null;
  let editing: { cellKey: string; action: 'edit' | 'reject' } | null = null;
  let outcomeKeyDraft = nextOutcomeId(
    entityInstances('outcome_result', data.evidence, ownDecisions, { armStructure }),
  );
  let outcomeTimeDraft = '';
  let outcomeError: string | null = null;
  // 判定済みブロック（ui-states.md §3）: 直近判定の 1 件だけ元の位置へ残し、
  // それ以外の判定済みセルは下部ブロックへ送る。展開中セルは通常カードで描画する
  let recentDecidedKey: string | null = null;
  let expandedDecidedKey: string | null = null;

  const currentTabModel = (): TabModel =>
    buildTabModel(activeTab, data.fields, data.evidence, ownDecisions, { armStructure });

  /** 現在タブの表示順のセル（未判定 + 直近判定 → 判定済みブロック）。j / k の移動順（リストモード） */
  const displayCells = (): VerificationCell[] => {
    const { activeGroups, decided } = splitDecidedCells(currentTabModel().groups, recentDecidedKey);
    return [...activeGroups.flatMap((group) => group.cells), ...decided.map((entry) => entry.cell)];
  };

  // --- フォーカスモード（issue #38）: ユニット単位のナビゲーション -------------
  /** 指定タブのユニット列を組み立てる（focusUnits.buildFocusUnits を現在の armStructure で呼ぶ） */
  const focusUnitsOf = (tab: EntityLevel): FocusUnit[] =>
    buildFocusUnits(tab, buildTabModel(tab, data.fields, data.evidence, ownDecisions, { armStructure }), {
      armStructure,
    });

  /**
   * 初期・タブ切替時のフォーカス先をレイアウトモードに応じて解決する。
   * list: 最初の未判定セル（表示順）。focus: 最初の未判定ユニットの最初の未判定セル
   */
  function computeInitialFocusKey(tab: EntityLevel): string | null {
    if (layoutMode === 'list') {
      return initialFocusKey(
        buildTabModel(tab, data.fields, data.evidence, ownDecisions, { armStructure }).cells,
      );
    }
    return initialFocusKeyForUnits(focusUnitsOf(tab));
  }

  /**
   * フォーカスモードの詳細描画素材を組み立てる（refreshForm から呼ぶ）。
   * 現在ユニットは focusedCellKey から導出する（別個のユニット状態を持たない）。
   * cells が 0 件、または解決できないときは null（呼び出し側は空メッセージのみを出す）
   */
  function buildFocusCardModel(): VerificationFocusCardModel | null {
    const tabModel = currentTabModel();
    if (tabModel.cells.length === 0) {
      return null;
    }
    // tabModel.cells が 1 件以上あれば focusedCellKey は必ず非 null（computeInitialFocusKey /
    // focusCell が activeTab と同期して設定する）で、buildFocusUnits は必ず 1 件以上のユニットを
    // 作る（各タブビルダーは model.groups と 1:1 対応するため。focusUnits.ts の各 build*Units 参照）
    const units = focusUnitsOf(activeTab);
    const unit = unitOfCell(units, focusedCellKey as string) as FocusUnit;
    const unitIndex = units.findIndex((candidate) => candidate.unitKey === unit.unitKey) + 1;
    const remainingUnits = units.filter((candidate) => {
      const progress = unitProgress(candidate);
      return progress.decided < progress.total;
    }).length;
    const recentCell =
      recentDecidedKey === null
        ? null
        : (tabModel.cells.find((cell) => cell.cellKey === recentDecidedKey) ?? null);
    return {
      unit,
      unitIndex,
      totalUnits: units.length,
      remainingUnits,
      focusedCellKey,
      editing,
      highlightInfo: highlightInfo(),
      canSearchText: activeDocument().extractedPages.some((page) => page.text !== ''),
      recentCell,
    };
  }

  /**
   * フォーカスモードのユニット内移動（j/k = 行、h/l = 列）。同じ列 / 行を維持し、
   * null セルはスキップ・端で停止する（ui-flow.md §7）
   */
  function moveFocusInUnit(axis: 'row' | 'col', delta: number): void {
    if (focusedCellKey === null) {
      return;
    }
    // 呼び出し時点の focusedCellKey は必ず現在タブのユニット内に存在する（不変条件。
    // computeInitialFocusKey / focusCell が activeTab と同期して設定するため。
    // buildFocusUnits は実データでは cell を取りこぼさない ── focusUnits.ts 冒頭のコメント参照）
    const unit = unitOfCell(focusUnitsOf(activeTab), focusedCellKey) as FocusUnit;
    const position = locateCellInUnit(unit, focusedCellKey) as { row: number; col: number };
    const nextKey = stepUnitPosition(unit, position, axis, delta);
    if (nextKey !== null) {
      focusCell(nextKey, { jump: true, domFocus: true });
    }
  }

  /**
   * フォーカスモードのユニット送り（Shift+J / Shift+K）。判定状況に関係なく隣接ユニットへ移動し、
   * 着地はそのユニットの最初の未判定セル → 無ければ先頭セル。端では停止する（折り返さない）
   */
  function moveToAdjacentUnit(delta: number): void {
    const units = focusUnitsOf(activeTab);
    const currentUnit = focusedCellKey === null ? null : unitOfCell(units, focusedCellKey);
    const currentIndex =
      currentUnit === null ? -1 : units.findIndex((candidate) => candidate.unitKey === currentUnit.unitKey);
    const unit = units[currentIndex + delta];
    if (unit === undefined) {
      return;
    }
    // 実データでは全ユニットが 1 件以上の非 null セルを持つため、いずれかは必ず見つかる
    const cellKey = nextPendingCellInUnit(unit, null) ?? (firstCellKeyOfUnit(unit) as string);
    focusCell(cellKey, { jump: true, domFocus: true });
  }

  /**
   * レイアウトモードを切替える（`#verify-layout-toggle`）。フォーカス中セルはそのまま保つ
   * （両モードとも同じ cellKey 概念のため、切替で作業位置を失わせない）。
   * パネルインスタンスは作り直さず、内部の再描画だけで即時反映する。
   * 呼び出し元（renderLayoutToggle）は常に現在モードの反対を渡すため、同値ガードは持たない
   */
  function setLayoutMode(mode: VerifyLayoutMode): void {
    layoutMode = mode;
    refreshForm();
    syncViewer();
    syncTextViewer();
    options.onLayoutModeChange?.(mode);
  }

  // --- 左ペイン（PDF ビューア + 文書切替タブ。v0.10 フェーズ 3 + issue #28 案3） -----
  // study 配下の文書は role 固定順に並ぶ。ビューアは 1 つだけ作り、setDocument で切替える
  // （描画競合の連番ガードを維持）。PDF は表示中の文書だけを data.loadPdfView で遅延読込し、
  // 解決するまでは読み込み中プレースホルダを出す（表示していない文書の PDF は読まない）
  let activeDocumentId = (data.documents[0] as VerificationDocumentView).document.documentId;

  const activeDocument = (): VerificationDocumentView =>
    data.documents.find(
      (view) => view.document.documentId === activeDocumentId,
    ) as VerificationDocumentView;

  let viewer: PdfViewerHandle | null = null;
  let viewerDocId: string | null = null;
  /**
   * documentId ごとの矩形ハイライト（rects 実体化済み）。対象文書の textPages がロードされた
   * 時点で不変なので、applyLoadedPdf で 1 回だけ計算してメモ化する（syncViewer は判定・
   * フォーカス移動のたびに走るため、毎回のアンカリング再計算は性能退行になる）。
   * retry による読み直しも applyLoadedPdf を通るため、そのときはキャッシュが差し替わる
   */
  const rectHighlightsByDoc = new Map<string, EvidenceHighlight[]>();
  /** 現在進行中のロードを無効化するための連番（文書切替のたびに進める） */
  let docLoadSeq = 0;
  /**
   * ロード解決後に一度だけ適用するハイライトジャンプ（f キー / 項目フォーカスの最中に
   * 文書切替が発生したときの「保留ジャンプ」。適用したら null に戻す）
   */
  let pendingJumpCellKey: string | null = null;

  function renderPdfLoadingPlaceholder(): HTMLElement {
    return el('p', {
      className: 'verify__pdf-loading',
      attributes: { role: 'status', 'aria-live': 'polite' },
      text: 'PDF を読み込んでいます…',
    });
  }

  /**
   * 表示中文書の PDF がロード済み（viewer が当該文書を指している）ならその場でハイライトへ
   * ジャンプし、ロード中・未着手なら「保留ジャンプ」として予約する（ロード解決後に 1 回だけ適用）
   */
  function focusHighlightNowOrPending(cellKey: string): void {
    if (viewer !== null && viewerDocId === activeDocumentId) {
      viewer.focusHighlight(cellKey);
    } else {
      pendingJumpCellKey = cellKey;
    }
  }

  // 文書切替タブ（2 文書以上のときだけ出す）。role バッジ + ファイル名
  const docTabButtons = new Map<string, HTMLButtonElement>();
  let docTabsBar: HTMLElement | null = null;
  if (data.documents.length > 1) {
    const buttons = data.documents.map((view) => {
      const button = el('button', {
        className: 'verify__doc-tab',
        attributes: {
          type: 'button',
          role: 'tab',
          title: view.document.filename,
        },
      }) as HTMLButtonElement;
      button.append(
        el('span', {
          className: `verify__doc-role verify__doc-role--${view.document.documentRole}`,
          text: DOCUMENT_ROLE_LABELS[view.document.documentRole],
        }),
        el('span', { className: 'verify__doc-filename', text: view.document.filename }),
      );
      button.addEventListener('click', () => setActiveDocument(view.document.documentId));
      docTabButtons.set(view.document.documentId, button);
      return button;
    });
    docTabsBar = el(
      'div',
      { className: 'verify__doc-tabs', attributes: { role: 'tablist', 'aria-label': '文書切替' } },
      buttons,
    );
  }

  const noTextBanner = el('p', {
    className: 'verify__banner',
    text: 'この PDF はテキスト層がないためハイライト検証は使えません（quote 全文とページヒントで検証してください）',
  });

  // --- 左ペイン表示切替（PDF / 抽出テキスト。issue #28 案2） --------------
  // 表・段組み・脚注は PDF でしか確認できないため置き換えではなく切替。既定は PDF
  let viewMode: 'pdf' | 'text' = 'pdf';
  const textViewer = createTextViewer();

  function activeDocumentHasText(): boolean {
    return activeDocument().extractedPages.some((page) => page.text !== '');
  }

  const pdfModeButton = el('button', {
    className: 'verify__view-toggle-btn',
    text: 'PDF',
    attributes: { type: 'button', 'aria-pressed': 'true' },
  }) as HTMLButtonElement;
  const textModeButton = el('button', {
    className: 'verify__view-toggle-btn',
    text: '抽出テキスト',
    attributes: { type: 'button', 'aria-pressed': 'false' },
  }) as HTMLButtonElement;
  const viewToggleBar = el(
    'div',
    { className: 'verify__view-toggle', attributes: { role: 'group', 'aria-label': '左ペインの表示切替' } },
    [pdfModeButton, textModeButton],
  );
  const textModeNote = el('p', {
    className: 'verify__view-toggle-note',
    text: 'この文書には抽出テキストがありません（no_text_layer、または抽出に失敗しています）',
  });

  const viewerBody = el('div', { className: 'verify__pdf-body' });
  const textViewerBody = el('div', { className: 'verify__text-body' }, [textViewer.root]);
  const leftChildren: HTMLElement[] = [];
  if (docTabsBar !== null) {
    leftChildren.push(docTabsBar);
  }
  leftChildren.push(viewToggleBar, textModeNote, noTextBanner, viewerBody, textViewerBody);
  const leftPane = el('div', { className: 'verify__pane verify__pane--pdf' }, leftChildren);

  /**
   * 表示中文書に PDF がないときのエラーカード（再試行 + 再取り込み導線。ui-states.md §6）。
   * 再試行ボタンはキャッシュされた失敗結果を捨てて読み直す（features/verification/pdfViewCache.retry）
   */
  function pdfErrorCard(documentId: string, message: string | null): HTMLElement {
    const retryButton = el('button', {
      className: 'verify__pdf-retry',
      text: '再試行',
      attributes: { type: 'button' },
    }) as HTMLButtonElement;
    retryButton.addEventListener('click', () => {
      void retryActiveDocumentPdf(documentId);
    });
    const link = el('a', { text: '文献取り込み画面を開く', attributes: { href: '#/documents' } });
    return el('div', { className: 'verify__pdf-error', attributes: { role: 'alert' } }, [
      el('p', { text: `PDF を開けません: ${message ?? '原因不明'}` }),
      retryButton,
      link,
    ]);
  }

  /**
   * 表示中文書（documentId）の PDF ビューア素材をロードして反映する。呼び出し側は
   * 連番ガード（seq）済みであること。成功時は viewer を生成 / 差し替え、失敗時はエラーカードを出す
   */
  function applyLoadedPdf(documentId: string, loaded: LoadedPdfView): void {
    // 矩形ハイライトは textPages が確定したこの時点で 1 回だけ実体化してメモ化する
    // （retry の読み直しでもここを通り、当該文書のキャッシュが差し替わる）
    rectHighlightsByDoc.set(
      documentId,
      loaded.pdf === null
        ? []
        : buildDocumentHighlights(
            documentId,
            data.evidence.filter((item) => item.documentId === documentId),
            loaded.textPages,
          ),
    );
    if (loaded.pdf !== null) {
      if (viewer === null) {
        viewer = createPdfViewer({
          document: loaded.pdf,
          pages: loaded.textPages,
          onHighlightClick: (id) => focusCell(id, { jump: false, domFocus: true }),
          renderPage: options.renderPage,
        });
      } else if (viewerDocId !== documentId) {
        viewer.setDocument(loaded.pdf, loaded.textPages);
      }
      viewerDocId = documentId;
      viewerBody.replaceChildren(viewer.root);
    } else {
      viewerBody.replaceChildren(pdfErrorCard(documentId, loaded.pdfError));
    }
    syncViewer();
    // 保留ジャンプ（ロード中に f キー等でジャンプ要求があった場合）を 1 回だけ適用する
    if (pendingJumpCellKey !== null) {
      const cellKey = pendingJumpCellKey;
      pendingJumpCellKey = null;
      if (viewer !== null && viewerDocId === documentId) {
        viewer.focusHighlight(cellKey);
      }
    }
  }

  function toErrorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }

  /**
   * 表示中文書の PDF を遅延読込する（読み込み中プレースホルダ → 解決で viewer / エラーカード）。
   * 解決前に別文書へ切替わっていたら結果は破棄する（連番ガード。issue #28 案3の受入基準）
   */
  function loadActiveDocumentPdf(): void {
    const documentId = activeDocumentId;
    const seq = ++docLoadSeq;
    viewerBody.replaceChildren(renderPdfLoadingPlaceholder());
    data.loadPdfView(documentId).then(
      (loaded) => {
        if (seq === docLoadSeq) {
          applyLoadedPdf(documentId, loaded);
        }
      },
      (err: unknown) => {
        if (seq === docLoadSeq) {
          applyLoadedPdf(documentId, { pdf: null, pdfError: toErrorMessage(err), textPages: [] });
        }
      },
    );
  }

  /** PDF 読込失敗からの再試行（キャッシュを捨てて読み直す）。表示が切り替わっていたら何もしない */
  async function retryActiveDocumentPdf(documentId: string): Promise<void> {
    if (documentId !== activeDocumentId) {
      return;
    }
    const seq = ++docLoadSeq;
    viewerBody.replaceChildren(renderPdfLoadingPlaceholder());
    let loaded: LoadedPdfView;
    try {
      loaded = await data.retryPdfView(documentId);
    } catch (err) {
      loaded = { pdf: null, pdfError: toErrorMessage(err), textPages: [] };
    }
    if (seq === docLoadSeq) {
      applyLoadedPdf(documentId, loaded);
    }
  }

  /**
   * 表示切替ボタン + 各ペインの表示 / 非表示を現在の viewMode へ合わせる。
   * 表示中文書に抽出テキストが無ければテキストモードから自動で PDF モードへ戻す
   * （issue #28 案2 の受入基準: 抽出テキストがない文書では PDF 表示だけを利用できる）
   */
  function applyViewMode(): void {
    const hasText = activeDocumentHasText();
    if (viewMode === 'text' && !hasText) {
      viewMode = 'pdf';
    }
    pdfModeButton.classList.toggle('verify__view-toggle-btn--active', viewMode === 'pdf');
    pdfModeButton.setAttribute('aria-pressed', String(viewMode === 'pdf'));
    textModeButton.classList.toggle('verify__view-toggle-btn--active', viewMode === 'text');
    textModeButton.setAttribute('aria-pressed', String(viewMode === 'text'));
    textModeButton.disabled = !hasText;
    textModeButton.title = hasText ? '' : 'この文書には抽出テキストがありません';
    textModeNote.hidden = hasText;
    viewerBody.hidden = viewMode !== 'pdf';
    textViewerBody.hidden = viewMode !== 'text';
  }

  function setViewMode(mode: 'pdf' | 'text'): void {
    if (mode === viewMode) {
      return;
    }
    viewMode = mode;
    applyViewMode();
  }

  pdfModeButton.addEventListener('click', () => setViewMode('pdf'));
  textModeButton.addEventListener('click', () => setViewMode('text'));

  /**
   * 表示中文書に合わせて左ペインのタブ強調 / バナー / 表示切替を描き直す（PDF 本体は含まない）。
   * PDF ペインの内容（読み込み中 / viewer / エラーカード）は loadActiveDocumentPdf が非同期に描く
   */
  function renderActiveDocumentChrome(): void {
    const view = activeDocument();
    for (const [id, button] of docTabButtons) {
      const active = id === activeDocumentId;
      button.classList.toggle('verify__doc-tab--active', active);
      button.setAttribute('aria-selected', String(active));
    }
    noTextBanner.hidden = view.document.textStatus !== 'no_text_layer';
    applyViewMode();
  }

  /** 表示中文書を切替える（タブクリック / 別文書由来のセルへのフォーカス）。PDF は遅延読込する */
  function setActiveDocument(documentId: string): void {
    if (documentId === activeDocumentId) {
      return;
    }
    activeDocumentId = documentId;
    renderActiveDocumentChrome();
    loadActiveDocumentPdf();
    syncTextViewer();
  }

  /**
   * セルの Evidence の出所文書へ表示を切替える（Evidence なしの手入力セルは現状維持）。
   * 出所文書が study の documents に無い場合（データ不整合の防御）は切替えない。
   * 切替えを実行したら true を返す（初期マウント時の二重ロード回避に使う）
   */
  function ensureActiveDocumentForCell(cellKey: string): boolean {
    const evidence = evidenceByCell.get(cellKey);
    if (
      evidence !== undefined &&
      evidence.documentId !== activeDocumentId &&
      data.documents.some((view) => view.document.documentId === evidence.documentId)
    ) {
      setActiveDocument(evidence.documentId);
      return true;
    }
    return false;
  }

  // --- 右ペイン（フォーム） -----------------------------------------------
  const formPane = el('div', { className: 'verify__pane verify__pane--form' });

  const root = el('div', { className: 'verify' }, [
    el('div', { className: 'verify__panes' }, [leftPane, formPane]),
  ]);

  /**
   * matchCount / 選択出現は「テキストのみの再特定」（textMatches）を唯一の情報源にする。
   * PDF のロード状態に関係なく一貫した表示になる（issue #28 案3）
   */
  function highlightInfo(): Map<string, CellHighlightInfo> {
    const info = new Map<string, CellHighlightInfo>();
    for (const match of textMatches) {
      info.set(match.cellKey, {
        matchCount: match.occurrences.length,
        matchIndex: matchSelection.get(match.cellKey) ?? match.selectedIndex,
      });
    }
    return info;
  }

  /**
   * ビューアの矩形ハイライト（applyLoadedPdf がメモ化済みのものを読むだけ）。
   * 呼び出しは syncViewer 経由に限られ、そのガード（viewerDocId === activeDocumentId）が
   * 成り立つのは applyLoadedPdf でメモを書いた後だけなので、メモは必ず存在する（不変条件）。
   * states / kind / 選択出現の反映は呼び出しごとに行う（判定・切替で変わるため）
   */
  function viewerHighlights(): ViewerHighlight[] {
    const docHighlights = rectHighlightsByDoc.get(activeDocumentId) as EvidenceHighlight[];
    const states = deriveCellStates(ownDecisions);
    return docHighlights.map((highlight) => {
      const [fieldId] = JSON.parse(highlight.cellKey) as [string, string];
      const status = states.get(highlight.cellKey)?.status ?? 'unverified';
      // ハイライトは evidence 由来のため対応する Evidence が必ず存在する
      const confidence = (evidenceByCell.get(highlight.cellKey) as Evidence).confidence;
      const selected = matchSelection.get(highlight.cellKey) ?? highlight.selectedIndex;
      // matchSelection の剰余はテキストマッチ（extracted_texts 由来）の件数で取られている。
      // extracted_texts と PDF テキスト層は同一系で通常一致するが、万一件数がズレた場合
      // （取り込み後に Drive 上の PDF が差し替えられた等）の undefined 参照を防ぐため、
      // rect 側の occurrences 長でもクランプする（0 件は buildDocumentHighlights が除外済み）
      const index = selected % highlight.occurrences.length;
      return {
        id: highlight.cellKey,
        label: fieldLabelById.get(fieldId) ?? fieldId,
        // 色分け: 検証済み = 緑 / low confidence = 橙 / 未検証 = 黄（requirements.md §5-4）
        kind:
          status !== 'unverified' ? 'verified' : confidence === 'low' ? 'low' : 'unverified',
        occurrence: highlight.occurrences[index] as HighlightOccurrence,
      };
    });
  }

  /**
   * viewer インスタンスが表示中文書を指しているときだけハイライトを反映する。
   * 文書切替直後で viewer がまだ旧文書（または未生成）を指している間は何もしない
   * （applyLoadedPdf が新文書のロード解決後にあらためて呼ぶ）
   */
  function syncViewer(): void {
    if (viewer !== null && viewerDocId === activeDocumentId) {
      viewer.setHighlights(viewerHighlights(), focusedCellKey);
    }
  }

  /** 文書のファイル名 + role ラベル（抽出テキストビューの出所文書表示。issue #28 案2） */
  function documentLabelOf(view: VerificationDocumentView): string {
    return `${view.document.filename}（${DOCUMENT_ROLE_LABELS[view.document.documentRole]}）`;
  }

  /**
   * 抽出テキストビューの表示を差し替える。既定は現在フォーカス中のセル（focusedCellKey）だが、
   * 「ハイライトへ移動」ボタン / f キー（onJump）は、フォーカスを動かさず指定セルの根拠だけを
   * 表示するため cellKey を明示的に渡せる（PDF モードの viewer.focusHighlight と同じ位置付け）
   */
  function syncTextViewer(cellKey: string | null = focusedCellKey): void {
    if (cellKey === null) {
      textViewer.setSnippet(null);
      return;
    }
    const evidence = evidenceByCell.get(cellKey);
    if (evidence === undefined || evidence.quote === null) {
      textViewer.setSnippet(null);
      return;
    }
    const view = data.documents.find(
      (candidate) => candidate.document.documentId === evidence.documentId,
    );
    if (view === undefined) {
      // データ不整合の防御（quote の出所文書が study の documents に無い）
      textViewer.setSnippet(null);
      return;
    }
    const documentLabel = documentLabelOf(view);
    const context = findQuoteContext(evidence, view.extractedPages);
    const snippet: TextViewerSnippet =
      context === null
        ? { documentLabel, quote: evidence.quote, located: null }
        : {
            documentLabel,
            quote: context.snippet.quote,
            located: {
              page: context.page,
              before: context.snippet.before,
              after: context.snippet.after,
            },
          };
    textViewer.setSnippet(snippet);
  }

  /** セルの DOM を引く。呼び出し側は描画済みの現在タブの cellKey のみ渡す（不変条件） */
  function findCellElement(cellKey: string): HTMLElement {
    return [...formPane.querySelectorAll<HTMLElement>('.verify__cell')].find(
      (node) => node.dataset['cellKey'] === cellKey,
    ) as HTMLElement;
  }

  function applyFocusClasses(): void {
    for (const node of formPane.querySelectorAll<HTMLElement>('.verify__cell')) {
      node.classList.toggle('verify__cell--focused', node.dataset['cellKey'] === focusedCellKey);
    }
  }

  /**
   * 現在タブのセルを引く。フォームのハンドラとキーボード操作は現在タブに存在する
   * cellKey しか渡さない（selectTab / focusCell がフォーカスを常にタブ内へ再設定する不変条件）
   */
  function findCell(cellKey: string): VerificationCell {
    return currentTabModel().cells.find((cell) => cell.cellKey === cellKey) as VerificationCell;
  }

  /** cellKey がどのタブに属するか（ビューアクリック時のタブ切替に使う） */
  function tabOfCell(cellKey: string): EntityLevel | null {
    for (const tab of tabs) {
      const model = buildTabModel(tab, data.fields, data.evidence, ownDecisions, {
        armStructure,
      });
      if (model.cells.some((cell) => cell.cellKey === cellKey)) {
        return tab;
      }
    }
    return null;
  }

  /** 追加行の arm_key（既存の `arm:数値` の最大 + 1。非数値キーは数えない） */
  function nextArmKey(): string {
    let max = 0;
    for (const arm of armRows) {
      const match = /^arm:(\d+)$/.exec(arm.armKey);
      if (match !== null) {
        max = Math.max(max, Number(match[1]));
      }
    }
    return `arm:${max + 1}`;
  }

  const handlers: VerificationFormHandlers = {
    // ロック中タブの排他は verificationForm 側が担う（disabled ボタンにはリスナを付けない）
    onSelectTab(tab) {
      activeTab = tab;
      focusedCellKey = computeInitialFocusKey(tab);
      editing = null;
      refreshForm();
      syncViewer();
      syncTextViewer();
    },
    onFocusCell(cellKey) {
      focusCell(cellKey, { jump: true, domFocus: false });
    },
    onAccept(cellKey) {
      const cell = findCell(cellKey);
      if (cell.evidence === null) {
        return;
      }
      commit(cell, 'accept', cell.evidence.notReported ? NOT_REPORTED_TOKEN : cell.evidence.value);
    },
    onStartEdit(cellKey, action) {
      editing = { cellKey, action };
      focusedCellKey = cellKey;
      refreshForm();
      // 値入力へ即フォーカス（e キーの操作感。ui-flow.md §7）
      formPane.querySelector<HTMLInputElement>('.verify__edit-input')?.focus();
    },
    onConfirmEdit(cellKey, action, value) {
      const cell = findCell(cellKey);
      editing = null;
      const trimmed = value.trim();
      commit(cell, action, trimmed === '' ? null : trimmed);
    },
    onCancelEdit() {
      editing = null;
      refreshForm();
    },
    onNotReported(cellKey) {
      commit(findCell(cellKey), 'not_reported', NOT_REPORTED_TOKEN);
    },
    onUndo(cellKey) {
      const cell = findCell(cellKey);
      if (cell.state.stack.length === 0) {
        return;
      }
      commit(cell, 'undo', undoRevertValue(cell.state));
    },
    onJump(cellKey) {
      // f キー / 「ハイライトへ移動」: PDF モードはページジャンプ、テキストモードは
      // 当該セルの根拠へスニペットを差し替える（フォーカスは動かさない。issue #28 案2）
      if (viewMode === 'text') {
        syncTextViewer(cellKey);
      } else {
        focusHighlightNowOrPending(cellKey);
      }
    },
    onSearchQuote(quote) {
      viewer?.search(quote);
    },
    onCycleMatch(cellKey) {
      // 切替ボタンは matchCount > 1 のセルにしか出ないため、対応するテキストマッチが必ず存在する
      const match = textMatchByCell.get(cellKey) as EvidenceTextMatch;
      const current = matchSelection.get(cellKey) ?? match.selectedIndex;
      matchSelection.set(cellKey, (current + 1) % match.occurrences.length);
      refreshForm();
      syncViewer();
      focusHighlightNowOrPending(cellKey);
      syncTextViewer(cellKey);
    },
    onExpandDecided(cellKey) {
      // コンパクト行は判定操作ボタンを含まないため、click 発火後の再構築で安全に展開できる
      expandedDecidedKey = cellKey;
      focusedCellKey = cellKey;
      refreshForm();
      ensureActiveDocumentForCell(cellKey);
      syncViewer();
      focusHighlightNowOrPending(cellKey);
      syncTextViewer();
      const element = findCellElement(cellKey);
      element.scrollIntoView?.({ block: 'nearest' });
      element.focus();
    },
    onCollapseDecided() {
      expandedDecidedKey = null;
      refreshForm();
    },
    onArmNameChange(index, name) {
      // フォームは armRows から描画され、change は同一描画世代の index しか渡さない
      (armRows[index] as DraftArm).armName = name;
    },
    onArmAddRow() {
      armRows.push({ armKey: nextArmKey(), armName: '' });
      refreshForm();
    },
    onArmRemoveRow(index) {
      armRows.splice(index, 1);
      refreshForm();
    },
    onArmConfirm() {
      const trimmed = armRows.map((arm) => ({ armKey: arm.armKey, armName: arm.armName.trim() }));
      if (trimmed.length === 0) {
        armError = '少なくとも 1 つの群が必要です';
        refreshForm();
        return;
      }
      if (trimmed.some((arm) => arm.armName === '')) {
        armError = '名称が空の群があります。すべての群に名称を入力してください';
        refreshForm();
        return;
      }
      // 楽観反映（判定と同じ流儀）。永続化はサービス層へ委譲する
      armStructure = { version: (armStructure?.version ?? 0) + 1, arms: trimmed };
      armRows = trimmed.map((arm) => ({ ...arm }));
      armEditing = false;
      armError = null;
      outcomeError = null;
      refreshForm();
      options.onArmConfirm?.(trimmed);
    },
    onArmRevise() {
      // 確定済みカードにしか「改訂」は出ないため armStructure は非 null
      armRows = (armStructure as ConfirmedArmStructure).arms.map((arm) => ({ ...arm }));
      armEditing = true;
      armError = null;
      refreshForm();
    },
    onArmCancelRevise() {
      armRows = (armStructure as ConfirmedArmStructure).arms.map((arm) => ({ ...arm }));
      armEditing = false;
      armError = null;
      refreshForm();
    },
    onOutcomeKeyChange(value) {
      outcomeKeyDraft = value;
      outcomeError = null;
    },
    onOutcomeTimeChange(value) {
      outcomeTimeDraft = value;
      outcomeError = null;
    },
    onOutcomeAdd() {
      const outcomeId = outcomeKeyDraft.trim();
      const time = outcomeTimeDraft.trim();
      if (outcomeId === '') {
        outcomeError = 'アウトカムキーを入力してください';
        refreshForm();
        return;
      }
      let declarations: Decision[];
      try {
        declarations = buildOutcomeDeclarationDecisions({
          studyId: data.study.studyId,
          outcomeId,
          time: time === '' ? null : time,
          arms: (armStructure as ConfirmedArmStructure).arms,
          annotator: data.annotator,
          schemaVersion: data.schemaVersion,
          decidedAt: now(),
        });
      } catch (err) {
        outcomeError = String(err);
        refreshForm();
        return;
      }
      const existing = new Set(
        entityInstances('outcome_result', data.evidence, ownDecisions, { armStructure }),
      );
      const duplicate = declarations.find((decision) => existing.has(decision.entityKey));
      if (duplicate !== undefined) {
        outcomeError = `entity_key ${duplicate.entityKey} は既に存在します`;
        refreshForm();
        return;
      }
      ownDecisions.push(...declarations);
      outcomeKeyDraft = nextOutcomeId(
        entityInstances('outcome_result', data.evidence, ownDecisions, { armStructure }),
      );
      outcomeTimeDraft = '';
      outcomeError = null;
      activeTab = 'outcome_result';
      const firstEntityKey = declarations[0]!.entityKey;
      const nextModel = currentTabModel();
      // 宣言を ownDecisions に追加済みなので、直後のセルモデルには必ず同じ entity_key が現れる
      focusedCellKey = nextModel.cells.find((cell) => cell.entityKey === firstEntityKey)!.cellKey;
      editing = null;
      refreshForm();
      syncViewer();
      syncTextViewer();
      options.onInstanceDeclare?.(declarations);
    },
    onToggleLayoutMode(mode) {
      setLayoutMode(mode);
    },
  };

  function refreshForm(): void {
    const doc = root.ownerDocument;
    const hadFocus = root.contains(doc.activeElement);
    // フォームペイン全体を作り直すためスクロール位置が 0 へクランプされる。退避して復元する
    const savedScrollTop = formPane.scrollTop;
    const model: VerificationFormModel = {
      tabs,
      activeTab,
      tabModel: currentTabModel(),
      focusedCellKey,
      editing,
      recentDecidedKey,
      expandedDecidedKey,
      highlightInfo: highlightInfo(),
      // 「本文内を検索」は表示中文書に対して走る。フォーカスは出所文書へ切替わるため、
      // 表示中文書のテキスト層有無で出し分ける（v0.10 フェーズ 3。extracted_texts 基準）
      canSearchText: activeDocument().extractedPages.some((page) => page.text !== ''),
      armCard: armRequired
        ? {
            editing: armEditing,
            rows: armRows,
            confirmedVersion: armStructure?.version ?? null,
            error: armError,
          }
        : null,
      outcomeAdd:
        activeTab === 'outcome_result' && armStructure !== null
          ? { outcomeKey: outcomeKeyDraft, time: outcomeTimeDraft, error: outcomeError }
          : null,
      armLocked: armLocked(),
      progress: verificationProgress(data.fields, data.evidence, ownDecisions, { armStructure }),
      layoutMode,
      focusCard: layoutMode === 'focus' ? buildFocusCardModel() : null,
    };
    formPane.replaceChildren(renderVerificationForm(model, handlers));
    formPane.scrollTop = savedScrollTop;
    if (hadFocus && focusedCellKey !== null && editing === null && !tabLocked(activeTab)) {
      // 復元したスクロール位置を尊重しつつ（preventScroll）、フォーカスセルが画面外なら最小移動で見せる
      const element = findCellElement(focusedCellKey);
      element.focus({ preventScroll: true });
      element.scrollIntoView?.({ block: 'nearest' });
    }
  }

  /**
   * セルへフォーカスを移す。同一タブ内はフォーム再構築なしのクラス切替に留める
   * （focusin → 再構築だと直後の click がキャンセルされるため）
   */
  function focusCell(
    cellKey: string,
    behavior: { jump: boolean; domFocus: boolean },
  ): void {
    if (cellKey === focusedCellKey) {
      return;
    }
    const tab = tabOfCell(cellKey);
    if (tab === null || tabLocked(tab)) {
      // ロック中のタブへはジャンプしない（ハイライトクリック経由。群構成の確定が先）
      return;
    }
    focusedCellKey = cellKey;
    // 判定済みブロックのコンパクト行へ着地するとき（ビューアクリック / j・k / ディープリンク）は
    // 展開して通常カードを見せる。コンパクト行は focusin リスナを持たないため、
    // ここでの再構築が click をキャンセルする経路は通常カードの focusin だけに限られ、
    // その場合は下の else（クラス切替のみ）を通る。判定済みブロックはリストモード限定の概念
    const target = buildTabModel(tab, data.fields, data.evidence, ownDecisions, {
      armStructure,
    }).cells.find((cell) => cell.cellKey === cellKey) as VerificationCell;
    const expand =
      layoutMode === 'list' &&
      target.state.status !== 'unverified' &&
      cellKey !== recentDecidedKey &&
      expandedDecidedKey !== cellKey;
    if (expand) {
      expandedDecidedKey = cellKey;
    }
    if (tab !== activeTab) {
      activeTab = tab;
      editing = null;
      refreshForm();
    } else if (layoutMode === 'focus' || expand) {
      // フォーカスモードは常に単一の詳細ストリップを再構築する必要があるため、
      // クラス切替（applyFocusClasses）だけでは新しいセルの内容を描けない
      refreshForm();
    } else {
      applyFocusClasses();
    }
    // 別文書由来のセルなら出所 PDF へ自動切替してからハイライトへ（v0.10 フェーズ 3）
    ensureActiveDocumentForCell(cellKey);
    syncViewer();
    syncTextViewer();
    if (behavior.jump) {
      // 項目フォーカス → 該当ハイライトへスクロール + 強調（requirements.md §4.2）
      focusHighlightNowOrPending(cellKey);
    }
    if (behavior.domFocus) {
      const element = findCellElement(cellKey);
      element.scrollIntoView?.({ block: 'nearest' });
      element.focus();
    }
  }

  /**
   * ?entity= ディープリンクの着地（ui-states.md §3 `#/verify`）。
   * entity の属するタブへ切替えて先頭セルへスクロール・フォーカスする。
   * 存在しない entity_key・ロック中のタブに属する entity は無視して通常表示のまま
   */
  function focusEntity(entityKey: string): void {
    for (const tab of tabs) {
      if (tabLocked(tab)) {
        continue;
      }
      const model = buildTabModel(tab, data.fields, data.evidence, ownDecisions, {
        armStructure,
      });
      const cell = model.cells.find((candidate) => candidate.entityKey === entityKey);
      if (cell === undefined) {
        continue;
      }
      if (cell.cellKey !== focusedCellKey) {
        focusCell(cell.cellKey, { jump: true, domFocus: true });
      } else {
        // 初期フォーカスと同一セル（study の先頭など）でもスクロール・フォーカスは行う
        const element = findCellElement(cell.cellKey);
        element.scrollIntoView?.({ block: 'nearest' });
        element.focus();
      }
      return;
    }
  }

  function commit(cell: VerificationCell, action: DecisionAction, value: string | null): void {
    const decision: Decision = {
      decidedAt: now(),
      decidedBy: data.annotator,
      studyId: data.study.studyId,
      fieldId: cell.field.fieldId,
      entityKey: cell.entityKey,
      annotator: data.annotator,
      annotatorType: 'human_with_ai',
      schemaVersion: data.schemaVersion,
      action,
      value,
      note: null,
    };
    ownDecisions.push(decision);
    // 判定済みブロックの制御: 直近判定の 1 件だけ元の位置へ残す（見直し・戻す (z) 用）。
    // undo でセルがまだ判定済みのまま（判定が積み重なっている）なら展開を維持して連続 undo を可能にする
    if (action === 'undo') {
      recentDecidedKey = null;
      // undo を積んだ直後のため、このセルの状態エントリは必ず存在する
      const state = deriveCellStates(ownDecisions).get(cell.cellKey) as CellState;
      expandedDecidedKey = state.status === 'unverified' ? null : cell.cellKey;
    } else {
      recentDecidedKey = cell.cellKey;
      expandedDecidedKey = null;
    }
    // 判定後は次の未判定セルへ自動遷移する（j キーの手動送りを不要に）。
    // 全セル判定済み・undo（取り消し直後に同じセルで再判定するため）は現在セルに留まる
    let movedTo: string | null = null;
    if (action !== 'undo') {
      if (layoutMode === 'focus') {
        // 同一ユニット内の次の未判定セル → 無ければ次の未判定ユニットの最初の未判定セル。
        // cell は判定直前までフォーカスされていたセルのため、必ずどこかのユニットに属する
        const units = focusUnitsOf(activeTab);
        const currentUnit = unitOfCell(units, cell.cellKey) as FocusUnit;
        movedTo = nextPendingCellInUnit(currentUnit, cell.cellKey);
        if (movedTo === null) {
          const nextUnit = nextPendingUnit(units, currentUnit.unitKey);
          movedTo = nextUnit === null ? null : nextPendingCellInUnit(nextUnit, null);
        }
      } else {
        const cells = currentTabModel().cells;
        const currentIndex = cells.findIndex((candidate) => candidate.cellKey === cell.cellKey);
        movedTo = nextUndecidedKey(cells, currentIndex + 1);
      }
    }
    focusedCellKey = movedTo ?? cell.cellKey;
    refreshForm();
    syncViewer();
    syncTextViewer();
    if (movedTo !== null) {
      // PDF ハイライトも遷移先へ追従（f キーと同じ体験）+ セル DOM を可視化・フォーカス。
      // 遷移先が別文書由来なら出所 PDF へ切替えてから（v0.10 フェーズ 3）
      ensureActiveDocumentForCell(movedTo);
      focusHighlightNowOrPending(movedTo);
      const element = findCellElement(movedTo);
      element.scrollIntoView?.({ block: 'nearest' });
      element.focus();
    }
    options.onDecision(decision);
  }

  function moveFocus(delta: number): void {
    // 表示順（未判定 + 直近判定 → 判定済みブロック）で移動する
    const cells = displayCells();
    if (cells.length === 0) {
      return;
    }
    // フォーカス未設定（findIndex = -1）は delta によらず先頭へ寄せる（clamp で吸収）
    const index = cells.findIndex((cell) => cell.cellKey === focusedCellKey);
    const next = Math.min(Math.max(index + delta, 0), cells.length - 1);
    const cell = cells[next] as VerificationCell;
    focusCell(cell.cellKey, { jump: true, domFocus: true });
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (!root.isConnected || editing !== null || tabLocked(activeTab)) {
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }
    const target = event.target;
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement
    ) {
      return;
    }
    if (event.shiftKey) {
      // フォーカスモードの Shift+J / Shift+K（前後ユニットへ移動）だけを許可する。
      // それ以外の Shift 併用（誤爆防止）は無視する
      if (layoutMode === 'focus' && (event.key === 'J' || event.key === 'K')) {
        event.preventDefault();
        moveToAdjacentUnit(event.key === 'J' ? 1 : -1);
      }
      return;
    }
    switch (event.key) {
      case 'j':
      case 'ArrowDown':
        event.preventDefault();
        if (layoutMode === 'focus') {
          moveFocusInUnit('row', 1);
        } else {
          moveFocus(1);
        }
        return;
      case 'k':
      case 'ArrowUp':
        event.preventDefault();
        if (layoutMode === 'focus') {
          moveFocusInUnit('row', -1);
        } else {
          moveFocus(-1);
        }
        return;
      case 'h':
      case 'ArrowLeft':
        if (layoutMode === 'focus') {
          event.preventDefault();
          moveFocusInUnit('col', -1);
        }
        return;
      case 'l':
      case 'ArrowRight':
        if (layoutMode === 'focus') {
          event.preventDefault();
          moveFocusInUnit('col', 1);
        }
        return;
      default:
        break;
    }
    if (focusedCellKey === null) {
      return;
    }
    switch (event.key) {
      case 'a':
        event.preventDefault();
        handlers.onAccept(focusedCellKey);
        break;
      case 'e':
        event.preventDefault();
        handlers.onStartEdit(focusedCellKey, 'edit');
        break;
      case 'x':
        event.preventDefault();
        handlers.onStartEdit(focusedCellKey, 'reject');
        break;
      case 'n':
        event.preventDefault();
        handlers.onNotReported(focusedCellKey);
        break;
      case 'z':
        event.preventDefault();
        // フォーカスモードは直近判定セルへ z を効かせる（ユニットをまたいでも undo できる）。
        // リストモードは従来どおりフォーカス中セルへ
        handlers.onUndo(layoutMode === 'focus' ? (recentDecidedKey ?? focusedCellKey) : focusedCellKey);
        break;
      case 'f':
        event.preventDefault();
        handlers.onJump(focusedCellKey);
        break;
      default:
        break;
    }
  }

  const ownerDoc = root.ownerDocument;
  ownerDoc.addEventListener('keydown', handleKeydown);

  focusedCellKey = computeInitialFocusKey(activeTab);
  // 初期フォーカスセルの出所文書を表示（study の先頭は通常 article。別文書なら切替）。
  // ensureActiveDocumentForCell が切替えた場合はその中で PDF ロードも始まっているため、
  // ここでの初期ロードは二重に始めない
  const switchedInitially =
    focusedCellKey !== null && ensureActiveDocumentForCell(focusedCellKey);
  if (!switchedInitially) {
    renderActiveDocumentChrome();
    loadActiveDocumentPdf();
  }
  refreshForm();
  syncViewer();
  syncTextViewer();

  return {
    root,
    focusEntity,
    scrollFocusedIntoView() {
      const element = [...formPane.querySelectorAll<HTMLElement>('.verify__cell')].find(
        (node) => node.dataset['cellKey'] === focusedCellKey,
      );
      element?.scrollIntoView?.({ block: 'nearest' });
    },
    dispose() {
      ownerDoc.removeEventListener('keydown', handleKeydown);
    },
  };
}

// ---------------------------------------------------------------------------
// ストア再描画との整合（view は純粋関数のまま、パネルの生存期間だけここで管理する）
// ---------------------------------------------------------------------------

let cachedPanel: {
  data: VerificationData;
  handle: VerificationPanelHandle;
  /** 適用済みの ?entity=（同じ値の再描画でフォーカスを奪い直さないための記録） */
  appliedFocusEntity: string | null;
} | null = null;

/**
 * 同じ VerificationData 参照に対しては同一パネル（DOM / 判定の楽観状態）を返す。
 * データが差し替わったら古いパネルを破棄して作り直す。
 * focusEntityKey は値が変わったときだけ focusEntity を呼ぶ（ストア再描画では発火しない）
 */
export function renderCachedVerificationPanel(options: VerificationPanelOptions): HTMLElement {
  const focusEntityKey = options.focusEntityKey ?? null;
  if (cachedPanel === null || cachedPanel.data !== options.data) {
    cachedPanel?.handle.dispose();
    const handle = createVerificationPanel(options);
    cachedPanel = { data: options.data, handle, appliedFocusEntity: null };
    if (focusEntityKey === null) {
      // ?entity= 指定時は下の focusEntity 適用に任せる。未指定時のみ初期フォーカスセルを可視化する。
      // render 時点ではパネルが DOM 未接続のため、接続後（microtask）にスクロールする
      queueMicrotask(() => {
        if (cachedPanel?.handle === handle) {
          handle.scrollFocusedIntoView();
        }
      });
    }
  }
  if (focusEntityKey !== cachedPanel.appliedFocusEntity) {
    cachedPanel.appliedFocusEntity = focusEntityKey;
    if (focusEntityKey !== null) {
      // render 時点ではパネルが DOM 未接続（スクロール・フォーカス不能）のため、
      // 呼び出し側が接続し終えた後（microtask）に適用する
      const handle = cachedPanel.handle;
      queueMicrotask(() => {
        if (cachedPanel?.handle === handle) {
          handle.focusEntity(focusEntityKey);
        }
      });
    }
  }
  return cachedPanel.handle.root;
}

/** テスト・プロジェクト切替時の後始末 */
export function disposeVerificationPanelCache(): void {
  cachedPanel?.handle.dispose();
  cachedPanel = null;
}
