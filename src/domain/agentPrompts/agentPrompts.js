/**
 * Agent prompts: load and save admin-editable prompts per agent.
 * Used by Microstore Curation Agent and others. When content is set, agent uses it (with {{references}} replaced).
 */
import { getPrisma } from "../../core/db.js";

const MICROSTORE_CURATION_DEFAULTS = {
  suggestName_system: `You are a fashion microstore curator. Given a store description, suggest a short catchy title and optionally polish the description.
Use these examples as reference (match tone and style):
{{references}}

Output JSON only, no markdown, with keys: title, description, styleNotes, vibe, trends, categories.
- title: One short store name: max 8 words, direct and understandable, mix of trend, occasion and category.
- description: One sentence (polish the user's description if needed).
- styleNotes: Array of 2 to 5 short style tips. Each item: { "text": "short tip" }.
- vibe: One vibe/occasion string.
- trends: Comma-separated trends.
- categories: Comma-separated categories.`,
  suggestName_user: `Store description: {{description}}
{{vibe}}{{trend}}{{category}}
Respond with JSON only.`,
  suggestOneStyleNote_system: `You are a fashion microstore curator. Suggest ONE short style tip as a card: title (short headline) and description (1 sentence).
Use these store examples as reference: {{references}}
Output JSON only: { "title": "short headline", "description": "one sentence tip" }. Keep it concise and actionable.`,
  suggestOneStyleNote_user: `Store: {{description}}
{{vibe}}{{trend}}{{category}}
{{existingTitles}}
Respond with one style tip as JSON only.`,
  runCuration_system: `You are a fashion microstore curator. Generate a microstore definition.
Use these examples of store titles and descriptions as reference (match tone and style):
{{references}}

Output JSON only, no markdown, with keys: title, description, styleNotes, vibe, trends, categories.
- title: One short store name: max 8 words, direct and understandable (e.g. "Casual Chic Denim for Work").
- description: One sentence describing the store.
- styleNotes: Array of 2 to 5 short style tips. Each item: { "text": "short tip" } or { "title": "...", "url": "", "type": "text", "description": "..." }.
- vibe: One vibe/occasion string (e.g. "casual work").
- trends: Comma-separated trends.
- categories: Comma-separated categories.`,
  runCuration_user: `Create a microstore about: {{topicPart}}.{{userContext}}
{{vibe}}{{trend}}{{category}}
Respond with JSON only.`,
  validateCoherence_user: `You are a quality checker for a fashion microstore.

Store name: {{storeName}}
Description: {{description}}
Vibe: {{vibe}}

Products in the store (title, category): {{productList}}

Check: (1) Do these products fit the store's name, description, and vibe? (2) Is the set coherent (not random or clearly off-topic)?

Reply with JSON only: { "ok": boolean, "reason": string | null, "suggestedSearchHint": string | null }. If ok is false, reason should briefly explain; suggestedSearchHint is an optional short phrase to refine product search.`,
  selectStoreImage_user: `Store: "{{storeName}}". Description: {{description}}. Vibe: {{vibe}}.

Which single image best represents this microstore? Options:
{{listText}}

Reply with JSON only: { "choiceIndex": number } (the index 0 to {{maxIndex}}). Prefer the generated hero (index 0) if it fits the store; otherwise pick the product image that best represents the collection.`,
  generateCover_imageTemplate: `Fashion lifestyle hero image, editorial. Set the scene to match the store: {{name}}. {{description}}. Atmosphere and mood: {{vibe}}. No text, no words, no letters, no typography on the image. Trends: {{trends}}. Categories: {{categories}}.`,
  referenceImageAnalysis: `Describe the style, mood, colors, and visual tone of this image in 1-2 sentences for use as a style reference in an image generation prompt. Reply with JSON only: { "styleDescription": "your 1-2 sentence description" }. Be concise.`,
};

const AGENT_DEFAULTS = {
  microstoreCuration: MICROSTORE_CURATION_DEFAULTS,
};

/**
 * Get all prompt keys and their content/references for an agent. Returns defaults merged with DB overrides.
 */
export async function getAgentPrompts(agentId) {
  const defaults = AGENT_DEFAULTS[agentId];
  if (!defaults) return {};
  const prisma = getPrisma();
  let rows = [];
  try {
    rows = await prisma.agentPrompt.findMany({ where: { agentId } });
  } catch (e) {
    return Object.fromEntries(Object.entries(defaults).map(([k, v]) => [k, { content: v, references: [] }]));
  }
  const byKey = Object.fromEntries(rows.map((r) => [r.promptKey, r]));
  return Object.fromEntries(
    Object.entries(defaults).map(([key, defaultContent]) => {
      const row = byKey[key];
      let references = [];
      if (row?.references) {
        try {
          references = JSON.parse(row.references);
          if (!Array.isArray(references)) references = [];
        } catch (_) {}
      }
      return [key, { content: row?.content ?? defaultContent, references }];
    })
  );
}

/**
 * Get one prompt content for an agent (with optional placeholder replacement). Used by agents at runtime.
 */
export async function getAgentPromptContent(agentId, promptKey, placeholders = {}) {
  const prompts = await getAgentPrompts(agentId);
  const entry = prompts[promptKey];
  if (!entry) return null;
  let content = entry.content;
  const refs = Array.isArray(entry.references) ? entry.references : [];
  const refText = refs.join("\n");
  content = content.replace(/\{\{references\}\}/g, refText);
  for (const [k, v] of Object.entries(placeholders)) {
    content = content.replace(new RegExp(`\\{\\{${k}\\}\\}`, "g"), String(v ?? ""));
  }
  return content;
}

/**
 * Update or create one prompt for an agent.
 */
export async function setAgentPrompt(agentId, promptKey, { content, references }) {
  const prisma = getPrisma();
  const referencesStr = Array.isArray(references) ? JSON.stringify(references) : "[]";
  await prisma.agentPrompt.upsert({
    where: { agentId_promptKey: { agentId, promptKey } },
    create: { agentId, promptKey, content: content || "", references: referencesStr },
    update: { content: content || "", references: referencesStr },
  });
  return getAgentPrompts(agentId);
}
