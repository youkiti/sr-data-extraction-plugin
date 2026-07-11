// ハッシュルーティングのルート定義（ui-flow.md §2）。
// 遷移時のガード適用・描画は bootstrap.ts が行い、本ファイルは定義と正規化のみを持つ
import type { AppState } from './store';
import type { ViewContext } from './views/types';
import { renderHomeView } from './views/homeView';
import { renderDocumentsView } from './views/documentsView';
import { renderProtocolView } from './views/protocolView';
import { renderSchemaView } from './views/schemaView';
import { renderPilotView } from './views/pilotView';
import { renderExtractView } from './views/extractView';
import { renderVerifyView } from './views/verifyView';
import { renderDashboardView } from './views/dashboardView';
import { renderExportView } from './views/exportView';
import { renderAdjudicateView } from './views/adjudicateView';
import { renderSettingsView } from './views/settingsView';

export type RouteHash =
  | '#/home'
  | '#/documents'
  | '#/protocol'
  | '#/schema'
  | '#/pilot'
  | '#/extract'
  | '#/verify'
  | '#/dashboard'
  | '#/export'
  | '#/adjudicate'
  | '#/options';

export interface RouteDefinition {
  hash: RouteHash;
  /** サイドバー・スクリーンリーダ通知用の表示名 */
  label: string;
  render(state: AppState, ctx: ViewContext): HTMLElement;
}

export const ROUTES: RouteDefinition[] = [
  { hash: '#/home', label: 'Home', render: renderHomeView },
  { hash: '#/documents', label: '文献取り込み', render: renderDocumentsView },
  { hash: '#/protocol', label: 'プロトコル', render: renderProtocolView },
  { hash: '#/schema', label: '表のデザイン', render: renderSchemaView },
  { hash: '#/pilot', label: 'パイロット抽出', render: renderPilotView },
  { hash: '#/extract', label: '一括抽出', render: renderExtractView },
  { hash: '#/verify', label: '検証', render: renderVerifyView },
  { hash: '#/dashboard', label: 'ダッシュボード', render: renderDashboardView },
  { hash: '#/export', label: 'エクスポート', render: renderExportView },
  { hash: '#/adjudicate', label: '裁定', render: renderAdjudicateView },
];

/**
 * 設定ルート。ステップナビ（ROUTES）とは別建てで、サイドバーには出さず、
 * ヘッダの歯車リンク（app.html の #/options）とプロジェクト選択ページの「設定を開く」から入る。
 * ガードは常に許可（guards.ts の default）
 */
export const SETTINGS_ROUTE: RouteDefinition = {
  hash: '#/options',
  label: '設定',
  render: renderSettingsView,
};

/** ステップナビ 9 ルート + 設定ルート（正規化・解決の対象。ナビ描画は ROUTES のみ使う） */
const ALL_ROUTES: RouteDefinition[] = [...ROUTES, SETTINGS_ROUTE];

/**
 * location.hash をルートへ正規化する。クエリ（#/verify?study=... 等）は切り落とし、
 * 未知のハッシュ・空文字は #/home へ倒す
 */
export function normalizeHash(rawHash: string): RouteHash {
  const base = rawHash.split('?')[0];
  const matched = ALL_ROUTES.find((route) => route.hash === base);
  return matched ? matched.hash : '#/home';
}

export function findRoute(hash: RouteHash): RouteDefinition {
  // normalizeHash 済みのハッシュのみ渡される前提のため必ず見つかる
  return ALL_ROUTES.find((route) => route.hash === hash) as RouteDefinition;
}

function queryParamOf(rawHash: string, name: string): string | null {
  const query = rawHash.split('?')[1];
  if (query === undefined) {
    return null;
  }
  const value = new URLSearchParams(query).get(name);
  return value === null || value === '' ? null : value;
}

/** `#/verify?study={study_id}` の study クエリを取り出す（ui-flow.md §3。v0.10 フェーズ 3） */
export function studyQueryOf(rawHash: string): string | null {
  return queryParamOf(rawHash, 'study');
}

/**
 * `#/verify?study=...&entity={entity_key}` の entity クエリを取り出す（ui-flow.md §3 の
 * セル単位ディープリンク。S9 ダッシュボードのセルクリックが遷移元）
 */
export function entityQueryOf(rawHash: string): string | null {
  return queryParamOf(rawHash, 'entity');
}
