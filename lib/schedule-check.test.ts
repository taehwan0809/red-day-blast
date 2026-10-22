import test from 'node:test';
import assert from 'node:assert/strict';
import { detectTimeOverlaps, makeTravelIssue, safeAiSuggestions, validateSchedules, type ScheduleInput } from './schedule-check';

const schedule = (id: string, start: string, end: string, date = '2026-10-23'): ScheduleInput => ({
  id, title: id, startDate: date, startTime: start, endDate: date, endTime: end,
  placeName: '', address: '', placeId: '', memo: ''
});
const validSuggestion = (id = 'a') => ({
  scheduleIds: [id], title: '시간 변경', reason: '충분한 여유를 둡니다.', benefit: '이동 여유', drawback: '일정이 늦어집니다.',
  proposedStartDate: '2026-10-23', proposedStartTime: '12:00', proposedEndDate: '2026-10-23', proposedEndTime: '13:00', proposedPlaceName: ''
});

test('실제로 겹치는 일정은 서버 충돌로 검출하고 경계가 맞닿는 일정은 겹치지 않는다', () => {
  assert.equal(detectTimeOverlaps([schedule('a', '10:00', '11:00'), schedule('b', '10:59', '12:00')], 'now').length, 1);
  assert.equal(detectTimeOverlaps([schedule('a', '10:00', '11:00'), schedule('b', '11:00', '12:00')], 'now').length, 0);
});
test('자정 경계를 넘는 일정도 다음 날짜 일정과 실제 시간이 겹치면 검출한다', () => {
  const overnight = { ...schedule('a', '23:00', '02:00'), endDate: '2026-10-24' };
  assert.equal(detectTimeOverlaps([overnight, schedule('b', '01:30', '03:00', '2026-10-24')], 'now').length, 1);
});
test('확보 시간이 실제 이동 예상보다 짧을 때만 이동 위험을 만든다', () => {
  assert.equal(makeTravelIssue(schedule('a', '10:00', '11:30'), schedule('b', '12:00', '13:00'), 40, 'now')?.availableMinutes, 30);
  assert.equal(makeTravelIssue(schedule('a', '10:00', '11:30'), schedule('b', '12:00', '13:00'), 30, 'now'), null);
});
test('잘못된 날짜 및 종료 시각 역전 입력은 거부한다', () => {
  const base = schedule('a', '10:00', '11:00');
  assert.match(validateSchedules([{ ...base, startDate: '2026-02-30' }]).error ?? '', /날짜/);
  assert.match(validateSchedules([{ ...base, endTime: '09:00' }]).error ?? '', /종료 시각/);
});
test('Place 정보 누락은 입력 검증을 막지 않고, Routes 추정은 없는 출발지를 만들지 않는다', () => {
  const parsed = validateSchedules([schedule('a', '10:00', '11:00')]);
  assert.equal(parsed.schedules?.length, 1);
});
test('AI가 알려지지 않은 일정 ID, 날짜, 장소 또는 다른 일정과 충돌하는 시간을 제안하면 거부한다', () => {
  const input = [schedule('a', '10:00', '11:00'), schedule('b', '13:00', '14:00')];
  assert.throws(() => safeAiSuggestions({ suggestions: [validSuggestion('missing')] }, input), /알 수 없/);
  assert.throws(() => safeAiSuggestions({ suggestions: [{ ...validSuggestion(), proposedStartDate: '2026-12-25' }] }, input), /날짜/);
  assert.throws(() => safeAiSuggestions({ suggestions: [{ ...validSuggestion(), proposedPlaceName: '검증하지 않은 장소' }] }, input), /장소/);
  assert.throws(() => safeAiSuggestions({ suggestions: [{ ...validSuggestion(), proposedStartTime: '13:30', proposedEndTime: '14:30' }] }, input), /겹쳐/);
});
test('검증된 AI 대안은 데이터만 반환하고 원래 사용 일정 입력을 변경하지 않는다', () => {
  const input = [schedule('a', '10:00', '11:00')];
  const before = structuredClone(input);
  const result = safeAiSuggestions({ suggestions: [validSuggestion()] }, input);
  assert.equal(result[0].proposedStartTime, '12:00');
  assert.deepEqual(input, before);
});
