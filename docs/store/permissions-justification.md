# 権限の使用理由説明（Chrome ウェブストア審査フォーム用）

- **最終更新**: 2026-10-20（issue #381: `tabs` 権限の削除、`api.anthropic.com` と Azure OpenAI の追記、CSP・storage・externally_connectable の記述を実装に合わせて修正）。それ以前: 2026-07-18（issue #129: スコープを `userinfo.email` + `drive.file` へ変更・`launchWebAuthFlow` 移行を反映）
- **用途**: Chrome ウェブストアのアイテム登録時、各権限に求められる「使用理由（justification）」欄へそのまま貼り付けるための原稿。日本語と英語を併記します。
- **正典**: 権限の一覧は [src/manifest.json](../../src/manifest.json)、データフローは [privacy-policy.md](privacy-policy.md) を参照。

## 単一用途（Single purpose）

- **JA**: 本拡張の単一の用途は、システマティックレビュー（SR）の「データ抽出」工程の支援です。ユーザー自身の Google Drive 上の採用論文 PDF から、ユーザー自身の API キー（BYOK）で AI が研究データを事前抽出し、各値の根拠箇所（verbatim quote）を PDF ビューア上にハイライト表示します。人間がそれを承認・修正・棄却して最終確定し、結果と監査証跡をユーザー自身の Google Sheets に保存、CSV としてエクスポートします。すべての機能（PDF 取り込み、抽出スキーマ設計、AI 抽出、検証 UI、進捗ダッシュボード、CSV エクスポート）はこの単一のワークフローを構成する段階であり、これ以外の用途（ブラウジング支援、他サイトの改変等）はありません。
- **EN**: The single purpose of this extension is to support the data-extraction step of systematic reviews (SR). Using the user's own API key (BYOK), AI pre-extracts study data from the user's included-study PDFs stored in their own Google Drive, attaching a verbatim quote for each value, which is highlighted in a built-in PDF viewer. The user then accepts, edits, or rejects each value, and the results with a full audit trail are saved to the user's own Google Sheets and exported as CSV. Every feature (PDF import, extraction-schema design, AI extraction, verification UI, progress dashboard, CSV export) is a stage of this single workflow; the extension does nothing else (no browsing assistance, no modification of other sites).

## リモートコード使用の申告

「リモートコードを使用していますか」→ **いいえ**。全 script は拡張パッケージ内のローカルバンドルのみ（PDF.js worker も同梱・CDN 不使用）。CSP は `script-src 'self' 'wasm-unsafe-eval'; object-src 'self'`（[src/manifest.json](../../src/manifest.json) の `content_security_policy.extension_pages`。`'wasm-unsafe-eval'` は同梱の WebAssembly〔PDF.js の画像デコーダ〕の実行のため）。Google Picker の JS は `https://youkiti.github.io/sr-data-extraction-plugin/picker.html` という通常の Web ページ側で実行され、拡張パッケージ外（→ 下記 externally_connectable の説明）。

## permissions

### `identity` / `identity.email`

- **JA**: Google OAuth 2.0（`chrome.identity.launchWebAuthFlow`）でユーザーの Google アカウントにサインインし、プロジェクト DB である Google Sheets とファイル実体の Google Drive にアクセスするために使用します。`identity.email` は、初回サインイン時に Chrome プロファイルのアカウントを事前選択（login_hint）することと、サインイン中アカウントが Chrome プロファイルと異なる場合に注意書きを表示して複数アカウント誤用を防ぐことにのみ使用します。取得した情報を開発者サーバーへ送信することはありません（開発者サーバーは存在しません）。
- **EN**: Used to sign in to the user's Google account via Google OAuth 2.0 (`chrome.identity.launchWebAuthFlow`) so the extension can access the user's Google Sheets (used as the project database) and Google Drive (used to store files). `identity.email` is used only to pre-select the Chrome profile account at first sign-in (login_hint) and to show a notice when the signed-in account differs from the Chrome profile, preventing wrong-account use. No information is sent to any developer-operated server (there is none).

### `storage`

- **JA**: ユーザーの LLM API キー（BYOK）・サインイン中のメールアドレス・既定モデル・現在のプロジェクトなどの設定を `chrome.storage.local` に、Google の OAuth アクセストークンを `chrome.storage.session`（ブラウザを閉じると消える）に保存するために使用します。API キーは対応する LLM API への認証にだけ送信し、OAuth トークンは Google API の呼び出しと、ファイル選択時の Picker ページへの受け渡し（→ externally_connectable）にだけ使います。開発者のサーバーへは送信しません（開発者サーバーは存在しません）。
- **EN**: Used to store settings such as the user's LLM API key (BYOK), the signed-in email address, the default model and the current project in `chrome.storage.local`, and the Google OAuth access token in `chrome.storage.session` (cleared when the browser closes). An API key is sent only to the matching LLM API for authentication; the OAuth token is used only to call Google APIs and to hand it to the Picker page during file selection (see externally_connectable). Nothing is sent to a developer server (there is none).

## host_permissions

### ダッシュボードの 1 欄に貼る版（1000 字以内）

