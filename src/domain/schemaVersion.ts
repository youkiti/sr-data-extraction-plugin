// SchemaVersions タブに対応する型（requirements.md §3.2）。追記型・1 行 = 1 版

export type SchemaCreatedByType = 'ai_draft' | 'user_edit' | 'pilot_revision';

export interface SchemaVersion {
  /** 1 から始まる版番号 */
  schemaVersion: number;
  /** 派生元の版。初版は null */
  parentVersion: number | null;
  /** 依拠した Protocol.version */
  protocolVersion: number;
  createdByType: SchemaCreatedByType;
  createdAt: string;
  createdBy: string;
  /** 改訂理由（例: パイロットで単位の揺れが判明） */
  note: string | null;
}
