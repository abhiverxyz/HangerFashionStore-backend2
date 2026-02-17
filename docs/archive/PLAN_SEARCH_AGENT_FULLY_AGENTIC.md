# Plan: Make Search Agent fully agentic

## Current state

The agent in [backend2/src/agents/searchAgent.js](backend2/src/agents/searchAgent.js):

- **Generates:** Product search (text or image) via `searchProducts`; LLM-generated summary via `generateSearchSummary(query, items, total)`.
- **Validates:** Only `validateRelevance(total, items, reply)` — a **rule**: if `total === 0`, override reply with a fixed "no results, try broadening" message. When `total > 0`, there is **no** check that results actually match the query (semantic relevance).
- **Tools:** `searchProducts` (embeddings/product domain).
- **Fallbacks:** Summary LLM catch → null → static reply; search catch → generic error reply.

**Gap (from audit):** No explicit **relevance validation** when results exist. The agent can return a confident summary even when the top results are only loosely related to the query.

## Goal

Add an explicit **validate** step that checks whether the returned results are relevant to the user's query (and optionally adjusts the reply). That satisfies "generate + validate" and makes the Search Agent **fully agentic**.

## Approach

Keep the current flow; add a **relevance validation** step **after** we have `items` and **before** we finalise the reply:

1. When `total === 0`: keep current behaviour (rule-based message: "I couldn't find anything… try broadening").
2. When `total > 0`: call a small **LLM validator** with the user query (or "image search") and a compact view of the results (e.g. first 6–8 product titles + optional category). Ask: "Do these results match the user's query well?" Return `{ ok: boolean, suggestedReply?: string }`. If `ok` is false, `suggestedReply` can nuance the message (e.g. "Here are the closest matches we have; for more options try …" or "These are related items; you might also search for …").
3. Use the validator output: if `ok === false` and `suggestedReply` is present, use `suggestedReply` (trimmed, length-capped) as the reply instead of (or in addition to) the generated summary; otherwise keep the current summary. On validator failure (throw or invalid response), treat as "skip validation" and keep the existing reply.

No change to `searchProducts` (no need to expose similarity scores for this step). No second search or refinement loop; validation only adjusts the **reply** so the user is not misled when results are weak.

## Implementation steps

(Implemented. Search Agent now has validateSearchRelevance; audit updated.)

## Files to touch

(Completed.)

## Edge cases

(As in plan.)

## Out of scope

(As in plan.)
