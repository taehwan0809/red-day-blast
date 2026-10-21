import { NextResponse } from 'next/server';
import { HOLIDAYS, type Holiday } from '@/lib/holidays';
export const revalidate = 86400;
const cacheHeaders = { 'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=604800' };
const CALENDAR_ID = 'ko.south_korea#holiday@group.v.calendar.google.com';
type GoogleEvent = { summary?: string; start?: { date?: string }; end?: { date?: string } };
async function googleHolidays(year: number, apiKey: string): Promise<Holiday[]> {
  const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(CALENDAR_ID)}/events`);
  url.searchParams.set('key', apiKey); url.searchParams.set('timeMin', `${year}-01-01T00:00:00+09:00`); url.searchParams.set('timeMax', `${year + 1}-01-01T00:00:00+09:00`);
  url.searchParams.set('singleEvents', 'true'); url.searchParams.set('orderBy', 'startTime'); url.searchParams.set('maxResults', '250');
  const response = await fetch(url, { next: { revalidate: 86400 }, signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error('Google Calendar request failed');
  const data = await response.json() as { items?: GoogleEvent[]; nextPageToken?: string };
  if (data.nextPageToken) throw new Error('Google Calendar result exceeded one page');
  const byDate = new Map<string, Holiday>();
  for (const event of data.items ?? []) {
    const date = event.start?.date; const name = event.summary?.trim();
    if (!date || !name || !new RegExp(`^${year}-\\d{2}-\\d{2}$`).test(date)) continue;
    const kind: Holiday['kind'] = name.includes('대체') || /substitute/i.test(name) ? 'substitute' : name.includes('현충') || /memorial/i.test(name) ? 'memorial' : 'national';
    byDate.set(date, { date, name, kind });
  }
  return [...byDate.values()].sort((a,b) => a.date.localeCompare(b.date));
}
export async function GET(request: Request) {
  const year = Number(new URL(request.url).searchParams.get('year'));
  if (!Number.isInteger(year) || year < 1900 || year > 2100) return NextResponse.json({ error: '연도는 1900년부터 2100년 사이로 입력해 주세요.' }, { status: 400 });
  const seoulYear = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', year: 'numeric' }).format(new Date()));
  if (year > seoulYear + 1) return NextResponse.json({ year, holidays: [], source: null, status: 'unavailable', updatedAt: null }, { headers: cacheHeaders });
  const kasiKey = process.env.KASI_SERVICE_KEY; const googleKey = process.env.GOOGLE_CALENDAR_API_KEY;
  let official: Holiday[] = HOLIDAYS[year] ?? []; let officialSource: string | null = official.length ? '한국천문연구원 2026 월력요항 및 관련 법령 확인 자료' : null;
  if (kasiKey) {
    try {
      const url = new URL('https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo');
      url.searchParams.set('solYear', String(year)); url.searchParams.set('numOfRows', '100'); url.searchParams.set('_type', 'json'); url.searchParams.set('ServiceKey', kasiKey);
      const response = await fetch(url, { next: { revalidate: 86400 }, signal: AbortSignal.timeout(8000) }); if (!response.ok) throw new Error('KASI request failed');
      const data = await response.json(); const body = data?.response?.body; if (data?.response?.header?.resultCode !== '00' || !body) throw new Error('KASI response invalid');
      const raw = body.items?.item; const items = raw ? Array.isArray(raw) ? raw : [raw] : [];
      if (!items.length) throw new Error('KASI returned no records');
      official = items.filter((item: any) => item.isHoliday === 'Y').map((item: any): Holiday => { const s = String(item.locdate); const date = `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`; const name = String(item.dateName ?? '공휴일'); return { date, name, kind: name.includes('대체') ? 'substitute' : name.includes('현충') ? 'memorial' : 'national' }; }).filter((h: Holiday) => /^\d{4}-\d{2}-\d{2}$/.test(h.date));
      officialSource = '한국천문연구원 특일정보 API';
    } catch { /* Keep validated local data if KASI is unavailable. */ }
  }
  let google: Holiday[] = []; let googleError = false;
  if (googleKey) { try { google = await googleHolidays(year, googleKey); } catch { googleError = true; } }
  // Official KASI/local records win on date collisions; Google-only dates remain visibly marked as unverified.
  const merged = new Map<string, Holiday & { verified?: boolean }>();
  for (const h of google) merged.set(h.date, { ...h, verified: false });
  for (const h of official) merged.set(h.date, { ...h, verified: true });
  const holidays = [...merged.values()].sort((a,b) => a.date.localeCompare(b.date));
  const hasGoogleOnlyDates = google.some(h => !official.some(o => o.date === h.date));
  const status = officialSource ? hasGoogleOnlyDates ? 'partial' : 'official' : google.length ? 'unverified' : 'unavailable';
  const source = officialSource ? `${officialSource}${google.length ? ' · Google Calendar 대조' : ''}` : google.length ? 'Google Calendar 대한민국 공휴일 캘린더 (미검증)' : null;
  return NextResponse.json({ year, holidays, source, status, updatedAt: new Date().toISOString(), googleStatus: googleKey ? googleError ? 'error' : 'ok' : 'not-configured' }, { headers: cacheHeaders });
}


