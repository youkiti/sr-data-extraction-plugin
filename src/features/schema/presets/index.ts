// スキーマエディタのプリセット挿入の一覧（S5。requirements.md §3.3）。
// アウトカム系（outcomeTemplates）と RoB 系（robTemplates）を UI のボタンと 1:1 の
// 単一マップへ束ねる。挿入ロジック（schemaService.insertSchemaPreset）はこのマップだけを見る
import type { SchemaEditorRow } from '../types';
import { OUTCOME_TEMPLATES, type OutcomePresetKind } from './outcomeTemplates';
import { ROB_TEMPLATES, type RobPresetKind } from './robTemplates';

export type SchemaPresetKind = OutcomePresetKind | RobPresetKind;

export const SCHEMA_PRESETS: Record<SchemaPresetKind, readonly SchemaEditorRow[]> = {
  ...OUTCOME_TEMPLATES,
  ...ROB_TEMPLATES,
};
