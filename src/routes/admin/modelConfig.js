/**
 * Admin: model-config and style-report-settings.
 */
import { Router } from "express";
import { asyncHandler } from "../../core/asyncHandler.js";
import {
  getAllModelConfig,
  invalidateModelConfigCache,
  KNOWN_SCOPES,
} from "../../config/modelConfig.js";
import { saveModelConfig } from "../../config/modelConfigDb.js";
import { getStyleReportSettings, saveStyleReportSettings } from "../../config/styleReportSettings.js";

const router = Router();

router.get(
  "/model-config",
  asyncHandler(async (req, res) => {
    const config = await getAllModelConfig();
    res.json(config);
  })
);

router.put(
  "/model-config",
  asyncHandler(async (req, res) => {
    const { scope, provider, model } = req.body || {};
    const scopeStr = typeof scope === "string" ? scope.trim() : "";
    if (!scopeStr) return res.status(400).json({ error: "scope is required" });
    if (!KNOWN_SCOPES.includes(scopeStr)) {
      return res.status(400).json({
        error: `scope must be one of: ${KNOWN_SCOPES.join(", ")}`,
        allowedScopes: KNOWN_SCOPES,
      });
    }
    const providerStr = typeof provider === "string" ? provider.trim() : "";
    const modelStr = typeof model === "string" ? model.trim() : "";
    if (!providerStr || !modelStr) {
      return res.status(400).json({ error: "provider and model are required" });
    }
    await saveModelConfig(scopeStr, { provider: providerStr, model: modelStr });
    invalidateModelConfigCache(scopeStr);
    const updated = await getAllModelConfig();
    res.json(updated);
  })
);

router.get(
  "/style-report-settings",
  asyncHandler(async (req, res) => {
    const settings = await getStyleReportSettings();
    res.json(settings);
  })
);

router.put(
  "/style-report-settings",
  asyncHandler(async (req, res) => {
    const updated = await saveStyleReportSettings(req.body || {});
    res.json(updated);
  })
);

export default router;
