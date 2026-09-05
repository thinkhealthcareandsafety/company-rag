import { GoogleGenAI } from "@google/genai";
import { getGeminiEnv } from "@/lib/env";

let client: GoogleGenAI | undefined;

export function getGemini(): GoogleGenAI {
  if (!client) {
    client = new GoogleGenAI({ apiKey: getGeminiEnv().GEMINI_API_KEY });
  }
  return client;
}

export const EMBEDDING_MODEL = "gemini-embedding-001";
export const EMBEDDING_DIMENSIONS = 768;
// gemini-3.6-flash's free-tier daily quota is only 20 requests — trivial to
// exhaust during testing/demos. flash-lite has a much higher free RPD limit
// and still supports function calling; swap back to the full flash model
// once on a paid tier where quality/latency tradeoffs matter more than quota.
export const CHAT_MODEL = "gemini-3.5-flash-lite";
