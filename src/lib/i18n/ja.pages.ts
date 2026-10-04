// UI 文言辞書（日本語・ページ共通群）。
export const jaPages = {
  // 共通（画面横断で完全に同一の意味を持つものだけ）
  'common.cancel': 'キャンセル',
  'common.reload': '再読み込み',
  'common.reloadList': '一覧を再読み込み',
  'common.retry': '再試行',
  'common.loading': '読み込み中…',
  'common.noProject': '先にプロジェクトを選択してください（Popup から作成 / 選択できます）。',

  // Options の表示言語節（settingsSections.ts + options/bootstrap.ts。issue #93）
  'options.documentTitle': 'SR Data Extraction Plugin — 設定',
  'options.heading': '設定',
  'options.openApp': 'アプリを開く',
  'options.languageTitle': '表示言語',
  'options.languageHelp': 'UI の表示言語です。切り替えるとすぐに画面へ反映されます。',
  'options.languageLabel': '言語',
  'options.languageSaveFailed': '表示言語の保存に失敗しました。',

  // Options の公開ページリンク節（settingsSections.ts。issue #214）
  'options.linksTitle': 'ヘルプ・ポリシー',
  'options.linksHelp': 'いずれも新しいタブで開きます。',
  'options.linkHelp': '使い方ガイド',
  'options.linkPrivacy': 'プライバシーポリシー',
  'options.linkTerms': '利用規約',

  // Popup S1（popup.html + popup/bootstrap.ts）
  'popup.loading': '読み込み中…',
  'popup.authLead':
    'プロジェクトは Google Sheets / Drive に保存されます。Google アカウントでログインしてください。',
  'popup.login': 'Google でログイン',
  'popup.loginFailed':
    'ログインに失敗しました。ブラウザに Google アカウントが追加されているか確認してください。',
  'popup.loggedInAs': 'ログイン中:',
  'popup.logout': 'ログアウト',
  'popup.recentTitle': '最近のスプレッドシート',
  'popup.recentSelectLabel': '最近のスプレッドシート',
  'popup.recentOpen': '開く',
  'popup.recentOpening': '開いています…',
  'popup.createTitle': '新規プロジェクト',
  'popup.createLead':
    'データ抽出プロジェクトを作成します（スプレッドシート + Drive フォルダを生成）。',
  'popup.createTitleLabel': 'プロジェクトタイトル',
  'popup.createSubmit': '作成',
  'popup.creating': '作成中…',
  'popup.tiabTitle': 'tiab-review から引き継いで作成',
  'popup.tiabLead':
    'tiab-review のスプレッドシートを選ぶと、プロジェクトを自動作成し、採用文献（include）の PDF 取り込みまで案内します。',
  'popup.tiabPick': 'tiab-review のシートを選ぶ',
  'popup.tiabPicking': 'Picker でシートを選んでください…',
  'popup.tiabChecking': '選択したシートを確認しています…',
  'popup.tiabDetected': 'include {n} 件を検出しました。プロジェクト名を確認して作成してください。',
  'popup.tiabNoIncludes':
    'include の文献が見つかりませんでした。tiab-review 側の判定状況を確認してください。',
  'popup.tiabCreateSubmit': '作成して続行',
  'popup.openTitle': 'スプレッドシート ID / URL で開く',
  'popup.openIdLabel': 'スプレッドシート ID または URL',
  'popup.openIdPlaceholder': 'スプレッドシート ID または URL を貼り付け',
  'popup.openSubmit': '開く',
  'popup.openOptions': '設定を開く',
  'popup.openHelp': '使い方',
  'popup.statusLoginRequired': 'ログインが必要です。',
  'popup.statusPickRecent': '最近のスプレッドシートから選ぶか、新しく作成してください。',
  'popup.statusCreateOrOpen':
    '新しいプロジェクトを作成するか、スプレッドシート ID から開いてください。',
  'popup.emailUnknown': '(不明)',
  'popup.accountMismatch':
    'Chrome プロファイル（{profileEmail}）とは別のアカウントでログインしています。抽出・判定はこのログイン中アカウントで記録されます。',

  // モデルセレクタ（ui/modelSelect.ts）
  'modelSelect.other': 'その他（直接入力）',
  'modelSelect.customAria': '{label}（直接入力）',
  'modelSelect.customPlaceholder': '例: org/model-name',

  // サービス層のトースト・状態エラー（S1〜S9 ぶん）
  'common.pickerFailed': 'Drive Picker を開けませんでした: {reason}',
  'common.toastCopyFailed': 'コピーに失敗しました: {reason}',
  'popup.errTitleRequired': 'プロジェクトタイトルは必須です',
  'popup.errIdRequired': 'スプレッドシート ID は必須です',
  // 既存 ID で開く: アクセス許可が必要（issue #130。docs/ui-states.md §1）
  'popup.accessNeeded':
    'このスプレッドシートを開く権限がまだありません。共有されたシートの場合は「Google で許可する」からシートを選択してください（見つからない・削除済み・ID 誤りの場合もこの表示になります）',
  'popup.openGrant': 'Google で許可する',
  'popup.grantWaiting': '許可を待っています…',
  'popup.grantMismatch':
    '選択されたシートは入力された ID と異なります。共有されたシート本体を選択してください',
  'popup.grantStillDenied':
    '許可後もアクセスできませんでした。シートが削除されたか、ID が誤っている可能性があります',

  // Options（settingsSections.ts + options/bootstrap.ts + rateLimitPolicy の tier ラベル）
  'options.geminiTitle': 'Gemini API キー（BYOK）',
  'options.geminiHelp':
    'API キーはこの端末の chrome.storage にのみ保存され、開発者へ送信されることはありません。',
  'options.geminiLabel': 'Gemini API キー',
  'options.save': '保存',
  'options.openrouterTitle': 'OpenRouter API キー（BYOK）',
  'options.openrouterHelpPrefix': 'OpenRouter 経由のモデル（qwen / deepseek 等）を使う場合に設定します。キーは ',
  'options.openrouterHelpSuffix': ' で取得できます。この端末の chrome.storage にのみ保存されます。',
  'options.openrouterLabel': 'OpenRouter API キー',
  'options.connectionTitle': 'LLM 接続先',
  'options.connectionHelp':
    '保存した接続方式はモデル名より優先されます。HTTP は localhost、127.0.0.1、[::1] だけ許可します。別マシン上の API は HTTPS 化してください。',
  'options.providerAria': 'LLM 接続方式',
  'options.providerOpenAiCompatible': 'OpenAI 互換 API',
  'options.compatibleNotice':
    '論文本文と抽出プロンプトは、ここで指定した接続先へブラウザから直接送信されます。',
  'options.endpointLabel': 'API エンドポイント',
  'options.apiKeyLabel': 'API キー',
  'options.loopbackNote': 'localhost、127.0.0.1、[::1] への接続では省略できます。',
  'options.azureEndpointHelp':
    'デプロイメント + API バージョンを含む完全な URL を入力してください（例: https://{resource}.openai.azure.com/openai/deployments/{deployment}/chat/completions?api-version=2026-xx-xx）。',
  'options.azureModelHelp':
    '既定モデル欄には Azure OpenAI の「デプロイメント名」を入力してください（URL のデプロイメントで呼び出されるため、リクエスト本文の model 値は無視されます）。',
  'options.providerLabel': '接続方式',
  'options.saveConnection': '接続設定を保存',
  'options.testConnection': '接続テスト',
  // モデル一覧の自動取得（issue #127 PR4。docs/ui-states.md §2「モデル一覧を取得」ボタン）
  'options.fetchModelList': 'モデル一覧を取得',
  'options.fetchModelListUnfetched': 'モデル一覧は未取得です',
  'options.fetchModelListFetching': '取得しています…',
  'options.fetchModelListFetched': '{count} 件のモデルを取得しました',
  'options.fetchModelListToast': 'モデル一覧を更新しました',
  'options.fetchModelListFailed':
    'モデル一覧の取得に失敗しました: {reason}（既存のカタログを使用します）',
  'options.fetchModelListUnsupported':
    'この接続方式ではモデル一覧の自動取得に対応していません（Gemini は単価表に収載済み、Azure OpenAI はデプロイメント名がテナント固有のため取得できません）',
  'options.fetchModelListGroupLabel': '取得したモデル',
  // reasoning effort の既定値（issue #127 PR5。docs/ui-states.md §2「reasoning effort の既定値」）
  'options.reasoningEffortTitle': 'reasoning effort の既定値',
  'options.reasoningEffortHelp':
    '未設定のままなら今までどおりの挙動を維持します（Anthropic ネイティブは low 相当を送信し続け、OpenRouter / OpenAI 互換 API は何も送りません）。設定すると、Anthropic ネイティブは output_config.effort へ、OpenRouter / OpenAI 互換 API（Azure OpenAI 含む）は reasoning_effort へそのまま送ります。Gemini では現時点で使用しません。',
  'options.reasoningEffortAria': 'reasoning effort の既定値',
  'options.reasoningEffortLabel': 'reasoning effort',
  'options.reasoningEffortUnset': '未設定（従来どおり）',
  'options.reasoningEffortLow': '低い（low）',
  'options.reasoningEffortMedium': '中程度（medium）',
  'options.reasoningEffortHigh': '高い（high）',
  'options.reasoningEffortStatus': 'reasoning effort の既定値: {status}',
  'options.defaultModelTitle': '既定モデル',
  'options.defaultModelHelp': '単価表にないモデルはコスト概算が表示されません。',
  'options.rateLimitTitle': 'レート制限（一括抽出の 429 対策）',
  'options.rateLimitHelp':
    '一括抽出で多数の論文を連続処理すると、API の 1 分あたりリクエスト上限に達して 429（Too Many Requests）が出ることがあります。お使いのプラン（tier）を選ぶと、リクエスト間隔と再試行を自動調整します。無料枠は間隔を広めに取ります。',
  'options.rateLimitTierAria': 'レート制限 tier',
  'options.rateLimitTierLabel': 'プラン（tier）',
  'options.rateLimitRpmLabel': '1 分あたりの最大リクエスト数（RPM）',
  'options.rateLimitConcurrencyLabel': '同時実行数（1 = 逐次。上げると速いが 429 / TPM に注意）',
  'options.statusSavedKey': '保存済み',
  'options.statusUnsetKey': '未設定',
  'options.placeholderSavedKey': '保存済み（変更する場合のみ入力）',
  'options.placeholderEnterKey': 'API キーを入力',
  'options.placeholderKeyOptional': 'API キー（loopback は任意）',
  'options.toastEmptyKey': 'API キーが空のため保存しませんでした。',
  'options.toastSaved': '保存しました。',
  'options.toastSaveFailed': '保存に失敗しました。もう一度お試しください。',
  'options.warnOpenRouterKey':
    'OpenRouter のキー（sk-or- で始まる）のようです。Gemini キーはここへ、OpenRouter キーは下の欄へ入力してください。',
  'options.warnGeminiKey':
    'Gemini のキー（AIza で始まる）のようです。OpenRouter キーはここへ、Gemini キーは上の欄へ入力してください。',
  'options.defaultModelPlaceholder': '未設定',
  'options.defaultModelStatus': '既定モデル: {status}',
  'options.defaultModelCleared': '未設定に戻しました。',
  'options.connectionUnsaved': '未保存（モデル名から自動判定）',
  'options.connectionSaved': '接続設定: 保存済み',
  'options.errKeyMissing': '{provider} API キーが未設定です',
  'options.errCompatibleKeyMissing': 'OpenAI 互換 API キーが未設定です',
  'options.errPermissionDenied': '接続先へのアクセスが許可されませんでした',
  'options.testFailed': '接続テストに失敗しました: {reason}',
  'options.testNoJson': 'JSON Schema に従う応答を確認できませんでした',
  'options.testSucceeded': '接続テストに成功しました。',
  'options.rateLimitStatus': 'レート制限: {label}',
  'options.errRpm': 'RPM は 1 以上の数値を入力してください。',
  'options.errConcurrency': '同時実行数は 1 以上の数値を入力してください。',
  'options.tierGeminiFreeLabel': 'Gemini 無料枠（Free）',
  'options.tierGeminiFreeDesc':
    '無料枠は 1 分あたりのリクエスト数が少なく 429 が出やすいため、間隔を広めに取ります。',
  'options.tierGeminiTier1Label': 'Gemini Tier 1（従量課金）',
  'options.tierGeminiTier1Desc': '支払い設定済みの Tier 1。無料枠より大幅に緩い上限を想定します。',
  'options.tierGeminiTier2Label': 'Gemini Tier 2',
  'options.tierGeminiTier2Desc': '累計課金額の条件を満たした Tier 2。',
  'options.tierGeminiTier3Label': 'Gemini Tier 3',
  'options.tierGeminiTier3Desc': '最上位 Tier 3。',
  'options.tierCustomLabel': 'カスタム（RPM を手動指定）',
  'options.tierCustomDesc':
    'OpenRouter や上記に当てはまらない場合に、実際の 1 分あたりリクエスト数を入力します。同時実行数を上げるとスループットが上がりますが、429 / TPM に当たる場合は下げてください。',
  'options.tierUnlimitedLabel': '制限なし（スロットルしない）',
  'options.tierUnlimitedDesc': 'サーバ側で十分な上限がある場合のみ。バッチ間の待ち時間を入れません。',
} as const;
