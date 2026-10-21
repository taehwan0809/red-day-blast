import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyGeminiError, sanitizeGeminiErrorMessage, withOneTransientRetry } from './gemini-errors';

test('Gemini provider HTTP failures map to distinct safe response categories', () => {
  assert.equal(classifyGeminiError(Object.assign(new Error('Bad request'), { status: 400 })).errorCode, 'GEMINI_REQUEST_REJECTED');
  assert.equal(classifyGeminiError(Object.assign(new Error('API key not valid'), { status: 400 })).errorCode, 'GEMINI_AUTH_FAILED');
  assert.equal(classifyGeminiError(Object.assign(new Error('Unauthorized'), { status: 401 })).responseStatus, 503);
  assert.equal(classifyGeminiError(Object.assign(new Error('Permission denied'), { status: 403 })).errorCode, 'GEMINI_AUTH_FAILED');
  assert.equal(classifyGeminiError(Object.assign(new Error('Model not found'), { status: 404 })).errorCode, 'GEMINI_MODEL_UNAVAILABLE');
  assert.equal(classifyGeminiError(Object.assign(new Error('Model gemini-2.5-flash not found'), { status: 400 })).errorCode, 'GEMINI_MODEL_UNAVAILABLE');
  assert.equal(classifyGeminiError(Object.assign(new Error('Quota exceeded'), { status: 429 })).responseStatus, 429);
  assert.equal(classifyGeminiError(Object.assign(new Error('Internal error'), { status: 500 })).errorCode, 'GEMINI_INTERNAL_ERROR');
  assert.equal(classifyGeminiError(Object.assign(new Error('Unavailable'), { status: 503 })).errorCode, 'GEMINI_SERVICE_UNAVAILABLE');
  assert.equal(classifyGeminiError(new Error('Request timed out')).responseStatus, 504);
});

test('Gemini provider log messages redact API keys, URL keys, and email addresses', () => {
  const safe = sanitizeGeminiErrorMessage('key=secret-token user@example.com', 'secret-token');
  assert.equal(safe.includes('secret-token'), false);
  assert.equal(safe.includes('user@example.com'), false);
  assert.match(safe, /redacted/);
});

test('only 500/503 provider failures are retried once', async () => {
  let operationCount = 0;
  let retryCount = 0;
  const result = await withOneTransientRetry(
    async () => {
      operationCount++;
      if (operationCount === 1) throw Object.assign(new Error('temporary'), { status: 503 });
      return 'ok';
    },
    () => { retryCount++; },
    async () => {}
  );
  assert.equal(result, 'ok');
  assert.equal(operationCount, 2);
  assert.equal(retryCount, 1);

  operationCount = 0;
  await assert.rejects(withOneTransientRetry(async () => {
    operationCount++;
    throw Object.assign(new Error('bad request'), { status: 400 });
  }, () => { retryCount++; }, async () => {}));
  assert.equal(operationCount, 1);
  assert.equal(retryCount, 1);
});
