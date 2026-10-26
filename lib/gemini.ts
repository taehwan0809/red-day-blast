import { GoogleGenAI } from '@google/genai';

export const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';
export const GEMINI_REQUEST_TIMEOUT_MS = 10_000;

export function getGeminiModel(configuredModel = process.env.GEMINI_MODEL) {
  return configuredModel?.trim() || DEFAULT_GEMINI_MODEL;
}

export async function generateGeminiJson(prompt: string, schema: unknown, maxOutputTokens: number) {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new Error('GEMINI_API_KEY_MISSING');

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      timeout: GEMINI_REQUEST_TIMEOUT_MS,
      retryOptions: {
        attempts: 2,
        initialDelay: 0.5,
        maxDelay: 1,
        jitter: 0.2,
        httpStatusCodes: [408, 500, 502, 503, 504]
      }
    }
  });
  const response = await ai.models.generateContent({
    model: getGeminiModel(),
    contents: prompt,
    config: {
      maxOutputTokens,
      responseMimeType: 'application/json',
      responseJsonSchema: schema
    }
  });
  return response.text;
}