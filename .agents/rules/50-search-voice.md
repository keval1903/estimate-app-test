---
trigger: model_decision
---

# Product Search / Voice Rule

Recommended activation: Model Decision

Use for Product Master search, estimate product autocomplete, fuzzy matching, synonyms or voice input.

Current reusable pieces:
- `src/lib/searchUtils.js`
- `src/lib/synonyms.js`
- `src/hooks/useVoiceSearch.jsx`

Search combines normalized text, direct substring, all-term/smart-term matching, no-space matching and subsequence fuzzy matching.

`fuse.js` is installed but currently unused. Do not switch to it without evidence that the existing approach cannot meet the requirement.

Voice search must feed the same search state/path as typed input.

When optimizing:
- preserve numeric fragments and product dimensions;
- preserve rapid mobile typing;
- avoid stale asynchronous results;
- remember key screens currently load Product Master in two 1000-row batches.
