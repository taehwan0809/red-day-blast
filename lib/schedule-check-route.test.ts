import test from 'node:test';
import assert from 'node:assert/strict';
import { POST } from '../app/api/schedule-check/analyze/route';

test('without Google Maps and GPT keys the API still returns deterministic overlap checks and configuration states', async () => {
  const oldMaps = process.env.GOOGLE_MAPS_API_KEY;
  const oldGpt = process.env.GPT_API_KEY;
  delete process.env.GOOGLE_MAPS_API_KEY;
  delete process.env.GPT_API_KEY;
  try {
    const schedules = [
      { id:'a', title:'첫 일정', startDate:'2026-10-23', startTime:'10:00', endDate:'2026-10-23', endTime:'11:30', placeName:'', address:'', placeId:'', memo:'' },
      { id:'b', title:'두 번째 일정', startDate:'2026-10-23', startTime:'11:00', endDate:'2026-10-23', endTime:'12:00', placeName:'', address:'', placeId:'', memo:'' }
    ];
    const response = await POST(new Request('http://localhost/api/schedule-check/analyze', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ schedules }) }));
    const data = await response.json();
    assert.equal(response.status, 200);
    assert.equal(data.counts.conflicts, 1);
    assert.equal(data.places[0].status, 'not_configured');
    assert.equal(data.aiStatus, 'not_configured');
    assert.ok(data.issues.some((issue: { type:string }) => issue.type === 'time_overlap'));
  } finally {
    if (oldMaps === undefined) delete process.env.GOOGLE_MAPS_API_KEY; else process.env.GOOGLE_MAPS_API_KEY = oldMaps;
    if (oldGpt === undefined) delete process.env.GPT_API_KEY; else process.env.GPT_API_KEY = oldGpt;
  }
});

test('invalid schedule dates are rejected before analysis', async () => {
  const response = await POST(new Request('http://localhost/api/schedule-check/analyze', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ schedules:[{ id:'a',title:'잘못된 날짜',startDate:'2026-02-30',startTime:'10:00',endDate:'2026-02-30',endTime:'11:00',placeName:'',address:'',placeId:'',memo:'' }] }) }));
  assert.equal(response.status, 400);
});
