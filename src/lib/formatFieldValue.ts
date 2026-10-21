import type { SchemaField } from '../domain/schemaField';
import { formatMultiSelectForDisplay } from '../domain/multiSelect';
import { t } from './i18n';

/** 保存値を変更せず、boolean と複数選択の値を表示用に整える。 */
export function formatFieldValue(field: SchemaField, value: string | null): string | null {
  if (field.dataType === 'boolean') {
    const normalized = value?.trim().toUpperCase();
    if (normalized === 'TRUE') return t('value.booleanYes');
    if (normalized === 'FALSE') return t('value.booleanNo');
  }
  return formatMultiSelectForDisplay(field, value);
}
