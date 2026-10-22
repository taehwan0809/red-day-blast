export type ScheduleInput = {
  id: string; title: string; startDate: string; startTime: string;
  endDate: string; endTime: string; placeName: string; address: string;
  placeId: string; memo: string;
};
export type ScheduleIssue = {
  id: string; type: 'time_overlap' | 'travel_time' | 'business_hours' | 'holiday_hours' | 'booking';
  scheduleIds: string[]; level: 'high' | 'medium' | 'info'; reason: string;
  source: string; checkedAt: string; suggestion: string;
  availableMinutes?: number; travelMinutes?: number;
};
export type SchedulePlace = {
  scheduleId: string; status: 'found' | 'not_found' | 'not_configured' | 'quota_exceeded' | 'timeout' | 'access_denied' | 'error';
  placeId?: string; name?: string; address?: string; website?: string; phone?: string;
  mapsUrl?: string; regularOpeningHours?: unknown;
  businessStatus?: 'likely_open' | 'hours_mismatch' | 'hours_unknown' | 'holiday_check';
  bookingStatus: 'unavailable';
};
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const dayNumber = (date: string) => {
  const [year, month, day] = date.split('-').map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
};
export function validDateKey(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}
export function validateSchedules(value: unknown): { schedules?: ScheduleInput[]; error?: string } {
  if (!Array.isArray(value) || value.length === 0 || value.length > 50) return { error: '일정은 1개 이상 50개 이하로 선택해 주세요.' };
  const ids = new Set<string>(); const schedules: ScheduleInput[] = [];
  const fields = ['id','title','startDate','startTime','endDate','endTime','placeName','address','placeId','memo'] as const;
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') return { error: '일정 입력 형식이 올바르지 않아요.' };
    const item = raw as Record<string, unknown>;
    if (fields.some(field => typeof item[field] !== 'string')) return { error: '일정의 필수 입력값을 확인해 주세요.' };
    const schedule = Object.fromEntries(fields.map(field => [field, (item[field] as string).trim()])) as ScheduleInput;
    if (!schedule.id || schedule.id.length > 80 || ids.has(schedule.id)) return { error: '일정 ID가 유효하지 않아요.' };
    ids.add(schedule.id);
    if (!schedule.title || schedule.title.length > 100 || schedule.placeName.length > 120 || schedule.address.length > 300 || schedule.placeId.length > 200 || schedule.memo.length > 1000) return { error: '일정 이름, 장소 또는 메모의 길이를 확인해 주세요.' };
    if (!validDateKey(schedule.startDate) || !validDateKey(schedule.endDate)) return { error: '일정 날짜가 올바르지 않아요.' };
    if (!TIME_RE.test(schedule.startTime) || !TIME_RE.test(schedule.endTime)) return { error: '시작 및 종료 시간을 확인해 주세요.' };
    const start = dayNumber(schedule.startDate) * 1440 + Number(schedule.startTime.slice(0, 2)) * 60 + Number(schedule.startTime.slice(3));
    const end = dayNumber(schedule.endDate) * 1440 + Number(schedule.endTime.slice(0, 2)) * 60 + Number(schedule.endTime.slice(3));
    if (end <= start) return { error: '종료 시각은 시작 시각보다 뒤여야 해요.' };
    if (dayNumber(schedule.endDate) - dayNumber(schedule.startDate) > 366) return { error: '일정 기간은 1년 이내로 입력해 주세요.' };
    schedules.push(schedule);
  }
  return { schedules: schedules.sort(compareSchedules) };
}
export function compareSchedules(a: ScheduleInput, b: ScheduleInput) {
  return a.startDate.localeCompare(b.startDate) || a.startTime.localeCompare(b.startTime) || a.id.localeCompare(b.id);
}
const startMinute = (s: ScheduleInput) => dayNumber(s.startDate) * 1440 + Number(s.startTime.slice(0, 2)) * 60 + Number(s.startTime.slice(3));
const endMinute = (s: ScheduleInput) => dayNumber(s.endDate) * 1440 + Number(s.endTime.slice(0, 2)) * 60 + Number(s.endTime.slice(3));
export function detectTimeOverlaps(schedules: ScheduleInput[], checkedAt: string): ScheduleIssue[] {
  const sorted = [...schedules].sort(compareSchedules); const issues: ScheduleIssue[] = [];
  for (let i = 0; i < sorted.length; i++) for (let j = i + 1; j < sorted.length && startMinute(sorted[j]) < endMinute(sorted[i]); j++) {
    issues.push({ id: 'overlap:' + sorted[i].id + ':' + sorted[j].id, type: 'time_overlap', scheduleIds: [sorted[i].id, sorted[j].id], level: 'high', reason: '“' + sorted[i].title + '”과 “' + sorted[j].title + '”의 일정 시간이 겹칩니다.', source: '서버 일정 시간 계산', checkedAt, suggestion: '두 일정 중 하나의 시간이나 날짜를 변경해 주세요.' });
  }
  return issues;
}
export function makeTravelIssue(previous: ScheduleInput, next: ScheduleInput, travelMinutes: number, checkedAt: string): ScheduleIssue | null {
  const available = startMinute(next) - endMinute(previous);
  if (available < 0 || travelMinutes <= available) return null;
  return { id: 'travel:' + previous.id + ':' + next.id, type: 'travel_time', scheduleIds: [previous.id, next.id], level: 'medium', reason: '이동 예상 ' + travelMinutes + '분, 일정 사이 확보 시간 ' + available + '분입니다.', source: 'Google Routes API 예상 경로 시간', checkedAt, suggestion: '출발 시각을 앞당기거나 이동 경로와 장소를 확인해 주세요.', availableMinutes: available, travelMinutes };
}
export function safeAiSuggestions(value: unknown, schedules: ScheduleInput[]) {
  if (!value || typeof value !== 'object' || !Array.isArray((value as { suggestions?: unknown }).suggestions)) throw new Error('AI 응답 형식이 올바르지 않아요.');
  const allowedIds = new Set(schedules.map(s => s.id)); const results = (value as { suggestions: unknown[] }).suggestions;
  if (results.length > 3) throw new Error('AI 대안 개수가 허용 범위를 넘었어요.');
  return results.map(raw => {
    if (!raw || typeof raw !== 'object') throw new Error('AI 대안 형식이 올바르지 않아요.');
    const item = raw as Record<string, unknown>;
    if (!Array.isArray(item.scheduleIds) || item.scheduleIds.length !== 1 || !item.scheduleIds.every(id => typeof id === 'string' && allowedIds.has(id))) throw new Error('AI 대안에 알 수 없거나 여러 개인 일정 ID가 포함되어 있어요.');
    for (const field of ['title','reason','benefit','drawback'] as const) if (typeof item[field] !== 'string' || item[field].length > 500) throw new Error('AI 대안 설명이 올바르지 않아요.');
    if (typeof item.proposedStartTime !== 'string' || !TIME_RE.test(item.proposedStartTime) || typeof item.proposedEndTime !== 'string' || !TIME_RE.test(item.proposedEndTime)) throw new Error('AI 대안의 시간이 올바르지 않아요.');
    const current = schedules.find(s => s.id === (item.scheduleIds as string[])[0])!;
    if (item.proposedStartDate !== current.startDate || item.proposedEndDate !== current.endDate || item.proposedPlaceName !== current.placeName) throw new Error('대안에 허용되지 않은 날짜 또는 검증되지 않은 장소가 포함되어 있어요.');
    if ((item.proposedEndTime as string) <= (item.proposedStartTime as string)) throw new Error('대안의 종료 시각이 시작 시각보다 빠릅니다.');
    const from = dayNumber(current.startDate) * 1440 + Number((item.proposedStartTime as string).slice(0, 2)) * 60 + Number((item.proposedStartTime as string).slice(3));
    const to = dayNumber(current.endDate) * 1440 + Number((item.proposedEndTime as string).slice(0, 2)) * 60 + Number((item.proposedEndTime as string).slice(3));
    if (schedules.some(other => other.id !== current.id && startMinute(other) < to && endMinute(other) > from)) throw new Error('AI 대안이 다른 일정과 겹쳐 안전하게 적용할 수 없어요.');
    return { scheduleId: current.id, title: item.title as string, reason: item.reason as string, benefit: item.benefit as string, drawback: item.drawback as string, proposedStartDate: current.startDate, proposedStartTime: item.proposedStartTime as string, proposedEndDate: current.endDate, proposedEndTime: item.proposedEndTime as string, proposedPlaceName: item.proposedPlaceName as string };
  });
}
