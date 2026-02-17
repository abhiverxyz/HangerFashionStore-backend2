/**
 * Admin routes: composed in routes/admin/ (brands, modelConfig, content, microstores, feed, storageTest).
 * Import endpoints use requireAdminOrSecret; all others use requireAdmin.
 */
export { default } from "./admin/index.js";
