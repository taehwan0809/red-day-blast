import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPlannerCandidates, resolvePlannerRecommendations, validateExistingPlanRanges } from './ai-planner';
import { HOLIDAYS } from './holidays';

test('candidate dates and leave days come from the verified calendar, not the model', () => {
  const candidates = buildPlannerCandidates(2026, 12, 2, 4, HOLIDAYS[2026], '2026-10-26', [],);
  const fourDayPlan = candidates.find(candidate => candidate.startDate === '2026-12-25' && candidate.endDate === '2026-12-28');
  assert.ok(fourDayPlan);
  assert.equal(fourDayPlan.totalRestDays, 4);
  assert.equal(fourDayPlan.requiredLeaveDays, 1);
  assert.deepEqual(fourDayPlan.leaveDates, ['2026-12-28']);
});

test('existing plan ranges are validated and candidate conflicts are marked', () => {
  assert.deepEqual(validateExistingPlanRanges([{ start: '2026-12-26', end: '2026-12-27' }]), [{ start: '2026-12-26', end: '2026-12-27' }]);
  assert.equal(validateExistingPlanRanges([{ start: '2026-02-30', end: '2026-03-01' }]), null);
  const candidates = buildPlannerCandidates(2026, 12, 1, 4, HOLIDAYS[2026], '2026-10-26', [{ start: '2026-12-27', end: '2026-12-28' }]);
  assert.equal(candidates.find(candidate => candidate.startDate === '2026-12-25' && candidate.endDate === '2026-12-28')?.conflictsWithExistingPlan, true);
});

test('model explanations can only reference known candidates and valid structured fields', () => {
  const [candidate] = buildPlannerCandidates(2026, 12, 1, 4, HOLIDAYS[2026], '2026-10-26', []);
  const recommendation = {
    candidateId: candidate.candidateId,
    title: '성탄절 연휴 휴식',
    description: '공휴일과 주말에 이어 쉬는 일정입니다.',
    reason: '짧은 연차로 여러 날 쉴 수 있습니다.',
    advantages: '이동 없이 휴식할 수 있습니다.',
    disadvantages: '연말이라 개인 일정과 겹칠 수 있습니다.'
  };
  const [resolved] = resolvePlannerRecommendations(JSON.stringify({ recommendations: [recommendation] }), [candidate]);
  assert.equal(resolved.startDate, candidate.startDate);
  assert.equal(resolved.requiredLeaveDays, candidate.requiredLeaveDays);
  assert.throws(() => resolvePlannerRecommendations(JSON.stringify({ recommendations: [{ ...recommendation, candidateId: 'unknown' }] }), [candidate]), /unknown_candidate/);
  assert.throws(() => resolvePlannerRecommendations(JSON.stringify({ recommendations: [{ ...recommendation, reason: '2026년 12월 25일부터 쉬어요.' }] }), [candidate]), /unverified_date/);
});