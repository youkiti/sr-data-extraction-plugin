// S5 確定済み画面の「共同研究者との相談用ドキュメント」作成。
// 選んだ版のスキーマ項目・パイロットの AI 例・判定内訳を HTML にまとめ、Drive が Google ドキュメントへ
// 変換する形でプロジェクトのフォルダへ保存する。毎回新しいファイルを作り、共有設定には触れない。
import type { Decision } from '../../domain/decision';
import type { Evidence } from '../../domain/evidence';
import type { ExtractionRun } from '../../domain/extractionRun';
import { readEvidenceRows } from '../../features/extraction/evidenceRepository';
import { readPilotRuns } from '../../features/extraction/runRepository';
import { buildSchemaConsultDocHtml } from '../../features/schema/consultDoc';
import { getSchemaFieldsByVersion } from '../../features/schema/schemaRepository';
import { readAllDecisions } from '../../features/verification/decisionRepository';
import { uploadTextFile } from '../../lib/google/drive';
import { getCurrentUserEmail } from '../../lib/google/identity';
import { t } from '../../lib/i18n';
import type { Store } from '../store';
import type { PilotMatrixState } from './pilotMatrixService';
import type { SchemaServiceDeps } from './schemaService';

export type SchemaConsultDocDeps = Pick<SchemaServiceDeps, 'google' | 'profile'> & {
  /** ファイル名・本文の出力日に使う現在時刻（ローカル日付を取る）。テストは固定値を注入する */
  nowDate?: () => Date;
};

const GOOGLE_DOC_MIME_TYPE = 'application/vnd.google-apps.document';

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function localDate(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function patchConsultDoc(
  store: Store,
  patch: Partial<ReturnType<Store['getState']>['schema']['consultDoc']>,
): void {
  const { schema } = store.getState();
  store.setState({ schema: { ...schema, consultDoc: { ...schema.consultDoc, ...patch } } });
}

/** 版の選択を変える。作成済みのリンクとエラーは前の版のものなので消す */
export function selectConsultDocVersion(store: Store, version: number): void {
  if (store.getState().schema.consultDoc.exporting) {
    return;
  }
  patchConsultDoc(store, { version, error: null, link: null });
}

interface PilotMaterials {
  run: ExtractionRun;
  evidence: Evidence[];
  decisions: Decision[];
}

/** 選んだ版の最新の完了パイロットを読む。読み込み済みの run は再利用し、無ければ Sheets から読む */
async function loadPilotMaterials(
  store: Store,
  deps: SchemaConsultDocDeps,
  spreadsheetId: string,
  schemaVersion: number,
): Promise<PilotMaterials | null> {
  const { pilot } = store.getState();
  const runs = pilot.history ?? (await readPilotRuns(spreadsheetId, deps.google));
  // 履歴は新しい順。先頭の一致が最新の完了 run
  const run = runs.find((item) => item.schemaVersion === schemaVersion);
  if (run === undefined) {
    return null;
  }
  const loaded = pilot.run?.runId === run.runId && pilot.evidence !== null && pilot.matrix?.runId === run.runId;
  const evidence = loaded
    ? (pilot.evidence as Evidence[])
    : await readEvidenceRows(spreadsheetId, deps.google);
  let decisions: Decision[];
  if (loaded) {
    decisions = (pilot.matrix as PilotMatrixState).decisions;
  } else {
    const email = (await getCurrentUserEmail(deps.profile)) ?? '';
    decisions = (await readAllDecisions(spreadsheetId, deps.google)).filter(
      (item) => item.annotator === email,
    );
  }
  return {
    run,
    evidence: evidence.filter((item) => item.runId === run.runId),
    // 独立二重レビュー（human_independent）などは載せない。本人の AI 併用判定だけを使う
    decisions: decisions.filter(
      (item) => item.annotatorType === 'human_with_ai' && run.studyIds.includes(item.studyId),
    ),
  };
}

/** 選んだ版の相談用ドキュメントを Drive に作る。成功すれば link を state へ入れる */
export async function exportSchemaConsultDoc(
  store: Store,
  deps: SchemaConsultDocDeps,
  schemaVersion: number,
): Promise<void> {
  const state = store.getState();
  const project = state.currentProject;
  if (!project || state.schema.consultDoc.exporting) {
    return;
  }
  patchConsultDoc(store, { version: schemaVersion, exporting: true, error: null, link: null });
  try {
    const meta = state.schema.versions?.find((item) => item.schemaVersion === schemaVersion);
    if (meta === undefined) {
      throw new Error(t('schema.consultDocVersionMissing', { version: schemaVersion }));
    }
    const fields = await getSchemaFieldsByVersion(project.spreadsheetId, schemaVersion, deps.google);
    const pilot = await loadPilotMaterials(store, deps, project.spreadsheetId, schemaVersion);
    const exportedDate = localDate((deps.nowDate ?? (() => new Date()))());
    const studyLabels = new Map(
      (store.getState().documents.studies ?? []).map((study) => [study.studyId, study.studyLabel]),
    );
    const content = buildSchemaConsultDocHtml({
      projectName: project.name,
      schemaVersion: meta,
      fields,
      exportedDate,
      pilot: pilot === null ? null : { ...pilot, studyLabels },
    });
    const file = await uploadTextFile(
      {
        name: `スキーマ v${schemaVersion} 相談用 ${exportedDate}`,
        content,
        parentId: project.driveFolderId,
        mimeType: 'text/html',
        targetMimeType: GOOGLE_DOC_MIME_TYPE,
      },
      deps.google,
    );
    patchConsultDoc(store, { exporting: false, link: file.webViewLink });
  } catch (err) {
    patchConsultDoc(store, { exporting: false, error: toMessage(err) });
  }
}