デベロッパー ダッシュボードの「ホスト権限の使用理由」は 1 欄で、1000 字までしか入らない（2026-10-21 に本人が確認）。下の各節を 1 つにまとめた版。日本語 761 字、英語 939 字（改行を除く。Python の `len` で数えた）。節の内容を変えたら、この版も直して数え直す。

- **JA**:

  > ホスト権限は、利用者自身の Google アカウントと API キー（BYOK）で、次の送信先とだけ通信するために使います。開発者のサーバーはありません。
  > ・sheets.googleapis.com / www.googleapis.com / oauth2.googleapis.com：プロジェクト DB である Google Sheets の読み書き、Google Drive への PDF・抽出テキスト・ログの保存と取得、サインイン中のアカウントのメールの取得、ログアウト時のトークンの失効。範囲は OAuth スコープ userinfo.email と drive.file（利用者が選んだファイルと拡張が作ったファイルだけ）に限られます。
  > ・generativelanguage.googleapis.com / openrouter.ai / api.anthropic.com：利用者が選んだ LLM プロバイダ（Gemini・OpenRouter・Anthropic）へ論文本文と抽出の指示を送り、AI によるデータ抽出を行います。Anthropic は、接続確認でのモデル一覧の取得にも使います。
  > ・任意のホスト権限（https://*/*、http://localhost/*、http://127.0.0.1/*、http://[::1]/*）：利用者が OpenAI 互換 API（ローカル LLM を含む）か Azure OpenAI の URL を設定したときだけ、chrome.permissions.request でその接続先を示して許可を求め、許可された接続先へだけ送ります。HTTP は loopback に限ります。
  > いずれも、任意の Web サイトの閲覧や改変には使いません。

- **EN**:

  > Used only to reach the hosts below with the user's own Google account and API keys (BYOK). There is no developer server.
  > - sheets.googleapis.com, www.googleapis.com, oauth2.googleapis.com: the user's Google Sheets (project database), PDFs/text/logs in Google Drive, the signed-in email, and token revocation at sign-out. Limited to the scopes userinfo.email and drive.file (files the user selects or the extension creates).
  > - generativelanguage.googleapis.com, openrouter.ai, api.anthropic.com: send article text and extraction prompts to the LLM provider the user chose; Anthropic also lists models in the connection check.
  > - Optional https://*/* and http://localhost, 127.0.0.1, [::1]: only when the user enters the URL of an OpenAI-compatible API (incl. a local LLM) or Azure OpenAI; the extension requests that host via chrome.permissions.request and sends data only there. HTTP is loopback only.
  > Never used to read or modify websites.

### `https://sheets.googleapis.com/*` / `https://www.googleapis.com/*` / `https://oauth2.googleapis.com/*`

- **JA**: プロジェクト DB である Google Sheets の読み書き、Google Drive へのファイル（PDF コピー・抽出テキスト・ログ）の保存・取得、およびサインイン中アカウントのメール取得（userinfo）に使用します。アクセス範囲は OAuth スコープ `userinfo.email` と `drive.file`（ユーザーが選択したファイル + 拡張が作成したファイルのみ。Sheets へのアクセスもこの範囲に限定）です。`oauth2.googleapis.com` はログアウト時のトークン失効（revoke）にのみ使用します。
- **EN**: Used to read/write the user's Google Sheets (project database), to store/retrieve files (PDF copies, extracted text, logs) in Google Drive, and to fetch the signed-in account's email (userinfo). Access is limited by the OAuth scopes `userinfo.email` and `drive.file` (only files the user selects and files the extension creates; Sheets access is also limited to this set). `oauth2.googleapis.com` is used only to revoke the token at sign-out.

### `https://generativelanguage.googleapis.com/*`

- **JA**: ユーザーが設定した Gemini API キー（BYOK）で、論文本文からのデータ抽出リクエストを送信するために使用します。
- **EN**: Used to send data-extraction requests to the Gemini API with the user's own API key (BYOK).

### `https://openrouter.ai/*`

- **JA**: LLM プロバイダとして OpenRouter を選んだユーザーが、自分の OpenRouter API キー（BYOK）で抽出リクエストを送信するために使用します。
- **EN**: Used to send extraction requests to OpenRouter with the user's own OpenRouter API key (BYOK), for users who choose OpenRouter as their LLM provider.

### `https://api.anthropic.com/*`

- **JA**: LLM プロバイダとして Anthropic を選んだユーザーが、自分の Anthropic API キー（BYOK）で抽出リクエストを送信することと、Options の接続確認でそのキーで使えるモデル一覧を取得することに使用します。
- **EN**: Used, for users who choose Anthropic as their LLM provider, to send extraction requests with their own Anthropic API key (BYOK) and to fetch the list of models available to that key during the connection check in Options.

### Optional host permissions for user-configured LLM APIs

