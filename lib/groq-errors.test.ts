import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyGroqError, getSafeGroqErrorDetails } from './groq-errors';
import { generateGroqJson, getGroqModel, GROQ_CHAT_COMPLETIONS_URL, GROQ_MAX_ATTEMPTS, GROQ_REQUEST_TIMEOUT_MS } from './groq';

test('Groq rate limit, provider failures and network errors are classified distinctly', () => {
  assert.equal(classifyGroqError(Object.assign(new Error('Invalid key'), { status: 401 })).errorCode, 'GROQ_AUTHENTICATION_FAILED');
  assert.equal(classifyGroqError(Object.assign(new Error('Forbidden'), { status: 403 })).errorCode, 'GROQ_ACCESS_DENIED');
  assert.equal(classifyGroqError(Object.assign(new Error('model not found'), { status: 404 })).kind, 'model_unavailable');
  assert.equal(classifyGroqError(Object.assign(new Error('rate limit exceeded'), { status: 429 })).errorCode, 'GROQ_RATE_LIMITED');
  assert.equal(classifyGroqError(Object.assign(new Error('daily quota exceeded'), { status: 429 })).errorCode, 'GROQ_QUOTA_EXCEEDED');
  assert.equal(classifyGroqError(Object.assign(new Error('internal'), { status: 500 })).responseStatus, 500);
  assert.equal(classifyGroqError(Object.assign(new Error('bad gateway'), { status: 502 })).responseStatus, 502);
  assert.equal(classifyGroqError(Object.assign(new Error('unavailable'), { status: 503 })).responseStatus, 503);
  assert.equal(classifyGroqError(Object.assign(new Error('gateway timeout'), { status: 504 })).errorCode, 'GROQ_TIMEOUT');
  assert.equal(classifyGroqError(new TypeError('fetch failed')).kind, 'network');
});

test('Groq model must be explicitly configured and request timeout is bounded', () => {
  assert.equal(getGroqModel('  llama-model  '), 'llama-model');
  assert.throws(() => getGroqModel('  '), /GROQ_MODEL_MISSING/);
  assert.equal(GROQ_REQUEST_TIMEOUT_MS, 10_000);
  assert.equal(GROQ_MAX_ATTEMPTS, 2);
});

test('Groq sends JSON mode and retries one transient 503 only once', async () => {
  const previousKey = process.env.GROQ_API_KEY;
  const previousModel = process.env.GROQ_MODEL;
  const previousFetch = globalThis.fetch;
  process.env.GROQ_API_KEY = 'test-groq-key';
  process.env.GROQ_MODEL = 'test-model';
  let attempts = 0;
  globalThis.fetch = async (input, init) => {
    attempts++;
    assert.equal(input, GROQ_CHAT_COMPLETIONS_URL);
    const payload = JSON.parse(String(init?.body)) as { model: string; response_format: { type: string } };
    assert.equal(payload.model, 'test-model');
    assert.deepEqual(payload.response_format, { type: 'json_object' });
    return attempts === 1
      ? new Response('temporary', { status: 503 })
      : Response.json({ choices: [{ message: { content: '{"recommendations":[]}' } }] });
  };
  try {
    assert.equal(await generateGroqJson('test prompt', 100), '{"recommendations":[]}');
    assert.equal(attempts, 2);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = previousKey;
    if (previousModel === undefined) delete process.env.GROQ_MODEL;
    else process.env.GROQ_MODEL = previousModel;
  }
});

test('Groq does not retry rate-limited requests', async () => {
  const previousKey = process.env.GROQ_API_KEY;
  const previousModel = process.env.GROQ_MODEL;
  const previousFetch = globalThis.fetch;
  process.env.GROQ_API_KEY = 'test-groq-key';
  process.env.GROQ_MODEL = 'test-model';
  let attempts = 0;
  globalThis.fetch = async () => {
    attempts++;
    return new Response('{"error":{"message":"rate limit exceeded"}}', { status: 429 });
  };
  try {
    await assert.rejects(generateGroqJson('test prompt', 100), error => classifyGroqError(error).kind === 'rate_limited');
    assert.equal(attempts, 1);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = previousKey;
    if (previousModel === undefined) delete process.env.GROQ_MODEL;
    else process.env.GROQ_MODEL = previousModel;
  }
});

test('Groq provider diagnostics redact API keys and user-provided sensitive values', () => {
  const prompt = 'private plan request';
  const apiKey = 'gsk_012345678901234567890123456789';
  const error = new Error(JSON.stringify({ error: {
    code: 'invalid_request',
    message: `Invalid request for ${prompt}, key ${apiKey}, user@example.com`
  } }));
  const details = getSafeGroqErrorDetails(error, [prompt, apiKey]);
  assert.equal(details.code, 'invalid_request');
  assert.doesNotMatch(details.message, /private plan request|gsk_|user@example\.com/);
  assert.match(details.message, /\[redacted-email\]/);
});