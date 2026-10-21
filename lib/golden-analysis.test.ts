import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGoldenAnalysisContext, isGeminiRateLimitError, resolveGeminiRecommendations, validateSelectedLeaveDates } from './golden-analysis';
import { HOLIDAYS, mergeHolidayData } from './holidays';
import type { HolidayData } from './holiday-service';

const holidayData: HolidayData = {
  year: 2026,
  holidays: mergeHolidayData(HOLIDAYS[2026], [{ date: '2026-10-01', name: '국군의날', kind: 'national' }]),
  source: 'test official data',
  status: 'official',
  updatedAt: '2026-01-01T00:00:00.000Z',
  googleStatus: 'ok'
};

test('analysis context uses server holiday data and calculates natural and 1-3 day leave options', () => {
  const context = buildGoldenAnalysisContext(holidayData);
  assert.equal(context.holidays.some(holiday => holiday.date === '2026-10-01'), false);
  assert.ok(context.naturalBreaks.some(period => period.startDate === '2026-02-14' && period.totalRestDays === 5));
  assert.ok(context.leaveOptions[1].every(option => option.requiredLeaveDays === 1));
  assert.ok(context.leaveOptions[2].every(option => option.requiredLeaveDays === 2));
  assert.ok(context.leaveOptions[3].every(option => option.requiredLeaveDays === 3));
  assert.ok(context.leaveOptions[1].length > 0 && context.leaveOptions[2].length > 0 && context.leaveOptions[3].length > 0);
  const selectedContext = buildGoldenAnalysisContext(holidayData, ['2026-04-30']);
  assert.deepEqual(selectedContext.selectedLeaveDates, ['2026-04-30']);
  assert.ok(selectedContext.selectedLeavePlans.some(plan => plan.leaveDates.includes('2026-04-30')));
});

test('Gemini quota and rate-limit errors are identified for retryable responses', () => {
  assert.equal(isGeminiRateLimitError({ status: 429 }), true);
  assert.equal(isGeminiRateLimitError({ code: 'RESOURCE_EXHAUSTED' }), true);
  assert.equal(isGeminiRateLimitError(new Error('network failure')), false);
});

test('selected leave dates must be unique weekdays that are not holidays', () => {
  assert.equal(validateSelectedLeaveDates(2026, ['2026-04-30'], holidayData.holidays), null);
  assert.match(validateSelectedLeaveDates(2026, ['2026-02-14'], holidayData.holidays) ?? '', /평일 근무일/);
  assert.match(validateSelectedLeaveDates(2026, ['2026-02-16'], holidayData.holidays) ?? '', /평일 근무일/);
  assert.match(validateSelectedLeaveDates(2026, ['2025-04-30'], holidayData.holidays) ?? '', /분석 연도/);
  assert.match(validateSelectedLeaveDates(2026, ['2026-04-30', '2026-04-30'], holidayData.holidays) ?? '', /중복/);
});

test('Gemini may explain only server-calculated candidate IDs and cannot invent dates', () => {
  const context = buildGoldenAnalysisContext(holidayData);
  const candidate = context.leaveOptions[1][0];
  const response = JSON.stringify({ recommendations: [{
    candidateId: candidate.candidateId,
    reason: '공휴일과 주말에 붙여 긴 휴식을 만들 수 있어요.',
    efficiencyAdvice: '연차 하루로 총 휴일 수를 늘릴 수 있어요.',
    activitySuggestion: '가까운 지역에서 짧은 여행을 계획해 보세요.'
  }] });
  const [result] = resolveGeminiRecommendations(response, [...context.naturalBreaks, ...context.leaveOptions[1]]);
  assert.equal(result.startDate, candidate.startDate);
  assert.equal(result.endDate, candidate.endDate);
  assert.equal(result.totalRestDays, candidate.totalRestDays);
  assert.equal(result.requiredLeaveDays, candidate.leaveDates.length);
  assert.throws(() => resolveGeminiRecommendations(response.replace(candidate.candidateId, 'invented-id'), [candidate]), /unknown/);
  assert.throws(() => resolveGeminiRecommendations(response.replace('공휴일과 주말에 붙여 긴 휴식을 만들 수 있어요.', '2026-10-01부터 추천해요.'), [candidate]), /unverified date/);
  assert.throws(() => resolveGeminiRecommendations('{not json', [candidate]), /valid JSON/);
});
