import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyGptOutputError, classifyOpenAiError } from './openai-errors';
import { DEFAULT_GPT_MODEL, getGptModel } from './gpt-config';

test('OpenAI API failures have safe and distinct client classifications', () => {
  assert.equal(classifyOpenAiError(Object.assign(new Error('Unauthorized'), { status: 401 })).errorCode, 'GPT_AUTHENTICATION_FAILED');
  assert.equal(classifyOpenAiError(Object.assign(new Error('Forbidden'), { status: 403 })).errorCode, 'GPT_ACCESS_DENIED');
  assert.equal(classifyOpenAiError(Object.assign(new Error('Not found'), { status: 404 })).errorCode, 'GPT_MODEL_UNAVAILABLE');
  assert.equal(classifyOpenAiError(Object.assign(new Error('Rate limited'), { status: 429 })).responseStatus, 429);
  assert.equal(classifyOpenAiError(Object.assign(new Error('timeout'), { name: 'APIConnectionTimeoutError' })).errorCode, 'GPT_TIMEOUT');
  assert.equal(classifyOpenAiError(Object.assign(new Error('Gateway timeout'), { status: 504 })).responseStatus, 504);
  assert.equal(classifyOpenAiError(Object.assign(new Error('Service unavailable'), { status: 503 })).responseStatus, 503);
  assert.equal(classifyOpenAiError(Object.assign(new Error('Bad request'), { status: 400 })).responseStatus, 502);
  assert.equal(classifyOpenAiError(new Error('connection')).errorCode, 'GPT_ANALYSIS_FAILED');
});

test('invalid and schema-mismatched model output is never treated as success', () => {
  assert.equal(classifyGptOutputError(new Error('AI response is not valid JSON')).errorCode, 'GPT_RESPONSE_JSON_INVALID');
  assert.equal(classifyGptOutputError(new Error('AI returned an empty response')).errorCode, 'GPT_RESPONSE_INVALID');
});

test('server model is configurable with a supported cost-efficient default', () => {
  assert.equal(getGptModel('  gpt-custom  '), 'gpt-custom');
  assert.equal(getGptModel('  '), DEFAULT_GPT_MODEL);
  assert.equal(DEFAULT_GPT_MODEL, 'gpt-6-luna');
});
