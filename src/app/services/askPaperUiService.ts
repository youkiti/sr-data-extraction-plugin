// 質問パネルの送信状態と study 別の会話をセッション内で管理する。
// 文脈は本文とスキーマ定義のみ。会話 payload はストレージへ保存しない。
import { canAskPaper } from '../../features/verification/chatAssist';
import type { ProfileDeps } from '../../lib/google/identity';
import type { EnsureAiDataConsent } from '../../lib/llm/aiDataConsent';
import { resolveProviderConfig } from '../../lib/llm/providerFactory';
import { FACTORY_DEFAULT_MODEL, loadDefaultModel } from '../../lib/storage/settingsStore';
import type { Store } from '../store';
import { clearAskPaperQuestionDraft } from '../views/askPaperPanel';
import { rememberAskPaperStudy } from './askPaperMetadataService';
import { askPaper, type AskPaperDeps, type AskPaperParams } from './askPaperService';

export type AskPaperQuestionParams = Omit<AskPaperParams, 'spreadsheetId' | 'history'> & {
  studyId: string;
};

let sendingLocked = false;

export async function sendAskPaperQuestion(
  store: Store,
  deps: AskPaperDeps & { profile?: ProfileDeps },
  params: AskPaperQuestionParams,
): Promise<void> {
  const state = store.getState();
  if (
    !state.currentProject ||
    !canAskPaper(state.role.role) ||
    state.askPaper.sending ||
    sendingLocked ||
    !params.question.trim()
  )
    return;
  sendingLocked = true;
  try {
    const ensureConsent = deps.ensureAiDataConsent;
    if (ensureConsent && !(await confirmAskPaperConsent(deps, ensureConsent))) {
      return;
    }
    // API エラーでも質問に着手した事実を開示するため、同意後に印を付ける。
    const beforeSend = store.getState().askPaper;
    store.setState({
      askPaper: {
        ...beforeSend,
        sending: true,
        error: null,
        usedStudyIds: [...new Set([...beforeSend.usedStudyIds, params.studyId])],
      },
    });
    await rememberAskPaperStudy(store, deps, params.studyId);
    const model = (await (deps.loadDefaultModel ?? loadDefaultModel)()) ?? FACTORY_DEFAULT_MODEL;
    store.setState({ askPaper: { ...store.getState().askPaper, model } });
    const result = await askPaper(
      {
        ...params,
        spreadsheetId: state.currentProject.spreadsheetId,
        history: state.askPaper.conversations[params.studyId] ?? [],
      },
      { ...deps, loadDefaultModel: async () => model },
    );
    if (result.status === 'answered') {
      clearAskPaperQuestionDraft(
        state.currentProject.spreadsheetId,
        params.studyId,
        params.question,
      );
    }
    const latest = store.getState().askPaper;
    store.setState({
      askPaper:
        result.status === 'answered'
          ? {
              ...latest,
              sending: false,
              conversations: {
                ...latest.conversations,
                [params.studyId]: [...(latest.conversations[params.studyId] ?? []), result.turn],
              },
            }
          : { ...latest, sending: false, error: result.message },
    });
  } catch (error) {
    store.setState({
      askPaper: {
        ...store.getState().askPaper,
        sending: false,
        error: error instanceof Error ? error.message : String(error),
      },
    });
  } finally {
    sendingLocked = false;
  }
}

/**
 * 質問の送信前に同意を確かめる。API キー未設定・接続方式の食い違いは
 * 同意を求めずに通し、askPaper のエラー表示に任せる（他の AI 機能と同じく検証が先）
 */
async function confirmAskPaperConsent(
  deps: AskPaperDeps,
  ensureConsent: EnsureAiDataConsent,
): Promise<boolean> {
  const model = (await (deps.loadDefaultModel ?? loadDefaultModel)()) ?? FACTORY_DEFAULT_MODEL;
  const resolution = await resolveProviderConfig(model, deps);
  if (resolution.modelMismatch !== null || resolution.config === null) return true;
  return await ensureConsent(resolution.provider);
}
