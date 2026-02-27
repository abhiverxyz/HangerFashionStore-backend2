/**
 * Admin: list and update agent prompts (e.g. Microstore Curation Agent).
 */
import { Router } from "express";
import { asyncHandler } from "../../core/asyncHandler.js";
import { getAgentPrompts, setAgentPrompt } from "../../domain/agentPrompts/agentPrompts.js";

const router = Router();

/** Preferred display order for microstore curation prompts (so admin sees all in logical order). */
const MICROSTORE_CURATION_ORDER = [
  "suggestName_system",
  "suggestName_user",
  "suggestOneStyleNote_system",
  "suggestOneStyleNote_user",
  "runCuration_system",
  "runCuration_user",
  "validateCoherence_user",
  "selectStoreImage_user",
  "generateCover_imageTemplate",
  "referenceImageAnalysis",
];

router.get(
  "/agents/:agentId/prompts",
  asyncHandler(async (req, res) => {
    const { agentId } = req.params;
    const prompts = await getAgentPrompts(agentId);
    let list = Object.entries(prompts).map(([promptKey, { content, references }]) => ({
      promptKey,
      content,
      references: Array.isArray(references) ? references : [],
    }));
    if (agentId === "microstoreCuration" && list.length > 0) {
      const orderSet = new Set(MICROSTORE_CURATION_ORDER);
      const ordered = MICROSTORE_CURATION_ORDER.filter((k) => prompts[k]).map((k) => list.find((p) => p.promptKey === k)).filter(Boolean);
      const rest = list.filter((p) => !orderSet.has(p.promptKey));
      list = [...ordered, ...rest];
    } else {
      list.sort((a, b) => a.promptKey.localeCompare(b.promptKey));
    }
    res.json({ agentId, prompts: list });
  })
);

router.put(
  "/agents/:agentId/prompts/:promptKey",
  asyncHandler(async (req, res) => {
    const { agentId, promptKey } = req.params;
    const { content, references } = req.body || {};
    await setAgentPrompt(agentId, promptKey, {
      content: typeof content === "string" ? content : "",
      references: Array.isArray(references) ? references : [],
    });
    const prompts = await getAgentPrompts(agentId);
    const entry = prompts[promptKey];
    res.json({ agentId, promptKey, content: entry?.content ?? "", references: entry?.references ?? [] });
  })
);

export default router;
