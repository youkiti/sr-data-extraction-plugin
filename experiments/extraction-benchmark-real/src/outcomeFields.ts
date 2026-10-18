// アウトカム項目の指示文を非公開のローカル設定から組み立てる。
import { loadLocalConfig } from './localConfig';

const { free, continuous, events } = loadLocalConfig().outcome;

export function outcomeFields(condition: 'F' | 'L') {
  return (Object.keys(free) as Array<keyof typeof free>).map((id) => ({
    field_id: id,
    field_name: id,
    entity_level: 'outcome_result' as const,
    data_type: id === 'or_mean' || id === 'or_sd' ? 'float' as const : 'integer' as const,
    extraction_instruction: free[id] + (condition === 'F' ? '' : ` ${id === 'or_events' ? events : continuous}`),
  }));
}
