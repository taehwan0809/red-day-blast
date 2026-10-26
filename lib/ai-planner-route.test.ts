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

test('AI planner requests bounded JSON Object output and validates the matching field shape', async () => {
  const previousKey = process.env.GROQ_API_KEY;
  const previousModel = process.env.GROQ_MODEL;
  const previousKasiKey = process.env.KASI_SERVICE_KEY;
  const previousGoogleKey = process.env.GOOGLE_CALENDAR_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.GROQ_API_KEY = 'test-key-not-used';
  process.env.GROQ_MODEL = 'test-model';
  delete process.env.KASI_SERVICE_KEY;
  delete process.env.GOOGLE_CALENDAR_API_KEY;
  let requestBody: Record<string, unknown> | undefined;
  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return Response.json({ choices: [{ message: { content: JSON.stringify({ recommendations: [{
      candidateId: '2026-12-25:2026-12-28',
      title: '성탄절 연휴 휴식',
      description: '공휴일과 주말을 이어 쉬는 일정입니다.',
      reason: '연차 하루로 휴식 기간을 늘립니다.',
      advantages: '연속 4일을 쉴 수 있습니다.',
      disadvantages: '연말 약속과 겹치는지 확인하세요.'
    }] }) } }] });
  };
  try {
    const response = await POST(new Request('http://localhost/api/ai-planner/analyze', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(validRequest)
    }));
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.recommendations[0].candidateId, '2026-12-25:2026-12-28');
    assert.deepEqual(requestBody?.response_format, { type: 'json_object' });
    assert.equal(requestBody?.max_completion_tokens, 3000);
    const messages = requestBody?.messages as Array<{ content: string }>;
    assert.match(messages[1].content, /120자 이하/);
    assert.doesNotMatch(messages[1].content, /responseSchema/);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.GROQ_API_KEY; else process.env.GROQ_API_KEY = previousKey;
    if (previousModel === undefined) delete process.env.GROQ_MODEL; else process.env.GROQ_MODEL = previousModel;
    if (previousKasiKey === undefined) delete process.env.KASI_SERVICE_KEY; else process.env.KASI_SERVICE_KEY = previousKasiKey;
    if (previousGoogleKey === undefined) delete process.env.GOOGLE_CALENDAR_API_KEY; else process.env.GOOGLE_CALENDAR_API_KEY = previousGoogleKey;
  }
});

test('AI planner rejects out-of-range leave limits before external calls', async () => {
  const response = await POST(new Request('http://localhost/api/ai-planner/analyze', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...validRequest, maxLeaveDays: 8 })
  }));
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, 'INVALID_LEAVE_DAYS');
});

test('Groq JSON validation errors return a distinct response and log only redacted failed_generation structure', async () => {
  const previousKey = process.env.GROQ_API_KEY;
  const previousModel = process.env.GROQ_MODEL;
  const previousFetch = globalThis.fetch;
  const previousConsoleError = console.error;
  const apiKey = 'gsk_test_012345678901234567890123';
  let log = '';
  process.env.GROQ_API_KEY = apiKey;
  process.env.GROQ_MODEL = 'test-model';
  globalThis.fetch = async () => new Response(JSON.stringify({ error: {
    code: 'json_validate_failed',
    message: 'Failed to validate JSON. See failed_generation for more details.',
    failed_generation: '{"recommendations":[{"candidateId":"bad","title":"홍길동 010-1234-5678","reason":"12월 개인 일정"}]}'
  } }), { status: 400 });
  console.error = (...args: unknown[]) => { log += args.map(String).join(' '); };
  try {
    const response = await POST(new Request('http://localhost/api/ai-planner/analyze', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(validRequest)
    }));
    assert.equal(response.status, 502);
    assert.equal((await response.json()).error, 'GROQ_JSON_GENERATION_FAILED');
    assert.match(log, /failedGenerationPreview/);
    assert.match(log, /recommendations/);
    assert.doesNotMatch(log, /gsk_test|홍길동|010-1234-5678|12월 개인 일정|주말 포함 4일/);
  } finally {
    globalThis.fetch = previousFetch;
    console.error = previousConsoleError;
    if (previousKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = previousKey;
    if (previousModel === undefined) delete process.env.GROQ_MODEL;
    else process.env.GROQ_MODEL = previousModel;
  }
});