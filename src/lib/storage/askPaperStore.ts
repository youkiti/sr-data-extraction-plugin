// 質問済み study の識別子だけをアカウント・プロジェクト別に保存する。会話本文は保存しない。
import { getLocal, setLocal } from './chromeStorage';

export function askPaperUsedStudiesStorageKey(spreadsheetId: string, email: string): string {
  return `sr-data-extraction:ask-paper-used-studies:${spreadsheetId}:${email}`;
}

export async function loadAskPaperUsedStudies(
  spreadsheetId: string,
  email: string,
): Promise<string[]> {
  return (await getLocal<string[]>(askPaperUsedStudiesStorageKey(spreadsheetId, email))) ?? [];
}

export async function saveAskPaperUsedStudies(
  spreadsheetId: string,
  email: string,
  studyIds: string[],
): Promise<void> {
  await setLocal(askPaperUsedStudiesStorageKey(spreadsheetId, email), studyIds);
}
