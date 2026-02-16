/**
 * B2.2 Router
 * Given message + conversation history + optional image, decides which agent to run.
 * For B2 only the Styling Agent exists; we always invoke it. B3+ adds intent-based routing.
 */

import { run as runStylingAgent } from "./stylingAgent.js";

/**
 * Route a user turn to the appropriate agent and return the agent result.
 * @param {{ message: string, imageUrls?: string[], history: Object[] }} input
 * @param {{ userId: string }} context
 * @returns {Promise<{ reply: string, flowType?: string, flowContext?: object }>}
 */
export async function route(input, context) {
  // B2: only Styling Agent; always use it.
  return runStylingAgent(input, context);
}
