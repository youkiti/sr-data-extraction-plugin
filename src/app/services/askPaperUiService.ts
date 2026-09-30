// 質問パネルの送信状態と study 別の会話をセッション内で管理する。
// 文脈は本文とスキーマ定義のみ。会話 payload はストレージへ保存しない。
import { canAskPaper } from '../../features/verification/chatAssist';
import { FACTORY_DEFAULT_MODEL, loadDefaultModel } from '../../lib/storage/settingsStore';
import type { Store } from '../store';
import { clearAskPaperQuestionDraft } from '../views/askPaperPanel';
import { askPaper, type AskPaperDeps, type AskPaperParams } from './askPaperService';

export type AskPaperQuestionParams = Omit<AskPaperParams, 'spreadsheetId' | 'history'> & {
  studyId: string;
};

export async function sendAskPaperQuestion(
  store: Store,
  deps: AskPaperDeps,
  params: AskPaperQuestionParams,
): Promise<void> {
  const state = store.getState();
  if (
    !state.currentProject ||
    !canAskPaper(state.role.role) ||
    state.askPaper.sending ||
    !params.question.trim()
  )
    return;
  // API エラーでも質問に着手した事実を開示するため、送信開始時から印を付ける。
  store.setState({
    askPaper: {
      ...state.askPaper,
      sending: true,
      error: null,
      usedStudyIds: [...new Set([...state.askPaper.usedStudyIds, params.studyId])],
    },
  });
  try {
    const model =
      state.askPaper.model ??
      (await (deps.loadDefaultModel ?? loadDefaultModel)()) ??
      FACTORY_DEFAULT_MODEL;
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
      clearAskPaperQuestionDraft(state.currentProject.spreadsheetId, params.studyId);
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
  }
}
