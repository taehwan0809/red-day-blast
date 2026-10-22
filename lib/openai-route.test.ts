import test from 'node:test';
import assert from 'node:assert/strict';
import { POST } from '../app/api/golden/analyze/route';

test('analysis route returns a safe configuration error when GPT_API_KEY is absent', async () => {
  const previousKey = process.env.GPT_API_KEY;
  delete process.env.GPT_API_KEY;
  try {
    const response = await POST(new Request('http://localhost/api/golden/analyze', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ year: 2026 })
    }));
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error, 'GPT_API_KEY_MISSING');
  } finally {
    if (previousKey === undefined) delete process.env.GPT_API_KEY;
    else process.env.GPT_API_KEY = previousKey;
  }
});
