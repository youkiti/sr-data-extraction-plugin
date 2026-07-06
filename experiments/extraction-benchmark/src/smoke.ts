// 疎通確認（IMPLEMENTATION.md §10）。API を叩く前に本番コードの import・型・スキーマ整合を潰す。
// npx tsx src/smoke.ts が全部通ってから runner を回す。確認後は消してよい（package.json の smoke スクリプトは残す）。
import {
  buildExtractDataUserPrompt,
  EXTRACT_DATA_RESPONSE_SCHEMA,
} from '../../../src/features/extraction/skills/extractData';
import { createProvider } from '../../../src/lib/llm/providerFactory';
import { normalizeText } from '../../../src/features/anchoring/normalizeText';
import { anchorQuote } from '../../../src/features/anchoring/anchorQuote';
import { loadBenchmarkSchema } from './loadSchema';

const fields = await loadBenchmarkSchema();
console.log('fields:', fields.length); // 20 が出れば schema OK
const pages = [{ page: 1, text: 'The trial randomized 100 neonates.' }];
const prompt = buildExtractDataUserPrompt({ fields, pages }); // 例外なく文字列が返れば import OK
console.log('prompt chars:', prompt.length);
console.log('normalize:', normalizeText('ｆｕｌｌ　ｗｉｄｔｈ')); // 半角化されれば anchoring OK
console.log(
  'anchor:',
  anchorQuote(normalizeText('100 neonates'), [{ page: 1, text: normalizeText(pages[0]!.text) }], 1).status,
); // exact が出れば anchoring OK
console.log('schema keys:', Object.keys(EXTRACT_DATA_RESPONSE_SCHEMA));
// createProvider は new するだけ（chat は呼ばない = API 課金なし）
console.log('provider gemini:', createProvider({ apiKey: 'dummy', model: 'gemini-3.5-flash' }).providerId);
console.log(
  'provider openrouter:',
  createProvider({ apiKey: 'dummy', model: 'qwen/qwen3-235b-a22b-2507' }).providerId,
);
