// issue #226 の関連症状の現状確認: Options の「接続テスト」と同じ要求（src/options/bootstrap.ts。
// maxOutputTokens: 64・temperature: 0・{ok:boolean} の構造化出力）を本番の GeminiProvider で各モデルへ 1 回ずつ送り、
// 通るか・どの理由で落ちるかを見る。★外部 API をモデル数ぶんだけ呼ぶ。キーはログに出さない。
import path from 'node:path';
import dotenv from 'dotenv';
import { createProvider } from '../../../src/lib/llm/providerFactory';
import { LlmProviderError } from '../../../src/lib/llm/LLMProvider';
import { benchRoot, repoRoot } from './config';

dotenv.config({ path: [path.join(benchRoot, '.env'), path.join(repoRoot, '.env')], quiet: true });

const MODELS = (process.env.CONN_PROBE_MODELS ?? 'gemini-3.5-flash,gemini-3.6-flash,gemini-3.8-flash').split(',');
// CONN_PROBE_MAX: 出力トークン上限。未指定 = 64（修正前の本番値）、none = 上限を渡さない
const MAX_OUT = process.env.CONN_PROBE_MAX === 'none' ? null : Number(process.env.CONN_PROBE_MAX ?? '64');
const SCHEMA ={ type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false };

async function main(): Promise<void> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new Error('GEMINI_API_KEY がありません');
  for (const model of MODELS) {
    const provider = createProvider({
      apiKey,
      model,
      fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(60_000) }),
    });
    try {
      const response = await provider.chat(
        [
          { role: 'system', content: 'Return JSON matching the supplied schema.' },
          { role: 'user', content: 'Return {"ok":true}.' },
        ],
        { responseSchema: SCHEMA, ...(MAX_OUT === null ? {} : { maxOutputTokens: MAX_OUT }), temperature: 0 },
      );
      console.log(
        `${model}\t成功\ttext=${response.text.trim()}\ttokensOut=${response.tokensOut}\tthoughts=${response.thoughtsTokensOut}`,
      );
    } catch (error) {
      // instanceof は tsx 経由だと成立しないことがあるため、名前で判定する
      if (error instanceof Error && error.name === 'LlmProviderError') {
        const e = error as LlmProviderError;
        const usage = e.usage;
        console.log(
          `${model}\t失敗\t${e.message}\tHTTP=${e.status}\ttokensOut=${usage?.tokensOut ?? '-'}\tthoughts=${usage?.thoughtsTokensOut ?? '-'}\tbody=${String(e.responseBody ?? '').slice(0, 300).split(apiKey).join('[KEY]')}`,
        );
      } else {
        // fetch の例外メッセージに URL（キー入り）が載ることがあるため、キーを伏せて出す
        console.log(`${model}\t結果不明\t${String(error).split(apiKey).join('[KEY]')}`);
      }
    }
  }
}

await main();
