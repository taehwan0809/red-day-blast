export type Holiday = { date: string; name: string; kind: 'national' | 'substitute' | 'memorial' };
export type MergedHoliday = Holiday & { verified?: boolean };

export function mergeHolidayData(official: Holiday[], google: Holiday[]): MergedHoliday[] {
  const merged = new Map<string, MergedHoliday>();

  // Official records win by date. Google Calendar includes observances and seasonal
  // events, so Google-only records remain explicitly unverified.
  for (const holiday of google) if (!merged.has(holiday.date)) merged.set(holiday.date, { ...holiday, verified: false });
  for (const holiday of official) merged.set(holiday.date, { ...holiday, verified: true });
  return [...merged.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function mergeOfficialHolidaySources(primary: Holiday[], fallback: Holiday[]): Holiday[] {
  const byDate = new Map<string, Holiday>();
  // KASI's legal holiday classification/name takes precedence. Curated local
  // records fill dates omitted by the API and deduplicate repeated KASI records.
  for (const holiday of [...primary, ...fallback]) {
    if (!byDate.has(holiday.date)) byDate.set(holiday.date, holiday);
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

// 한국천문연구원 2026 월력요항 기준. 미확정 연도에는 임의 데이터를 생성하지 않는다.
export const HOLIDAYS: Record<number, Holiday[]> = {
  2026: [
    {date:'2026-01-01',name:'신정',kind:'national'}, {date:'2026-02-16',name:'설날 연휴',kind:'national'}, {date:'2026-02-17',name:'설날',kind:'national'}, {date:'2026-02-18',name:'설날 연휴',kind:'national'},
    {date:'2026-05-01',name:'노동절',kind:'national'},
    {date:'2026-03-01',name:'삼일절',kind:'national'}, {date:'2026-03-02',name:'삼일절 대체공휴일',kind:'substitute'}, {date:'2026-05-05',name:'어린이날',kind:'national'}, {date:'2026-05-24',name:'부처님오신날',kind:'national'}, {date:'2026-05-25',name:'부처님오신날 대체공휴일',kind:'substitute'},
    {date:'2026-06-03',name:'제9회 전국동시지방선거',kind:'national'}, {date:'2026-06-06',name:'현충일',kind:'memorial'}, {date:'2026-07-17',name:'제헌절',kind:'national'}, {date:'2026-08-15',name:'광복절',kind:'national'}, {date:'2026-08-17',name:'광복절 대체공휴일',kind:'substitute'},
    {date:'2026-09-24',name:'추석 연휴',kind:'national'}, {date:'2026-09-25',name:'추석',kind:'national'}, {date:'2026-09-26',name:'추석 연휴',kind:'national'},
    {date:'2026-10-03',name:'개천절',kind:'national'}, {date:'2026-10-05',name:'개천절 대체공휴일',kind:'substitute'}, {date:'2026-10-09',name:'한글날',kind:'national'}, {date:'2026-12-25',name:'성탄절',kind:'national'}
  ]
};
export const holidayDataStatus = (year:number) => year in HOLIDAYS ? 'official' as const : 'unavailable' as const;
