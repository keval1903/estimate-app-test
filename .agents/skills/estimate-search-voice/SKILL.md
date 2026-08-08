---
name: estimate-search-voice
description: Improves product search, autocomplete, synonyms, voice-to-search text and Product Master lookup while preserving mobile speed and existing matching behavior.
---

# Product Search and Voice

Inspect:
- `src/lib/searchUtils.js`
- `src/lib/synonyms.js`
- `src/hooks/useVoiceSearch.jsx`
- Product search block in `CreateEstimate.jsx`
- Product filtering in `Products.jsx`

## Existing behavior

Search combines:
- normalized query;
- direct substring;
- no-space matching;
- all terms;
- smart alpha/numeric terms;
- subsequence fuzzy matching.

Voice uses browser SpeechRecognition and writes transcript into normal search state.

## Rules

- preserve ordinary typed search;
- preserve product codes/numeric fragments and sizes;
- avoid a separate voice-only search engine;
- avoid adding a dependency before measuring the existing implementation;
- `fuse.js` being installed is not by itself a reason to use it;
- account for current 2000-product loading ceiling before blaming match logic;
- if asynchronous fetching is introduced, prevent stale results overriding newer text.

## Verify examples

Use:
- a normal product word fragment;
- a numeric product fragment;
- a multi-term dimension-style query;
- rapid typing;
- voice transcript -> same suggestion path.
