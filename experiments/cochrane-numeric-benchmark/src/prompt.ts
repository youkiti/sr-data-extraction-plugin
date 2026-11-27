import { buildExtractDataSystemPrompt, buildExtractDataUserContent, extractDataResponseSchema } from '../../../src/features/extraction/skills/extractData';
import { EXTRACT_DATA_TEMPERATURE } from '../../../src/features/extraction/executeRun';
import type { ChatMessage, ChatOptions } from '../../../src/lib/llm/LLMProvider';
import type { Study, UsableDocument } from './evaluationSet';
import { schemaInput } from './schema';

export { EXTRACT_DATA_TEMPERATURE };
export function buildStudyRequest(study: Study, docs: UsableDocument[]) {
  const input = schemaInput(study);
  const documents = docs.map((doc) => ({ role: 'article' as const, filename: `${doc.pmcid}.pdf`, mode: 'text' as const, pages: doc.pages }));
  const messages: ChatMessage[] = [
    { role: 'system', content: buildExtractDataSystemPrompt(false, false) },
    { role: 'user', content: buildExtractDataUserContent({ ...input, documents }) },
  ];
  const chatOptions: ChatOptions = { temperature: EXTRACT_DATA_TEMPERATURE, responseSchema: extractDataResponseSchema(false) };
  return { fields: input.fields, messages, chatOptions, documentCount: documents.length };
}
export function promptCharacters(messages: ChatMessage[]): number {
  return messages.reduce((n, message) => n + (typeof message.content === 'string' ? message.content.length :
    message.content.reduce((sum, part) => sum + (part.type === 'text' ? part.text.length : 0), 0)), 0);
}