- **対象**: `https://*/*`、`http://localhost/*`、`http://127.0.0.1/*`、`http://[::1]/*`
- **JA**: 利用者が OpenAI 互換 API（ローカル LLM を含む）または Azure OpenAI（テナントごとに URL が異なるため固定登録できない）の完全 URL を設定した場合に限り、その接続先へ論文本文と抽出プロンプトを送信するために使用します。拡張は設定保存時に `chrome.permissions.request` で入力 URL の scheme + hostname pattern だけを提示し、利用者が許可した接続先だけへ通信します。Chrome の host permission はポート単位に限定できないため、権限 pattern はポートを含みませんが、API リクエストは利用者が入力したポートとパスだけへ送信します。HTTP は loopback hostname との完全一致だけを許可し、LAN 内 IP を含む外部ホストの HTTP は拒否します。任意の Web サイトを閲覧または変更する用途には使用しません。
- **EN**: Used only when the user configures a complete URL for an OpenAI-compatible API (including a local LLM) or for Azure OpenAI (whose endpoint differs per tenant and so cannot be listed in advance). At save time, the extension calls `chrome.permissions.request` for the URL's scheme-and-hostname pattern and sends article text and extraction prompts only to a destination explicitly permitted by the user. Chrome host permissions are not restricted to one port, so the permission pattern omits the port while API requests preserve the exact port and path entered by the user. Plain HTTP is accepted only for exact loopback hostnames; HTTP destinations on LAN or remote hosts are rejected. The permission is not used to read or modify arbitrary websites.

## externally_connectable — `https://youkiti.github.io/*`

- **JA**: Manifest V3 のリモートコード制約により、Google Picker（ファイル選択 UI）を拡張内から直接ロードできません。GitHub Pages 上にホストした `https://youkiti.github.io/sr-data-extraction-plugin/picker.html` を新しいタブで開き、`externally_connectable` で当該ページと拡張がメッセージをやり取りするために使用します。Picker の呼び出しには `drive.file` スコープの OAuth アクセストークンが要るため、拡張はページからの要求に対し、送信元のオリジン（ページの URL）・拡張が開いたタブの ID・起動ごとの nonce の 3 点を確かめたうえで、`sendResponse` でトークンを渡します。トークンは URL に載せません。ページはトークンを Picker の呼び出しにだけ使い、保存も送信もせず、選ばれたファイルの ID と名前だけを拡張へ返します。
- **EN**: Due to Manifest V3 remote-code restrictions, the Google Picker (file chooser) cannot be loaded directly inside the extension. The extension opens `https://youkiti.github.io/sr-data-extraction-plugin/picker.html`, hosted on GitHub Pages, in a new tab, and `externally_connectable` lets that page and the extension exchange messages. Because Picker needs an OAuth access token for the `drive.file` scope, the extension answers the page's request with the token via `sendResponse` only after checking three things: the sender's origin (the page URL), the ID of the tab the extension opened, and a per-launch nonce. The token is never put in a URL. The page uses the token only to call Picker, neither stores nor sends it, and returns only the IDs and names of the chosen files.

## OAuth スコープ（審査の Google 用データアクセス欄）

| スコープ | 用途 |
|---|---|
| `.../auth/userinfo.email` | サインイン中アカウントのメール取得（監査証跡の記録者表示・アカウント指定のみ） |
| `.../auth/drive.file` | ユーザーが選択したファイル + 拡張が作成したファイルのみへのアクセス（プロジェクト DB の Sheets 読み書きを含む。Drive 全体は読まない） |

いずれのスコープで取得したデータも、機能提供以外の目的（広告・分析・第三者提供・モデル学習）には使用しません。Google API Services User Data Policy（Limited Use を含む）を遵守します。

## プライバシーへの取り組み（Privacy practices タブ）の申告の控え

Chrome ウェブストアのデベロッパー ダッシュボードの「プライバシーへの取り組み」で申告する内容の控え。実際の扱い（[privacy-policy.md](privacy-policy.md)）から決めた。**ダッシュボードへの反映は本人（開発者アカウントの持ち主）の作業**で、このファイルを直しただけでは反映されない。

### 収集・使用するデータの種別

| 種別（ダッシュボードの項目） | 該当 | 中身 |
|---|---|---|
| 個人を特定できる情報（Personally identifiable information） | はい | サインイン中の利用者のメールアドレス、利用者が入力した共同研究者のメールアドレス |
| 認証情報（Authentication information） | はい | LLM API キー、Google OAuth アクセストークン |
| ウェブサイトのコンテンツ（Website content） | はい | 取り込んだ PDF の本文テキストとページ画像（選んだ LLM API へ送る） |
| 上記以外（健康情報・金融情報・個人的なコミュニケーション・位置情報・ウェブ履歴・ユーザーのアクティビティ） | いいえ | — |

いずれも利用者のブラウザ・利用者の Google アカウント・利用者が選んだ LLM API の間でだけ扱い、開発者は受け取らない。

### 3 つの認定（すべてにチェックする）

- 承認されている使用例以外の目的で、ユーザーデータを第三者に販売、転送しない
- アイテムの単一用途と関係のない目的で、ユーザーデータを使用、転送しない
- 信用力の判断や融資目的で、ユーザーデータを使用、転送しない

### プライバシーポリシーの URL

<https://youkiti.github.io/sr-data-extraction-plugin/privacy-policy.html>
