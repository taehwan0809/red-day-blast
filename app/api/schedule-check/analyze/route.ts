import { NextResponse } from 'next/server';
import { generateGeminiJson } from '@/lib/gemini';
import { classifyGeminiError } from '@/lib/gemini-errors';
import { getHolidayData } from '@/lib/holiday-service';
import { compareSchedules, detectTimeOverlaps, makeTravelIssue, safeAiSuggestions, validateSchedules, type ScheduleInput, type ScheduleIssue, type SchedulePlace } from '@/lib/schedule-check';

export const runtime = 'nodejs';
export const maxDuration = 30;

type GooglePlace = { id?: string; displayName?: { text?: string }; formattedAddress?: string; websiteUri?: string; nationalPhoneNumber?: string; googleMapsUri?: string; regularOpeningHours?: { periods?: Array<{ open?: { day?: number; hour?: number; minute?: number }; close?: { day?: number; hour?: number; minute?: number } }>; weekdayDescriptions?: string[] } };
const checkedAt = () => new Date().toISOString();
const scheduleMoment = (s: ScheduleInput) => s.startDate + 'T' + s.startTime;
const businessState = (place: GooglePlace, schedule: ScheduleInput, holidays: Set<string>): SchedulePlace['businessStatus'] => {
  if (holidays.has(schedule.startDate)) return 'holiday_check';
  const hours = place.regularOpeningHours?.periods;
  if (!hours?.length) return 'hours_unknown';
  const date = new Date(schedule.startDate + 'T12:00:00+09:00');
  const weekday = date.getUTCDay();
  const toMin = (v?: { hour?: number; minute?: number }) => (v?.hour ?? 0) * 60 + (v?.minute ?? 0);
  const start = Number(schedule.startTime.slice(0, 2)) * 60 + Number(schedule.startTime.slice(3));
  const end = Number(schedule.endTime.slice(0, 2)) * 60 + Number(schedule.endTime.slice(3));
  const open = hours.some(period => period.open?.day === weekday && toMin(period.open) <= start && period.close?.day === weekday && toMin(period.close) >= end);
  return open ? 'likely_open' : 'hours_mismatch';
};
async function lookupPlace(schedule: ScheduleInput, apiKey: string | undefined, holidays: Set<string>): Promise<SchedulePlace> {
  const base: SchedulePlace = { scheduleId: schedule.id, status: 'not_found', bookingStatus: 'unavailable' };
  if (!apiKey) return { ...base, status: 'not_configured', businessStatus: 'hours_unknown' };
  if (!schedule.placeId && !schedule.placeName.trim() && !schedule.address.trim()) return { ...base, status: 'not_found', businessStatus: 'hours_unknown' };
  const query = schedule.placeId ? { placeId: schedule.placeId } : { textQuery: [schedule.placeName, schedule.address].filter(Boolean).join(' ') };
  try {
    const response = await fetch(schedule.placeId
      ? 'https://places.googleapis.com/v1/places/' + encodeURIComponent(schedule.placeId)
      : 'https://places.googleapis.com/v1/places:searchText', {
      method: schedule.placeId ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': apiKey, 'X-Goog-FieldMask': schedule.placeId ? 'id,displayName,formattedAddress,websiteUri,nationalPhoneNumber,googleMapsUri,regularOpeningHours' : 'places.id,places.displayName,places.formattedAddress,places.websiteUri,places.nationalPhoneNumber,places.googleMapsUri,places.regularOpeningHours' },
      body: schedule.placeId ? undefined : JSON.stringify({ ...query, languageCode: 'ko', regionCode: 'KR', maxResultCount: 1 }),
      signal: AbortSignal.timeout(7000)
    });
    if (response.status === 429) return { ...base, status: 'quota_exceeded', businessStatus: 'hours_unknown' };
    if (response.status === 401 || response.status === 403) return { ...base, status: 'access_denied', businessStatus: 'hours_unknown' };
    if (response.status === 408 || response.status === 504) return { ...base, status: 'timeout', businessStatus: 'hours_unknown' };
    if (!response.ok) return { ...base, status: 'error', businessStatus: 'hours_unknown' };
    const data = await response.json() as { places?: GooglePlace[] } & GooglePlace;
    const place = schedule.placeId ? data : data.places?.[0];
    if (!place?.id) return { ...base, status: 'not_found', businessStatus: 'hours_unknown' };
    return { ...base, status: 'found', placeId: place.id, name: place.displayName?.text, address: place.formattedAddress, website: place.websiteUri, phone: place.nationalPhoneNumber, mapsUrl: place.googleMapsUri, regularOpeningHours: place.regularOpeningHours?.weekdayDescriptions, businessStatus: businessState(place, schedule, holidays) };
  } catch (error) { return { ...base, status: error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : 'error', businessStatus: 'hours_unknown' }; }
}
async function routeMinutes(origin: string, destination: string, apiKey: string): Promise<{ minutes: number | null; status: 'ok' | 'no_route' | 'quota_exceeded' | 'timeout' | 'access_denied' | 'error' }> {
  try {
    const response = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': apiKey, 'X-Goog-FieldMask': 'routes.duration' },
      body: JSON.stringify({ origin: { placeId: origin }, destination: { placeId: destination }, travelMode: 'DRIVE', routingPreference: 'TRAFFIC_AWARE', languageCode: 'ko-KR', units: 'METRIC' }),
      signal: AbortSignal.timeout(7000)
    });
    if (response.status === 429) return { minutes: null, status: 'quota_exceeded' };
    if (response.status === 401 || response.status === 403) return { minutes: null, status: 'access_denied' };
    if (response.status === 408 || response.status === 504) return { minutes: null, status: 'timeout' };
    if (!response.ok) return { minutes: null, status: 'error' };
    const data = await response.json() as { routes?: Array<{ duration?: string }> };
    const seconds = Number(data.routes?.[0]?.duration?.replace(/s$/, ''));
    return Number.isFinite(seconds) ? { minutes: Math.ceil(seconds / 60), status: 'ok' } : { minutes: null, status: 'no_route' };
  } catch (error) { return { minutes: null, status: error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : 'error' }; }
}
function suggestionSchema(ids: string[]) {
  return { type: 'object', properties: { summary: { type: 'string' }, suggestions: { type: 'array', items: { type: 'object', properties: {
    scheduleIds: { type: 'array', items: { type: 'string', enum: ids }, minItems: 1, maxItems: 1 },
    title: { type: 'string' }, reason: { type: 'string' }, benefit: { type: 'string' }, drawback: { type: 'string' },
    proposedStartDate: { type: 'string' }, proposedStartTime: { type: 'string' }, proposedEndDate: { type: 'string' }, proposedEndTime: { type: 'string' }, proposedPlaceName: { type: 'string' }
  }, required: ['scheduleIds','title','reason','benefit','drawback','proposedStartDate','proposedStartTime','proposedEndDate','proposedEndTime','proposedPlaceName'], additionalProperties: false } } }, required: ['summary','suggestions'], additionalProperties: false };
}
export async function POST(request: Request) {
  const requestId = request.headers.get('x-request-id')?.slice(0, 100) || 'unavailable';
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'INVALID_JSON', message: '요청 데이터 형식이 올바르지 않아요.' }, { status: 400 }); }
  const payload = body as { schedules?: unknown; selectedIds?: unknown };
  const validated = validateSchedules(payload?.schedules);
  if (!validated.schedules) return NextResponse.json({ error: 'INVALID_SCHEDULES', message: validated.error }, { status: 400 });
  const schedules = validated.schedules;
  if (process.env.NODE_ENV === 'development') console.info('[schedule-check] request', JSON.stringify({ requestId, scheduleCount: schedules.length }));
  const selectedIds = payload.selectedIds;
  if (selectedIds !== undefined && (!Array.isArray(selectedIds) || selectedIds.some(id => typeof id !== 'string' || !schedules.some(s => s.id === id)))) return NextResponse.json({ error: 'INVALID_SELECTION', message: '분석할 일정 선택을 확인해 주세요.' }, { status: 400 });
  const selected = Array.isArray(selectedIds) && selectedIds.length ? schedules.filter(s => selectedIds.includes(s.id)) : schedules;
  const checkTime = checkedAt();
  const issues: ScheduleIssue[] = detectTimeOverlaps(selected, checkTime);
  const mapsKey = process.env.GOOGLE_MAPS_API_KEY?.trim();
  const holidayYears = [...new Set(selected.map(s => Number(s.startDate.slice(0, 4))))];
  const holidayDates = new Set<string>();
  await Promise.all(holidayYears.map(async year => {
    try { const data = await getHolidayData(year); for (const h of data.holidays) if (h.verified !== false) holidayDates.add(h.date); }
    catch { /* Holiday data is optional; never infer an unverified closure. */ }
  }));
  const places = await Promise.all(selected.map(s => lookupPlace(s, mapsKey, holidayDates)));
  for (let i = 0; i < selected.length - 1; i++) {
    const before = selected[i], after = selected[i + 1], from = places[i], to = places[i + 1];
    if (before.placeName === after.placeName && before.address === after.address) continue;
    if (!from.placeId || !to.placeId) {
      if (before.placeName !== after.placeName || before.address !== after.address) issues.push({ id: 'travel-unavailable:' + before.id + ':' + after.id, type: 'travel_time', scheduleIds: [before.id, after.id], level: 'info', reason: '출발지 또는 목적지의 정확한 장소를 확인하지 못해 이동 시간을 계산할 수 없습니다.', source: 'Google Places 조회 상태', checkedAt: checkTime, suggestion: '정확한 장소 주소나 Google Place ID를 입력해 주세요.' });
      continue;
    }
    const route = await routeMinutes(from.placeId, to.placeId, mapsKey!);
    if (route.minutes === null) {
      const reason = route.status === 'no_route' ? '두 장소 사이의 이동 경로를 찾지 못했습니다.' : route.status === 'quota_exceeded' ? 'Google Routes API 할당량을 초과했습니다.' : route.status === 'timeout' ? 'Google Routes API 응답 시간이 초과됐습니다.' : route.status === 'access_denied' ? 'Google Routes API 접근이 거부됐습니다. 키와 API 설정을 확인해 주세요.' : 'Google Routes API에서 이동 시간을 확인하지 못했습니다.';
      issues.push({ id: 'route-unavailable:' + before.id + ':' + after.id, type: 'travel_time', scheduleIds: [before.id, after.id], level: 'info', reason, source: 'Google Routes API (' + route.status + ')', checkedAt: checkTime, suggestion: '장소와 Google Maps API 설정을 확인해 주세요.' });
    } else { const issue = makeTravelIssue(before, after, route.minutes, checkTime); if (issue) issues.push(issue); }
  }
  for (const place of places) {
    const schedule = selected.find(s => s.id === place.scheduleId)!;
    if (place.status === 'not_configured') issues.push({ id: 'maps-not-configured:' + schedule.id, type: 'business_hours', scheduleIds: [schedule.id], level: 'info', reason: '지도 API 키가 설정되지 않아 장소와 영업시간을 조회할 수 없습니다.', source: 'GOOGLE_MAPS_API_KEY 설정 상태', checkedAt: checkTime, suggestion: '장소의 영업 여부를 직접 확인해 주세요.' });
    else if (place.status !== 'found') {
      const reason = place.status === 'not_found' ? '입력한 장소와 일치하는 장소를 찾지 못했습니다.' : place.status === 'quota_exceeded' ? 'Google Places API 할당량을 초과했습니다.' : place.status === 'timeout' ? 'Google Places API 응답 시간이 초과됐습니다.' : place.status === 'access_denied' ? 'Google Places API 접근이 거부됐습니다. 키와 API 설정을 확인해 주세요.' : 'Google Places API를 확인하지 못했습니다.';
      issues.push({ id: 'place-unavailable:' + schedule.id, type: 'business_hours', scheduleIds: [schedule.id], level: 'info', reason, source: 'Google Places API (' + place.status + ')', checkedAt: checkTime, suggestion: '장소명과 주소, Google Maps API 설정을 확인해 주세요.' });
    }
    else if (place.businessStatus !== 'likely_open') issues.push({ id: 'hours:' + schedule.id, type: place.businessStatus === 'holiday_check' ? 'holiday_hours' : 'business_hours', scheduleIds: [schedule.id], level: 'info', reason: place.businessStatus === 'holiday_check' ? '공휴일입니다. 일반 영업시간으로 공휴일 영업을 확정할 수 없습니다.' : place.businessStatus === 'hours_mismatch' ? '일정 시간이 장소의 일반 영업시간과 맞지 않습니다. 공휴일 특별 운영시간은 별도 확인이 필요합니다.' : '장소의 일반 영업시간 정보가 없습니다.', source: 'Google Places 일반 영업시간', checkedAt: checkTime, suggestion: '장소에 직접 문의해 방문일 영업시간을 확인해 주세요.' });
  }
  const sorted = [...selected].sort(compareSchedules);
  let summary = issues.length ? '일정의 시간과 장소 정보를 확인해 보세요.' : '확인 가능한 일정 시간 충돌은 없습니다.';
  let suggestions: ReturnType<typeof safeAiSuggestions> = [];
  let aiStatus: 'ok' | 'not_configured' | 'error' = 'not_configured';
  let aiMessage = 'Gemini API 키가 설정되지 않아 서버 계산 결과만 표시합니다.';
  const geminiKey = process.env.GEMINI_API_KEY?.trim();
  if (geminiKey) {
    try {
      const responseText = await generateGeminiJson(
        '당신은 한국어 일정 충돌 설명 도우미입니다. 서버가 제공한 일정과 확정 이슈만 설명하고, 확인되지 않은 장소·영업·예약·이동 정보를 만들지 마세요. 대안은 이슈가 있는 단일 일정의 시각만 조정하고 날짜와 장소명은 유지하세요. 사용자 동의 전에 원 일정이 변경되지 않습니다. 이동시간 이슈는 충분한 버퍼를 확보하는 시간 변경안을 제안하세요. 사유가 없으면 빈 suggestions를 반환하세요.\n\n' + JSON.stringify({ schedules: selected.map(s => ({ id:s.id, title:s.title, startDate:s.startDate, startTime:s.startTime, endDate:s.endDate, endTime:s.endTime, placeName:s.placeName })), issues, places: places.map(p => ({ scheduleId:p.scheduleId, status:p.status, businessStatus:p.businessStatus })) }),
        suggestionSchema(selected.map(s => s.id)),
        1300
      );
      const data = JSON.parse(responseText || '{}') as { summary?: unknown };
      const safe = safeAiSuggestions(data, selected);
      if (typeof data.summary !== 'string' || data.summary.length > 500) throw new Error('invalid summary');
      summary = data.summary;
      suggestions = safe;
      aiStatus = 'ok';
      aiMessage = '';
    } catch (error) {
      aiStatus = 'error';
      const failure = classifyGeminiError(error);
      aiMessage = error instanceof SyntaxError ? 'Gemini 응답을 읽지 못했어요. 서버 계산 결과를 확인해 주세요.' : failure.userMessage;
      console.error('[schedule-check] failure', JSON.stringify({ requestId, stage: 'ai_response', errorKind: error instanceof SyntaxError ? 'invalid_json' : failure.kind, providerStatus: failure.providerStatus }));
    }
  } else {
    console.info('[schedule-check] analysis', JSON.stringify({ requestId, aiStatus, issueCount: issues.length, scheduleCount: selected.length }));
  }
  return NextResponse.json({ checkedAt: checkTime, summary, issues, places, suggestions, aiStatus, aiMessage, mapsStatus: mapsKey ? 'configured' : 'not_configured', counts: { conflicts: issues.filter(x => x.level === 'high').length, risks: issues.filter(x => x.level === 'medium').length, checks: issues.filter(x => x.level === 'info').length } }, { headers: { 'Cache-Control': 'no-store' } });
}
