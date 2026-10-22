import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGoldenAnalysisContext, createGoldenAnalysisRequest, resolveAiRecommendations, validateSelectedLeaveDates } from './golden-analysis';
import { HOLIDAYS, mergeHolidayData } from './holidays';
import { isValidHolidayData, type HolidayData } from './holiday-service';

const holidayData: HolidayData = {
  year: 2026,
  holidays: mergeHolidayData(HOLIDAYS[2026], [{ date: '2026-10-01', name: '국군의날', kind: 'national' }]),
  source: 'test official data',
  status: 'official',
  updatedAt: '2026-01-01T00:00:00.000Z',
  googleStatus: 'ok'
};

test('holiday payload validation rejects wrong years and malformed dates but accepts an empty array for explicit handling', () => {
  assert.equal(isValidHolidayData(holidayData, 2026), true);
  assert.equal(isValidHolidayData({ ...holidayData, holidays: [] }, 2026), true);
  assert.equal(isValidHolidayData({ ...holidayData, year: 2025 }, 2026), false);
  assert.equal(isValidHolidayData({ ...holidayData, source: 1 }, 2026), false);
  assert.equal(isValidHolidayData({ ...holidayData, updatedAt: {} }, 2026), false);
  assert.equal(isValidHolidayData({ ...holidayData, holidays: [{ ...HOLIDAYS[2026][0], date: '2026-02-30' }] }, 2026), false);
  assert.equal(isValidHolidayData({ ...holidayData, holidays: [{ ...HOLIDAYS[2026][0], kind: 'weekend' }] }, 2026), false);
});

test('analysis context uses server holiday data and calculates natural and 1-3 day leave options', () => {
  const context = buildGoldenAnalysisContext(holidayData, [], '2026-01-01');
  assert.equal(context.holidays.some(holiday => holiday.date === '2026-10-01'), false);
  assert.ok(context.naturalBreaks.some(period => period.startDate === '2026-02-14' && period.totalRestDays === 5));
  assert.ok(context.leaveOptions[1].every(option => option.requiredLeaveDays === 1));
  assert.ok(context.leaveOptions[2].every(option => option.requiredLeaveDays === 2));
  assert.ok(context.leaveOptions[3].every(option => option.requiredLeaveDays === 3));
  assert.ok(context.leaveOptions[1].length > 0 && context.leaveOptions[2].length > 0 && context.leaveOptions[3].length > 0);
  const selectedContext = buildGoldenAnalysisContext(holidayData, ['2026-04-30'], '2026-01-01');
  assert.deepEqual(selectedContext.selectedLeaveDates, ['2026-04-30']);
  assert.ok(selectedContext.selectedLeavePlans.some(plan => plan.leaveDates.includes('2026-04-30')));
});

test('selected leave dates must be unique weekdays that are not holidays', () => {
  assert.equal(validateSelectedLeaveDates(2026, ['2026-04-30'], holidayData.holidays, '2026-04-01'), null);
  assert.match(validateSelectedLeaveDates(2026, ['2026-02-14'], holidayData.holidays, '2026-01-01') ?? '', /평일 근무일/);
  assert.match(validateSelectedLeaveDates(2026, ['2026-02-16'], holidayData.holidays, '2026-01-01') ?? '', /평일 근무일/);
  assert.match(validateSelectedLeaveDates(2026, ['2025-04-30'], holidayData.holidays, '2025-01-01') ?? '', /분석 연도/);
  assert.match(validateSelectedLeaveDates(2026, ['2026-04-30', '2026-04-30'], holidayData.holidays, '2026-01-01') ?? '', /중복/);
});

test('AI may explain only server-calculated candidate IDs and cannot invent dates', () => {
  const context = buildGoldenAnalysisContext(holidayData, [], '2026-01-01');
  const candidate = context.leaveOptions[1][0];
  const response = JSON.stringify({ recommendations: [{
    candidateId: candidate.candidateId,
    reason: '공휴일과 주말에 붙여 긴 휴식을 만들 수 있어요.',
    efficiencyAdvice: '연차 하루로 총 휴일 수를 늘릴 수 있어요.',
    activitySuggestion: '가까운 지역에서 짧은 여행을 계획해 보세요.'
  }] });
  const [result] = resolveAiRecommendations(response, [...context.naturalBreaks, ...context.leaveOptions[1]]);
  assert.equal(result.startDate, candidate.startDate);
  assert.equal(result.endDate, candidate.endDate);
  assert.equal(result.totalRestDays, candidate.totalRestDays);
  assert.equal(result.requiredLeaveDays, candidate.leaveDates.length);
  assert.throws(() => resolveAiRecommendations(response.replace(candidate.candidateId, 'invented-id'), [candidate]), /unknown/);
  assert.throws(() => resolveAiRecommendations(response.replace('공휴일과 주말에 붙여 긴 휴식을 만들 수 있어요.', '2026-10-01부터 추천해요.'), [candidate]), /unverified date/);
  assert.throws(() => resolveAiRecommendations('{not json', [candidate]), /valid JSON/);
  assert.throws(() => resolveAiRecommendations(undefined, [candidate]), /empty response/);
});

test('analysis candidates exclude periods and leave dates before the Seoul analysis date before sorting', () => {
  const beforeAutumn = buildGoldenAnalysisContext(holidayData, [], '2026-10-01');
  const onAutumn = buildGoldenAnalysisContext(holidayData, [], '2026-10-22');
  assert.ok(beforeAutumn.naturalBreaks.some(item => item.startDate === '2026-10-03'));
  assert.ok(!onAutumn.naturalBreaks.some(item => item.startDate < '2026-10-22'));
  assert.ok(!Object.values(onAutumn.leaveOptions).flat().some(item => item.startDate < '2026-10-22' || item.leaveDates.some(date => date < '2026-10-22')));
  assert.ok(onAutumn.naturalBreaks.every((item, index, items) => index === 0 || items[index - 1].totalRestDays >= item.totalRestDays));
});

test('selected leave dates and a distinct analysis date are passed exactly in the request payload', () => {
  assert.deepEqual(createGoldenAnalysisRequest(2026, '2026-10-22', ['2026-10-22']), {
    year: 2026, analysisDate: '2026-10-22', selectedLeaveDates: ['2026-10-22']
  });
});

test('past selected vacation days are rejected against the analysis date', () => {
  assert.match(validateSelectedLeaveDates(2026, ['2026-04-30'], holidayData.holidays, '2026-10-22') ?? '', /지난 날짜/);
  assert.equal(validateSelectedLeaveDates(2026, ['2026-10-22'], holidayData.holidays, '2026-10-22'), null);
});
