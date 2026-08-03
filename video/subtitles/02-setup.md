---
scene: "02"
slug: setup
---

## cue 01
First, setup. Install the extension from its Chrome Web Store listing by clicking "Add to
Chrome".

## cue 02
Right-click the extension icon, open "Options", and save your own LLM API key — this is
BYOK, Bring Your Own Key. The key is stored only on this device's chrome.storage and is
never sent to the developer.

## cue 03
The default provider is the Gemini API, and you can get a key from Google AI Studio.

## cue 04
Clicking the extension icon opens this project picker in a new tab. The first time, you
sign in with Google here and grant access to your email address and to Drive — only the
files you select.

## cue 05
Besides Gemini, you can connect to OpenRouter, an OpenAI-compatible endpoint, Anthropic, or
Azure OpenAI. Local LLMs on localhost work too, and in that case the API key can be
omitted.

## cue 06
The default model is the starting choice for new runs, and under rate limiting you can pick
the tier matching your plan so throttling and retries during full extraction are tuned
automatically.

## cue 07
Full text ever leaves your browser only for extraction requests to the LLM API you
configured — there is no developer-operated server.
