// ArmStructures タブに対応する型（requirements.md §3.2 v0.7）。群構成の確定・追記型。
// 検証画面（S8）冒頭で人間が確定した arm 数・名称を 1 行 = 1 arm で保持し、
// 確定・改訂のたびに全 arm 行を新 version で追記する（監査証跡を兼ねる）
import type { AnnotatorType } from './annotation';

/** ArmStructures の 1 行（1 arm） */
export interface ArmStructureRow {
  studyId: string;
  /** study × annotator ごとに 1 から採番。確定・改訂のたびに +1 */
  version: number;
  /** `arm:1` 形式。ResultsData / Evidence の entity_key との join キー */
  armKey: string;
  /** 人間が確定した群の名称 */
  armName: string;
  /** 確定操作を行った annotator（MVP では確定者本人の human_with_ai） */
  annotator: string;
  annotatorType: AnnotatorType;
  confirmedAt: string;
  note: string | null;
}

/** 確定済み群構成（最新 version の畳み込み結果。UI が消費する形） */
export interface ConfirmedArmStructure {
  version: number;
  arms: readonly { armKey: string; armName: string }[];
}
