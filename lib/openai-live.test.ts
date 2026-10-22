import test from 'node:test';
import assert from 'node:assert/strict';
import OpenAI from 'openai';
import { getGptModel } from './gpt-config';

const liveTestEnabled = process.env.OPENAI_LIVE_TEST === '1' && Boolean(process.env.GPT_API_KEY?.trim());

test('live OpenAI API returns a valid structured response for the configured model', { skip: !liveTestEnabled }, async () => {
  const client = new OpenAI({ apiKey: process.env.GPT_API_KEY, timeout: 9_000, maxRetries: 1 });
  const response = await client.responses.create({
    model: getGptModel(),
    input: 'Return the status value requested by the JSON schema.',
    max_output_tokens: 100,
    text: { format: { type: 'json_schema', name: 'live_test', strict: true, schema: {
      type: 'object', properties: { status: { type: 'string', enum: ['ok'] } },
      required: ['status'], additionalProperties: false
    } } }
  });
  assert.deepEqual(JSON.parse(response.output_text), { status: 'ok' });
});
