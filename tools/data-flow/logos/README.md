# データの流れの図に使うロゴ

`tools/data-flow/generate.mjs` が読む。各ロゴは各社の商標で、図ではそのサービスを指し示すためだけに使う（図の脚注に明記）。

| ファイル | 入手元（npm） | 元のアイコン名 |
|---|---|---|
| `google-drive.svg` | `@iconify-json/logos@1.2.19`（gilbarbara/logos、CC0-1.0） | `google-drive` |
| `chrome.svg` | 同上 | `chrome` |
| `gemini.svg` | 同上 | `google-gemini-icon` |
| `anthropic.svg` | 同上 | `anthropic-icon` |
| `openrouter.svg` | 同上 | `openrouter-icon` |
| `azure.svg` | 同上 | `microsoft-azure` |
| `openai.svg` | 同上 | `openai-icon` |
| `github.svg` | 同上 | `github-icon` |
| `ollama.svg` | 同上（ローカル LLM の代表として使う） | `ollama` |
| `google-sheets.svg` | `simple-icons@16.37.0`（CC0-1.0）。単色の字形に Google Sheets の緑 `#0F9D58` を付けた | `googlesheets` |

差し替えるときは、同じパッケージの新しい版から同じ名前で取り出し、この表の版を更新する。
