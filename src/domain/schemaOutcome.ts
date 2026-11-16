// スキーマの版ごとに保存する、プロジェクト共通のアウトカムの一覧。
export type OutcomeAddedVia = 'schema_editor' | 'ai_draft' | 'pilot_verify' | 'pilot_candidate' | 'migration' | 'file_import';

export interface SchemaOutcome {
  schemaVersion: number;
  outcomeIndex: number;
  outcomeId: string;
  outcomeLabel: string;
  description: string | null;
  typicalTimepoints: string | null;
  addedVia: OutcomeAddedVia;
  note: string | null;
}
