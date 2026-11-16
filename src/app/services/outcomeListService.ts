import { readAllSchemaOutcomes } from '../../features/schema/schemaOutcomeRepository';
import { listSchemaVersions } from '../../features/schema/schemaRepository';
import { buildOutcomeListContext, type OutcomeListContext } from '../../features/schema/outcomeListContext';
import type { GoogleApiDeps } from '../../lib/google/types';

/** 最新の確定版に属する一覧を読み込む。旧プロジェクトは null を返す。 */
export async function readCurrentOutcomeList(spreadsheetId: string, google: GoogleApiDeps): Promise<OutcomeListContext | null> {
  const [outcomes, versions] = await Promise.all([
    readAllSchemaOutcomes(spreadsheetId, google),
    listSchemaVersions(spreadsheetId, google),
  ]);
  return buildOutcomeListContext(outcomes, versions, versions[0]?.schemaVersion ?? 0);
}
