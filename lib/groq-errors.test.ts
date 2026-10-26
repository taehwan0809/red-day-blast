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
  assert.equal(classifyGroqError(Object.assign(new Error('json_validate_failed'), { status: 400 })).errorCode, 'GROQ_JSON_GENERATION_FAILED');
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
    const payload = JSON.parse(String(init?.body)) as { model: string; response_format: { type: string }; max_completion_tokens: number; reasoning_effort?: string; max_tokens?: number };
    assert.equal(payload.model, 'test-model');
    assert.deepEqual(payload.response_format, { type: 'json_object' });
    assert.equal(payload.max_completion_tokens, 100);
    assert.equal(payload.max_tokens, undefined);
    assert.equal(payload.reasoning_effort, undefined);
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

test('Groq uses low reasoning effort for gpt-oss and the supported completion token limit field', async () => {
  const previousKey = process.env.GROQ_API_KEY;
  const previousModel = process.env.GROQ_MODEL;
  const previousFetch = globalThis.fetch;
  process.env.GROQ_API_KEY = 'test-groq-key';
  process.env.GROQ_MODEL = 'openai/gpt-oss-20b';
  globalThis.fetch = async (_input, init) => {
    const payload = JSON.parse(String(init?.body)) as { model: string; response_format: { type: string }; max_completion_tokens: number; reasoning_effort?: string; max_tokens?: number };
    assert.equal(payload.model, 'openai/gpt-oss-20b');
    assert.deepEqual(payload.response_format, { type: 'json_object' });
    assert.equal(payload.reasoning_effort, 'low');
    assert.equal(payload.max_completion_tokens, 3000);
    assert.equal(payload.max_tokens, undefined);
    return Response.json({ choices: [{ message: { content: '{"recommendations":[]}' } }] });
  };
  try {
    assert.equal(await generateGroqJson('JSON response test', 3000), '{"recommendations":[]}');
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.GROQ_API_KEY; else process.env.GROQ_API_KEY = previousKey;
    if (previousModel === undefined) delete process.env.GROQ_MODEL; else process.env.GROQ_MODEL = previousModel;
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

test('empty failed_generation remains distinguishable from a missing field without logging raw response text', () => {
  const error = new Error(JSON.stringify({ error: {
    type: 'invalid_request_error',
    code: 'json_validate_failed',
    message: 'Failed to validate JSON. Please adjust your prompt.',
    failed_generation: ''
  } }));
  const details = getSafeGroqErrorDetails(error, ['private user request']);
  assert.equal(details.type, 'invalid_request_error');
  assert.equal(details.message, 'Failed to validate JSON. Please adjust your prompt.');
  assert.deepEqual(details.responseShape, {
    isJson: true,
    topLevelType: 'object',
    hasError: true,
    errorIsObject: true,
    errorFields: ['code', 'type', 'message', 'failed_generation'],
    failedGenerationType: 'string',
    failedGenerationLength: 0,
    failedGenerationEmpty: true
  });
  assert.equal(details.failedGeneration, '');
  assert.doesNotMatch(JSON.stringify(details), /private user request/);
});

test('failed_generation is reduced to a bounded, redacted structure preview', () => {
  const prompt = 'private plan request';
  const failedGeneration = '{"recommendations":[{"candidateId":"candidate-2026-01-01","title":"홍길동 010-1234-5678","reason":"private plan request"}]}';
  const error = Object.assign(new Error(JSON.stringify({ error: {
    code: 'json_validate_failed', message: 'Failed to validate JSON.', failed_generation: failedGeneration
  } })), { status: 400 });
  const details = getSafeGroqErrorDetails(error, [prompt]);
  assert.equal(details.code, 'json_validate_failed');
  assert.ok(details.failedGeneration);
  assert.ok(details.failedGeneration!.length <= 400);
  assert.match(details.failedGeneration!, /recommendations/);
  assert.doesNotMatch(details.failedGeneration!, /홍길동|010-1234-5678|private plan request|candidate-2026/);
});