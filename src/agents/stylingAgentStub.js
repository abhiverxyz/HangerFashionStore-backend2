/**
 * B2.4 Styling Agent — stub for B2.
 * For B2 we only need the conversation pipeline; real styling logic (Look Composition,
 * User Profile, Fashion Content, LLM, image generation) comes in B2.4 proper.
 * This stub returns a placeholder reply so handleTurn can persist and return.
 *
 * @param {{ message: string, imageUrl?: string | null, history: Object[] }} input
 * @param {{ userId: string }} context
 * @returns {Promise<{ reply: string, flowType?: string, flowContext?: object }>}
 */
export async function run(input, context) {
  return {
    reply: "Thanks for your message! Styling suggestions will be available soon. How can I help you get ready today?",
    flowType: "none",
    flowContext: null,
  };
}
