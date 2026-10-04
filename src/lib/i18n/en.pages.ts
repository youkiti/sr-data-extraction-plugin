// UI 文言辞書（英語・ページ共通群）。
import type { jaPages } from './ja.pages';

export const enPages: Record<keyof typeof jaPages, string> = {
  // 共通
  'common.cancel': 'Cancel',
  'common.reload': 'Reload',
  'common.reloadList': 'Reload the list',
  'common.retry': 'Retry',
  'common.loading': 'Loading…',
  'common.noProject': 'Select a project first (you can create / select one from the project selection page).',

  // Options の表示言語節
  'options.documentTitle': 'SR Data Extraction Plugin — Settings',
  'options.heading': 'Settings',
  'options.openApp': 'Open the app',
  'options.languageTitle': 'Display language',
  'options.languageHelp': 'Language of the user interface. Changes apply immediately.',
  'options.languageLabel': 'Language',
  'options.languageSaveFailed': 'Failed to save the display language.',

  // Options の公開ページリンク節（settingsSections.ts。issue #214）
  'options.linksTitle': 'Help and policies',
  'options.linksHelp': 'All links open in a new tab.',
  'options.linkHelp': 'User guide',
  'options.linkPrivacy': 'Privacy policy',
  'options.linkTerms': 'Terms of service',

  // Popup S1
  'popup.loading': 'Loading…',
  'popup.authLead':
    'Projects are stored in Google Sheets / Drive. Please sign in with your Google account.',
  'popup.login': 'Sign in with Google',
  'popup.loginFailed': 'Sign-in failed. Make sure a Google account is added to your browser.',
  'popup.loggedInAs': 'Signed in as:',
  'popup.logout': 'Sign out',
  'popup.recentTitle': 'Recent spreadsheets',
  'popup.recentSelectLabel': 'Recent spreadsheets',
  'popup.recentOpen': 'Open',
  'popup.recentOpening': 'Opening…',
  'popup.createTitle': 'New project',
  'popup.createLead':
    'Creates a data extraction project (generates a spreadsheet and a Drive folder).',
  'popup.createTitleLabel': 'Project title',
  'popup.createSubmit': 'Create',
  'popup.creating': 'Creating…',
  'popup.tiabTitle': 'Create by importing from tiab-review',
  'popup.tiabLead':
    'Pick your tiab-review spreadsheet to create a project automatically and get guided through importing the included PDFs.',
  'popup.tiabPick': 'Pick the tiab-review sheet',
  'popup.tiabPicking': 'Choose the sheet in the picker…',
  'popup.tiabChecking': 'Checking the selected sheet…',
  'popup.tiabDetected': 'Found {n} included references. Confirm the project title and create.',
  'popup.tiabNoIncludes':
    'No included references were found. Check the screening decisions in tiab-review.',
  'popup.tiabCreateSubmit': 'Create and continue',
  'popup.openTitle': 'Open by spreadsheet ID / URL',
  'popup.openIdLabel': 'Spreadsheet ID or URL',
  'popup.openIdPlaceholder': 'Paste a spreadsheet ID or URL',
  'popup.openSubmit': 'Open',
  'popup.openOptions': 'Open settings',
  'popup.openHelp': 'User guide',
  'popup.statusLoginRequired': 'Sign-in required.',
  'popup.statusPickRecent': 'Choose a recent spreadsheet or create a new one.',
  'popup.statusCreateOrOpen': 'Create a new project or open one from a spreadsheet ID.',
  'popup.emailUnknown': '(unknown)',
  'popup.accountMismatch':
    'Signed in with an account different from your Chrome profile ({profileEmail}). Extractions and decisions are recorded under the signed-in account.',

  // モデルセレクタ
  'modelSelect.other': 'Other (enter directly)',
  'modelSelect.customAria': '{label} (direct input)',
  'modelSelect.customPlaceholder': 'e.g. org/model-name',

  // サービス層のトースト・状態エラー
  'common.pickerFailed': 'Could not open the Drive Picker: {reason}',
  'common.toastCopyFailed': 'Copy failed: {reason}',
  'popup.errTitleRequired': 'A project title is required',
  'popup.errIdRequired': 'A spreadsheet ID is required',
  // 既存 ID で開く: アクセス許可が必要（issue #130。docs/ui-states.md §1）
  'popup.accessNeeded':
    'You do not yet have permission to open this spreadsheet. If it was shared with you, click "Allow with Google" and select the sheet (this message also appears when the sheet is missing, deleted, or the ID is wrong).',
  'popup.openGrant': 'Allow with Google',
  'popup.grantWaiting': 'Waiting for permission…',
  'popup.grantMismatch':
    'The selected sheet differs from the entered ID. Please select the shared sheet itself.',
  'popup.grantStillDenied':
    'Still unable to access after granting. The sheet may have been deleted or the ID may be wrong.',

  // Options
  'options.geminiTitle': 'Gemini API key (BYOK)',
  'options.geminiHelp':
    'API keys are stored only in chrome.storage on this device and are never sent to the developers.',
  'options.geminiLabel': 'Gemini API key',
  'options.save': 'Save',
  'options.openrouterTitle': 'OpenRouter API key (BYOK)',
  'options.openrouterHelpPrefix':
    'Set this to use models via OpenRouter (qwen / deepseek etc.). Get a key at ',
  'options.openrouterHelpSuffix': '. It is stored only in chrome.storage on this device.',
  'options.openrouterLabel': 'OpenRouter API key',
  'options.connectionTitle': 'LLM connection',
  'options.connectionHelp':
    'A saved connection method takes precedence over the model name. HTTP is allowed only for localhost, 127.0.0.1, and [::1]; use HTTPS for APIs on other machines.',
  'options.providerAria': 'LLM connection method',
  'options.providerOpenAiCompatible': 'OpenAI-compatible API',
  'options.compatibleNotice':
    'Article text and extraction prompts are sent directly from the browser to the endpoint specified here.',
  'options.endpointLabel': 'API endpoint',
  'options.apiKeyLabel': 'API key',
  'options.loopbackNote': 'Optional for connections to localhost, 127.0.0.1, or [::1].',
  'options.azureEndpointHelp':
    'Enter the full URL including the deployment and API version (e.g. https://{resource}.openai.azure.com/openai/deployments/{deployment}/chat/completions?api-version=2026-xx-xx).',
  'options.azureModelHelp':
    'Enter the Azure OpenAI "deployment name" in the default model field (the deployment in the URL determines the model, so the request body model value is ignored).',
  'options.providerLabel': 'Connection method',
  'options.saveConnection': 'Save connection settings',
  'options.testConnection': 'Test connection',
  'options.fetchModelList': 'Fetch model list',
  'options.fetchModelListUnfetched': 'The model list has not been fetched yet.',
  'options.fetchModelListFetching': 'Fetching…',
  'options.fetchModelListFetched': 'Fetched {count} model(s).',
  'options.fetchModelListToast': 'Model list updated.',
  'options.fetchModelListFailed':
    'Failed to fetch the model list: {reason} (using the built-in catalog instead).',
  'options.fetchModelListUnsupported':
    'Fetching a model list is not supported for this connection method (Gemini models are already in the price table; Azure OpenAI deployment names are tenant-specific and cannot be listed).',
  'options.fetchModelListGroupLabel': 'Fetched models',
  // Default reasoning effort (issue #127 PR5. docs/ui-states.md §2 "reasoning effort の既定値")
  'options.reasoningEffortTitle': 'Default reasoning effort',
  'options.reasoningEffortHelp':
    "Leaving this unset keeps today's behavior (the Anthropic native connection keeps sending a low-equivalent effort; OpenRouter / OpenAI-compatible APIs send nothing). Setting it sends the value as-is: Anthropic native uses output_config.effort, and OpenRouter / OpenAI-compatible APIs (including Azure OpenAI) use reasoning_effort. Gemini does not use it yet.",
  'options.reasoningEffortAria': 'Default reasoning effort',
  'options.reasoningEffortLabel': 'Reasoning effort',
  'options.reasoningEffortUnset': 'Not set (unchanged)',
  'options.reasoningEffortLow': 'Low',
  'options.reasoningEffortMedium': 'Medium',
  'options.reasoningEffortHigh': 'High',
  'options.reasoningEffortStatus': 'Default reasoning effort: {status}',
  'options.defaultModelTitle': 'Default model',
  'options.defaultModelHelp': 'Cost estimates are not shown for models not in the price table.',
  'options.rateLimitTitle': 'Rate limiting (429 protection for full extraction)',
  'options.rateLimitHelp':
    'Processing many articles in a row during full extraction can hit the per-minute request limit of the API and return 429 (Too Many Requests). Choose your plan (tier) to auto-adjust request spacing and retries. The free tier uses wider spacing.',
  'options.rateLimitTierAria': 'Rate limit tier',
  'options.rateLimitTierLabel': 'Plan (tier)',
  'options.rateLimitRpmLabel': 'Maximum requests per minute (RPM)',
  'options.rateLimitConcurrencyLabel':
    'Concurrency (1 = sequential. Higher is faster but watch for 429 / TPM)',
  'options.statusSavedKey': 'saved',
  'options.statusUnsetKey': 'not set',
  'options.placeholderSavedKey': 'Saved (enter only to change)',
  'options.placeholderEnterKey': 'Enter an API key',
  'options.placeholderKeyOptional': 'API key (optional for loopback)',
  'options.toastEmptyKey': 'Not saved because the API key is empty.',
  'options.toastSaved': 'Saved.',
  'options.toastSaveFailed': 'Saving failed. Please try again.',
  'options.warnOpenRouterKey':
    'This looks like an OpenRouter key (starts with sk-or-). Enter the Gemini key here and the OpenRouter key in the field below.',
  'options.warnGeminiKey':
    'This looks like a Gemini key (starts with AIza). Enter the OpenRouter key here and the Gemini key in the field above.',
  'options.defaultModelPlaceholder': 'Not set',
  'options.defaultModelStatus': 'Default model: {status}',
  'options.defaultModelCleared': 'Reset to unset.',
  'options.connectionUnsaved': 'Not saved (auto-detected from the model name)',
  'options.connectionSaved': 'Connection settings: saved',
  'options.errKeyMissing': 'The {provider} API key is not set',
  'options.errCompatibleKeyMissing': 'The OpenAI-compatible API key is not set',
  'options.errPermissionDenied': 'Access to the endpoint was not granted',
  'options.testFailed': 'Connection test failed: {reason}',
  'options.testNoJson': 'Could not confirm a response conforming to the JSON Schema',
  'options.testSucceeded': 'Connection test succeeded.',
  'options.rateLimitStatus': 'Rate limit: {label}',
  'options.errRpm': 'Enter an RPM of 1 or more.',
  'options.errConcurrency': 'Enter a concurrency of 1 or more.',
  'options.tierGeminiFreeLabel': 'Gemini free tier (Free)',
  'options.tierGeminiFreeDesc':
    'The free tier allows few requests per minute and easily hits 429, so wider spacing is used.',
  'options.tierGeminiTier1Label': 'Gemini Tier 1 (pay-as-you-go)',
  'options.tierGeminiTier1Desc':
    'Tier 1 with billing enabled. Assumes much looser limits than the free tier.',
  'options.tierGeminiTier2Label': 'Gemini Tier 2',
  'options.tierGeminiTier2Desc': 'Tier 2, reached via cumulative billing thresholds.',
  'options.tierGeminiTier3Label': 'Gemini Tier 3',
  'options.tierGeminiTier3Desc': 'The top Tier 3.',
  'options.tierCustomLabel': 'Custom (specify RPM manually)',
  'options.tierCustomDesc':
    'For OpenRouter or anything not covered above, enter your actual requests per minute. Raising concurrency increases throughput; lower it if you hit 429 / TPM limits.',
  'options.tierUnlimitedLabel': 'Unlimited (no throttling)',
  'options.tierUnlimitedDesc':
    'Only when the server allows ample limits. No waiting is inserted between batches.',
};
