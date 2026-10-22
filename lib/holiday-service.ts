import { HOLIDAYS, mergeHolidayData, mergeOfficialHolidaySources, type Holiday, type MergedHoliday } from './holidays';

const CALENDAR_ID = 'ko.south_korea#holiday@group.v.calendar.google.com';
type GoogleEvent = { summary?: string; start?: { date?: string }; end?: { date?: string } };

export type HolidayData = {
  year: number;
  holidays: MergedHoliday[];
  source: string | null;
  status: 'official' | 'partial' | 'unverified' | 'unavailable';
  updatedAt: string | null;
  googleStatus?: 'ok' | 'error' | 'not-configured';
};

export function isValidHolidayData(value: unknown, expectedYear: number): value is HolidayData {
  if (!value || typeof value !== 'object') return false;
  const data = value as Partial<HolidayData>;
  if (data.year !== expectedYear || !Array.isArray(data.holidays)) return false;
  if (!['official', 'partial', 'unverified', 'unavailable'].includes(String(data.status))) return false;
  if (data.source !== null && typeof data.source !== 'string') return false;
  if (data.updatedAt !== null && typeof data.updatedAt !== 'string') return false;
  if (data.googleStatus !== undefined && !['ok', 'error', 'not-configured'].includes(data.googleStatus)) return false;
  return data.holidays.every(holiday => {
    if (!holiday || typeof holiday !== 'object') return false;
    const item = holiday as MergedHoliday;
    if (typeof item.date !== 'string' || typeof item.name !== 'string' || !item.name.trim()) return false;
    if (!['national', 'substitute', 'memorial'].includes(item.kind)) return false;
    if (item.verified !== undefined && typeof item.verified !== 'boolean') return false;
    if (!new RegExp(`^${expectedYear}-\\d{2}-\\d{2}$`).test(item.date)) return false;
    const [year, month, day] = item.date.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  });
}

function validDateForYear(value: string, year: number) {
  if (!new RegExp(`^${year}-\\d{2}-\\d{2}$`).test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

async function googleHolidays(year: number, apiKey: string): Promise<Holiday[]> {
  const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(CALENDAR_ID)}/events`);
  url.searchParams.set('key', apiKey);
  url.searchParams.set('timeMin', `${year}-01-01T00:00:00+09:00`);
  url.searchParams.set('timeMax', `${year + 1}-01-01T00:00:00+09:00`);
  url.searchParams.set('singleEvents', 'true');
  url.searchParams.set('orderBy', 'startTime');
  url.searchParams.set('maxResults', '250');

  const byDate = new Map<string, Holiday>();
  let pageToken: string | undefined;
  for (let page = 0; page < 10; page++) {
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const response = await fetch(url, { next: { revalidate: 86400 }, signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error('Google Calendar request failed');
    const data = await response.json() as { items?: GoogleEvent[]; nextPageToken?: string };
    for (const event of data.items ?? []) {
      const date = event.start?.date;
      const name = event.summary?.trim();
      if (!date || !name || !validDateForYear(date, year)) continue;
      const kind: Holiday['kind'] = name.includes('대체') || /substitute/i.test(name)
        ? 'substitute'
        : name.includes('현충') || /memorial/i.test(name) ? 'memorial' : 'national';
      byDate.set(date, { date, name, kind });
    }
    pageToken = data.nextPageToken;
    if (!pageToken) break;
    if (page === 9) throw new Error('Google Calendar result exceeded the safe page limit');
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export async function getHolidayData(year: number): Promise<HolidayData> {
  const seoulYear = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', year: 'numeric' }).format(new Date()));
  if (year > seoulYear + 1) {
    return { year, holidays: [], source: null, status: 'unavailable', updatedAt: null };
  }

  const kasiKey = process.env.KASI_SERVICE_KEY;
  const googleKey = process.env.GOOGLE_CALENDAR_API_KEY;
  let official: Holiday[] = HOLIDAYS[year] ?? [];
  let officialSource: string | null = official.length ? '한국천문연구원 2026 월력요항 및 관련 법령 확인 자료' : null;
  let google: Holiday[] = [];
  let googleError = false;
  // Fetch the unverified event feed alongside KASI so server consumers do not
  // pay both upstream latency budgets sequentially.
  const googleLookup = googleKey
    ? googleHolidays(year, googleKey).then(result => { google = result; }).catch(() => { googleError = true; })
    : Promise.resolve();
  if (kasiKey) {
    try {
      const url = new URL('https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo');
      url.searchParams.set('solYear', String(year));
      url.searchParams.set('numOfRows', '100');
      url.searchParams.set('_type', 'json');
      url.searchParams.set('ServiceKey', kasiKey);
      const response = await fetch(url, { next: { revalidate: 86400 }, signal: AbortSignal.timeout(8000) });
      if (!response.ok) throw new Error('KASI request failed');
      const data = await response.json();
      const body = data?.response?.body;
      if (data?.response?.header?.resultCode !== '00' || !body) throw new Error('KASI response invalid');
      const raw = body.items?.item;
      const items = raw ? Array.isArray(raw) ? raw : [raw] : [];
      if (!items.length) throw new Error('KASI returned no records');
      const kasiHolidays = items
        .filter((item: any) => item.isHoliday === 'Y')
        .map((item: any): Holiday | null => {
          const value = String(item.locdate);
          const date = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
          if (!validDateForYear(date, year)) return null;
          const name = String(item.dateName ?? '공휴일');
          return { date, name, kind: name.includes('대체') ? 'substitute' : name.includes('현충') ? 'memorial' : 'national' };
        })
        .filter((holiday: Holiday | null): holiday is Holiday => holiday !== null);
      if (!kasiHolidays.length) throw new Error('KASI returned no valid holidays');
      official = mergeOfficialHolidaySources(kasiHolidays, HOLIDAYS[year] ?? []);
      officialSource = '한국천문연구원 특일정보 API';
    } catch {
      // Keep validated local records when KASI is unavailable.
    }
  }

  await googleLookup;

  const merged = mergeHolidayData(official, google);
  // Calendar-only items are general observances, not evidence of a statutory holiday.
  const holidays = merged.filter(holiday => holiday.verified === true);
  const status = holidays.length ? 'official' : 'unavailable';
  const source = holidays.length ? officialSource : null;
  return {
    year,
    holidays,
    source,
    status,
    updatedAt: new Date().toISOString(),
    googleStatus: googleKey ? googleError ? 'error' : 'ok' : 'not-configured'
  };
}
