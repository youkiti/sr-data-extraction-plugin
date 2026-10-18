import type { Evidence } from '../../domain/evidence';
import type { ArmCompletenessRunWarning } from '../../domain/extractionRun';
import type { CompletedRunMeta } from '../extraction/runRepository';

/** study × field_id 単位で選定した「表示する run」の集約結果（composeEvidenceByStudy の戻り値） */
export interface ComposedEvidenceByStudy {
  /**
   * fields リスト解決に使う schema_version。「その study を含む最新の完了 run」の版を採用する
   * （サブセット run でも最新ならその版。従来の latestRunEvidenceByStudy と同じ判定基準）
   */
  schemaVersion: number;
  /** 上記の版を決めた run_id（表示・デバッグ用） */
  runId: string;
  /** field_id ごとに選定した run の Evidence を合成したもの */
  evidence: Evidence[];
  /**
   * 上記の最新完了 run の warnings のうち当該 study ぶん（issue #106:
   * arm completeness。S8 の `#verify-arm-completeness-warning` の素材）
   */
  armWarnings: ArmCompletenessRunWarning[];
}

/**
 * candidateRunIds のうち targets(meta) を満たす run の中で最も新しい（runOrder が大きい）
 * run_id を返す。該当が無ければ空文字（composeEvidenceByStudy の呼び出し方では、
 * fieldId は必ずいずれかの候補 run の Evidence 由来のため実質到達しない）
 */
function pickLatestRunId(
  candidateRunIds: ReadonlySet<string>,
  runOrder: ReadonlyMap<string, number>,
  runById: ReadonlyMap<string, CompletedRunMeta>,
  targets: (meta: CompletedRunMeta) => boolean,
): string {
  let winner = '';
  let winnerOrder = -1;
  for (const runId of candidateRunIds) {
    // candidateRunIds は runById 由来の run_id のみで構成される（呼び出し側で保証）
    const meta = runById.get(runId) as CompletedRunMeta;
    if (!targets(meta)) {
      continue;
    }
    const order = runOrder.get(runId) as number; // runById と同じ completedRuns から作るため必ず解決できる
    if (order > winnerOrder) {
      winnerOrder = order;
      winner = runId;
    }
  }
  return winner;
}

/**
 * study × field_id 単位で「表示する run」を選び、その run の Evidence だけを合成する
 * （issue #80 案 A: run 単位のフィールド選択に対応した合成ビュー）。
 *
 * 規約:
 * - 完了 run（readCompletedRunMetas の戻り値）のみを対象にする。ExtractionRuns に無い
 *   run_id の Evidence（孤児。旧プロトコル以前の実行）の除外は従来どおり。一方、running 行
 *   しかない中断 run の flush 済み Evidence は、従来（latestRunEvidenceByStudy + 全 run 対象の
 *   readRunSchemaVersions）は S8/S9 に表示されていたが、issue #80 で意図的に除外へ厳格化した
 *   （S7 のカバレッジ判定「中断 run の study は未抽出に戻る」と表示を一致させる。
 *   再抽出が完了するまで S8/S9 には出ない）
 * - study の schema_version は「その study を含む最新の完了 run」の版を採用する
 *   （サブセット run でも最新ならその版。fields リスト解決に使う）
 * - field_id ごとに「fieldIds が null（= 全項目）または当該 field_id を含む、その study の
 *   最新の完了 run」を選び、その run の当該 field の Evidence だけを採用する。
 *   選定した run に当該 field の Evidence が 0 件でも、より古い run へはフォールバックしない
 *   （「最新の対象 run が正」という規約。過去 run の値が透けて見える事故を防ぐ）
 * - run の新旧は started_at の昇順で比較する。null は最古として扱い、null 同士・同値は
 *   安定ソートにより completedRuns の並び順（= シート行順）を保つ
 */
export function composeEvidenceByStudy(
  evidence: readonly Evidence[],
  completedRuns: readonly CompletedRunMeta[],
): Map<string, ComposedEvidenceByStudy> {
  const sorted = [...completedRuns].sort((a, b) => {
    const ak = a.startedAt ?? '';
    const bk = b.startedAt ?? '';
    if (ak < bk) {
      return -1;
    }
    if (ak > bk) {
      return 1;
    }
    return 0; // 同値・null 同士は安定ソートによりシート行順を保つ
  });
  const runOrder = new Map<string, number>();
  sorted.forEach((meta, i) => runOrder.set(meta.runId, i));
  const runById = new Map(completedRuns.map((meta) => [meta.runId, meta]));

  // 既知（完了 run に紐づく）Evidence のみを study ごとに集約する（孤児 Evidence は除外）
  const knownByStudy = new Map<string, Evidence[]>();
  for (const item of evidence) {
    if (!runById.has(item.runId)) {
      continue;
    }
    const list = knownByStudy.get(item.studyId) ?? [];
    list.push(item);
    knownByStudy.set(item.studyId, list);
  }

  const result = new Map<string, ComposedEvidenceByStudy>();
  for (const [studyId, items] of knownByStudy) {
    const candidateRunIds = new Set(items.map((item) => item.runId));

    // schemaVersion 解決用: study を含む最新の完了 run（サブセットでも最新なら採用）
    const latestRunId = pickLatestRunId(candidateRunIds, runOrder, runById, () => true);
    const latestMeta = runById.get(latestRunId) as CompletedRunMeta;

    // field_id ごとの勝者 run をメモ化しながら決定する
    const winnerByField = new Map<string, string>();
    const resolveWinner = (fieldId: string): string => {
      const cached = winnerByField.get(fieldId);
      if (cached !== undefined) {
        return cached;
      }
      const winner = pickLatestRunId(
        candidateRunIds,
        runOrder,
        runById,
        (meta) => meta.fieldIds === null || meta.fieldIds.includes(fieldId),
      );
      winnerByField.set(fieldId, winner);
      return winner;
    };

    result.set(studyId, {
      schemaVersion: latestMeta.schemaVersion,
      runId: latestRunId,
      evidence: items.filter((item) => item.runId === resolveWinner(item.fieldId)),
      // 最新完了 run の arm completeness 警告から当該 study ぶんを抜き出す（issue #106）。
      // warnings は union（issue #247 で evidence_row_count を追加）のため、
      // kind で絞ってから studyId を持つ arm_completeness のみを対象にする
      armWarnings: (latestMeta.warnings ?? []).filter(
        (warning): warning is ArmCompletenessRunWarning =>
          warning.kind === 'arm_completeness' && warning.studyId === studyId,
      ),
    });
  }

  return result;
}

