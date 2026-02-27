/**
 * @deprecated Use wardrobeAgent.js instead. This file re-exports for backward compatibility.
 */
import { extractFromLook, suggestForItem, itemToSearchQuery } from "./wardrobeAgent.js";

export const run = extractFromLook;
export { suggestForItem, itemToSearchQuery };
