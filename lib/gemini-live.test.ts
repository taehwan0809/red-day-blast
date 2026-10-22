import test from 'node:test';
import assert from 'node:assert/strict';
import { GoogleGenAI } from '@google/genai';

const liveTestEnabled = process.env.GEMINI_LIVE_TEST === '1' && Boolean(process.env.GEMINI_API_KEY);

test('live Gemini API accepts the configured model and structured JSON response', { skip: !liveTestEnabled }, async () => {
  const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY!,
    httpOptions: {
      timeout: 12_000,
      retryOptions: { attempts: 1 }
    }
  });
  const response = await ai.models.generateContent({
    model: 'gemini-3.8-flash',
    contents: 'Return the JSON object required by the schema.',
    config: {
      responseMimeType: 'application/json',
      maxOutputTokens: 1200,
      thinkingConfig: { thinkingLevel: 'low' },
      responseJsonSchema: {
        type: 'object',
        properties: { status: { type: 'string', enum: ['ok'] } },
        required: ['status'],
        additionalProperties: false
      }
    }
  });
  const result = JSON.parse(response.text ?? '{}') as { status?: string };
  assert.equal(result.status, 'ok');
});
