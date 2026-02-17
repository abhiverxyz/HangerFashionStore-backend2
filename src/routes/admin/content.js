/**
 * Admin: fashion content (sources, allowlist, run agent), styling (avatars, playbook), look classification tags.
 */
import { Router } from "express";
import { asyncHandler } from "../../core/asyncHandler.js";
import * as fashionContent from "../../domain/fashionContent/fashionContent.js";
import * as stylingAgentConfig from "../../domain/stylingAgentConfig/stylingAgentConfig.js";
import * as lookClassificationTag from "../../domain/lookClassificationTag/lookClassificationTag.js";
import { runFashionContentAgent } from "../../agents/fashionContentAgent.js";

const router = Router();

// ---------- Fashion Content ----------
router.get(
  "/fashion-content-sources",
  asyncHandler(async (req, res) => {
    const { status, limit } = req.query;
    const result = await fashionContent.listFashionContentSources({
      status: status || undefined,
      limit: limit ? Number(limit) : undefined,
    });
    res.json(result);
  })
);

router.post(
  "/fashion-content-sources",
  asyncHandler(async (req, res) => {
    const { type, payload } = req.body || {};
    if (!type || !payload) {
      return res.status(400).json({ error: "type and payload are required" });
    }
    const created = await fashionContent.addFashionContentSource({
      type,
      payload: String(payload).trim(),
      createdBy: req.user?.id || null,
    });
    res.status(201).json(created);
  })
);

router.get(
  "/fashion-content-allowlist",
  asyncHandler(async (_req, res) => {
    const list = await fashionContent.listAllowedFashionDomains();
    res.json(list);
  })
);

router.post(
  "/fashion-content-allowlist",
  asyncHandler(async (req, res) => {
    const { domain } = req.body || {};
    if (!domain) return res.status(400).json({ error: "domain is required" });
    const created = await fashionContent.addAllowedFashionDomain(domain);
    res.status(201).json(created);
  })
);

router.delete(
  "/fashion-content-allowlist/:idOrDomain",
  asyncHandler(async (req, res) => {
    const deleted = await fashionContent.removeAllowedFashionDomain(req.params.idOrDomain);
    res.json(deleted);
  })
);

router.post(
  "/run-fashion-content-agent",
  asyncHandler(async (req, res) => {
    const { seed } = req.body || {};
    const result = await runFashionContentAgent({ seed: seed || "" });
    res.json({ success: true, result });
  })
);

// ---------- Styling (avatars, playbook) ----------
router.get(
  "/styling-avatars",
  asyncHandler(async (req, res) => {
    const avatars = await stylingAgentConfig.listAvatars();
    res.json(avatars);
  })
);

router.get(
  "/styling-avatars/default",
  asyncHandler(async (req, res) => {
    const avatar = await stylingAgentConfig.getDefaultAvatar();
    if (!avatar) return res.status(404).json({ error: "No avatar found" });
    res.json(avatar);
  })
);

router.put(
  "/styling-avatars/default",
  asyncHandler(async (req, res) => {
    const { avatarId, avatarSlug } = req.body || {};
    const idOrSlug = avatarId || avatarSlug;
    if (!idOrSlug) return res.status(400).json({ error: "avatarId or avatarSlug required" });
    const avatar = await stylingAgentConfig.setDefaultAvatar(idOrSlug);
    res.json(avatar);
  })
);

router.put(
  "/styling-avatars/:idOrSlug",
  asyncHandler(async (req, res) => {
    const { name, slug, description, systemPromptAddition, sortOrder, isDefault } = req.body || {};
    const avatar = await stylingAgentConfig.upsertAvatar({
      id: req.params.idOrSlug,
      name,
      slug: slug || req.params.idOrSlug,
      description,
      systemPromptAddition,
      sortOrder,
      isDefault,
    });
    res.json(avatar);
  })
);

router.get(
  "/styling-playbook",
  asyncHandler(async (req, res) => {
    const type = req.query.type;
    const isActive = req.query.isActive !== undefined ? req.query.isActive === "true" : undefined;
    const entries = await stylingAgentConfig.listPlaybook({ type, isActive });
    res.json(entries);
  })
);

router.get(
  "/styling-playbook/goals",
  asyncHandler(async (req, res) => {
    const content = await stylingAgentConfig.getGoalsContent();
    res.json({ content });
  })
);

router.put(
  "/styling-playbook/goals",
  asyncHandler(async (req, res) => {
    const { content } = req.body || {};
    await stylingAgentConfig.setGoalsContent(content);
    const updated = await stylingAgentConfig.getGoalsContent();
    res.json({ content: updated });
  })
);

router.post(
  "/styling-playbook",
  asyncHandler(async (req, res) => {
    const { type, content, sortOrder, isActive } = req.body || {};
    if (!type || (type !== "instruction" && type !== "example_flow")) {
      return res.status(400).json({ error: "type must be instruction or example_flow" });
    }
    const entry = await stylingAgentConfig.upsertPlaybookEntry({ type, content, sortOrder, isActive });
    res.status(201).json(entry);
  })
);

router.put(
  "/styling-playbook/:id",
  asyncHandler(async (req, res) => {
    const { content, sortOrder, isActive } = req.body || {};
    const entry = await stylingAgentConfig.upsertPlaybookEntry({
      id: req.params.id,
      content,
      sortOrder,
      isActive,
    });
    res.json(entry);
  })
);

router.delete(
  "/styling-playbook/:id",
  asyncHandler(async (req, res) => {
    await stylingAgentConfig.deletePlaybookEntry(req.params.id);
    res.status(204).send();
  })
);

// ---------- Look classification tags ----------
router.get(
  "/look-classification-tags",
  asyncHandler(async (req, res) => {
    const { limit, offset } = req.query;
    const result = await lookClassificationTag.listLookClassificationTags({
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
    res.json(result);
  })
);

router.post(
  "/look-classification-tags/seed",
  asyncHandler(async (req, res) => {
    const result = await lookClassificationTag.seedDefaultLookClassificationTags();
    res.json(result);
  })
);

router.post(
  "/look-classification-tags",
  asyncHandler(async (req, res) => {
    const { name, label, description, sortOrder } = req.body || {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: "name is required" });
    }
    const created = await lookClassificationTag.createLookClassificationTag({
      name,
      label,
      description,
      sortOrder,
    });
    res.status(201).json(created);
  })
);

router.put(
  "/look-classification-tags/:id",
  asyncHandler(async (req, res) => {
    const { name, label, description, sortOrder } = req.body || {};
    const updated = await lookClassificationTag.updateLookClassificationTag(req.params.id, {
      name,
      label,
      description,
      sortOrder,
    });
    if (!updated) return res.status(404).json({ error: "Tag not found" });
    res.json(updated);
  })
);

router.delete(
  "/look-classification-tags/:id",
  asyncHandler(async (req, res) => {
    const deleted = await lookClassificationTag.deleteLookClassificationTag(req.params.id);
    if (!deleted) return res.status(404).json({ error: "Tag not found" });
    res.status(204).send();
  })
);

export default router;
