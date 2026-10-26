import test from 'node:test';
import assert from 'node:assert/strict';
import { POST } from '../app/api/ai-planner/analyze/route';

const validRequest = {
  requestText: '12월에 주말 포함 4일 쉬고 싶어요.',
  year: 2026,
  month: 12,
  maxLeaveDays: 2,
  targetDays: 4,
  purpose: 'leave',
  additionalConditions: '',
  existingPlansAvailable: false,
  existingPlans: []
};

test('AI planner returns a clear configuration response when the Groq key is missing', async () => {
  const previousGroqKey = process.env.GROQ_API_KEY;
  const previousGroqModel = process.env.GROQ_MODEL;
  delete process.env.GROQ_API_KEY;
  delete process.env.GROQ_MODEL;
  try {
    const response = await POST(new Request('http://localhost/api/ai-planner/analyze', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(validRequest)
    }));
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error, 'GROQ_API_KEY_MISSING');
  } finally {
    if (previousGroqKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = previousGroqKey;
    if (previousGroqModel === undefined) delete process.env.GROQ_MODEL;
    else process.env.GROQ_MODEL = previousGroqModel;
  }
});

test('AI planner requires an explicitly selected Groq model', async () => {
  const previousKey = process.env.GROQ_API_KEY;
  const previousModel = process.env.GROQ_MODEL;
  process.env.GROQ_API_KEY = 'test-key-not-used';
  delete process.env.GROQ_MODEL;
  try {
    const response = await POST(new Request('http://localhost/api/ai-planner/analyze', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(validRequest)
    }));
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error, 'GROQ_MODEL_MISSING');
  } finally {
    if (previousKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = previousKey;
    if (previousModel === undefined) delete process.env.GROQ_MODEL;
    else process.env.GROQ_MODEL = previousModel;
  }
});

test('AI planner rejects out-of-range leave limits before external calls', async () => {
  const response = await POST(new Request('http://localhost/api/ai-planner/analyze', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...validRequest, maxLeaveDays: 8 })
  }));
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, 'INVALID_LEAVE_DAYS');
});