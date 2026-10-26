import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyGeminiError } from './gemini-errors';
import { DEFAULT_GEMINI_MODEL, getGeminiModel } from './gemini';

test('Gemini quota, rate limit and temporary failures have distinct user-safe classifications', () => {
  assert.equal(classifyGeminiError(Object.assign(new Error('Invalid key'), { status: 401 })).errorCode, 'GEMINI_AUTHENTICATION_FAILED');
  assert.equal(classifyGeminiError(Object.assign(new Error('Forbidden'), { status: 403 })).errorCode, 'GEMINI_ACCESS_DENIED');
  assert.equal(classifyGeminiError(Object.assign(new Error('Not found'), { status: 404 })).errorCode, 'GEMINI_MODEL_UNAVAILABLE');
  assert.equal(classifyGeminiError(Object.assign(new Error('RESOURCE_EXHAUSTED: quota exceeded'), { status: 429 })).errorCode, 'GEMINI_QUOTA_EXCEEDED');
  assert.equal(classifyGeminiError(Object.assign(new Error('Too many requests'), { status: 429 })).errorCode, 'GEMINI_RATE_LIMITED');
  assert.equal(classifyGeminiError(Object.assign(new Error('Service unavailable'), { status: 503 })).responseStatus, 503);
  assert.equal(classifyGeminiError(Object.assign(new Error('Gateway timeout'), { status: 504 })).errorCode, 'GEMINI_TIMEOUT');
  assert.equal(classifyGeminiError(Object.assign(new Error('Internal error'), { status: 500 })).kind, 'temporarily_unavailable');
  assert.equal(classifyGeminiError(Object.assign(new Error('Request timeout'), { name: 'TimeoutError' })).responseStatus, 504);
});

test('Gemini model can be overridden and defaults to the documented free-tier Flash model', () => {
  assert.equal(getGeminiModel('  gemini-custom  '), 'gemini-custom');
  assert.equal(getGeminiModel('  '), DEFAULT_GEMINI_MODEL);
  assert.equal(DEFAULT_GEMINI_MODEL, 'gemini-3.8-flash');
});