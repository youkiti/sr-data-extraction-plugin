import type { GuideCondition } from '../../../lib/guide/tours';
import type { VerifyBasicsCondition, VerifyBasicsEvent } from '../../../lib/guide/tours/verifyBasics';
import type { AppState } from '../../store';

export const VERIFY_BASICS_ADAPTER = {
  conditions(state: AppState): Record<VerifyBasicsCondition, boolean> {
    const { role, counts, verify } = state;
    const resolved = !role.resolving && role.error === null;
    const allowedRole = role.role === 'owner' || role.role === 'reviewer_with_ai';
    const canEnter = role.role === 'owner'
      ? counts.schemaVersions > 0 && counts.documents > 0
      : role.folderAccessGranted;
    // レビュアーは進捗件数を読まないため、読み込み済みの検証対象で根拠の有無を確かめる。
    const hasResults = verify.targets === null
      ? role.role === 'owner' && counts.evidenceRows > 0
      : verify.targets.some(target => target.evidence.length > 0);
    return {
      'verify-basics-unavailable': !(state.currentProject !== null && resolved && allowedRole && canEnter && hasResults),
    };
  },
  risingEvents: {} satisfies Partial<Record<GuideCondition, VerifyBasicsEvent>>,
};
