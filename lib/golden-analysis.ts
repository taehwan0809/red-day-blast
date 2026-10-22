import { evaluateLeave, filterUpcomingPeriods, koreaDateKey, monthDays, recommendLeave, restPeriods, type LeaveImpact, type LeaveOption, type RestPeriod } from './calendar';
import type { Holiday, MergedHoliday } from './holidays';
import type { HolidayData } from './holiday-service';

export type GoldenCandidate = {
  candidateId: string;
  startDate: string;
  endDate: string;
  totalRestDays: number;
  requiredLeaveDays: number;
  leaveDates: string[];
  holidays: string[];
  efficiency: number;
};

export type AiGoldenRecommendation = GoldenCandidate & {
  reason: string;
  efficiencyAdvice: string;
  activitySuggestion: string;
};

export type GoldenAnalysisContext = {
  year: number;
  analysisDate: string;
  source: string | null;
  holidayStatus: HolidayData['status'];
  holidays: MergedHoliday[];
  naturalBreaks: GoldenCandidate[];
  leaveOptions: Record<1 | 2 | 3, GoldenCandidate[]>;
  selectedLeaveDates: string[];
  selectedLeavePlans: GoldenCandidate[];
};

export function createGoldenAnalysisRequest(year: number, analysisDate: string, selectedLeaveDates: string[]) {
  return { year, analysisDate, selectedLeaveDates: [...selectedLeaveDates] };
}

function candidate(id: string, period: RestPeriod | LeaveOption | LeaveImpact, leaveDates: string[]): GoldenCandidate {
  return {
    candidateId: id,
    startDate: period.start,
    endDate: period.end,
    totalRestDays: period.days,
    requiredLeaveDays: leaveDates.length,
    leaveDates,
    holidays: period.holidays,
    efficiency: leaveDates.length ? Math.round(period.days / leaveDates.length * 10) / 10 : 0
  };
}

function leaveCandidate(option: LeaveOption, prefix = 'leave'): GoldenCandidate {
  return candidate(`${prefix}:${option.start}:${option.end}:${option.leaveDates.join(',')}`, option, option.leaveDates);
}

export function validateSelectedLeaveDates(
  year: number,
  dates: unknown,
  holidays: (Holiday | MergedHoliday)[],
  analysisDate = koreaDateKey()
): string | null {
  if (dates === undefined) return null;
  if (!Array.isArray(dates) || dates.length > 3 || dates.some(date => typeof date !== 'string')) {
    return '선택 휴가 날짜는 최대 3일까지 입력할 수 있어요.';
  }
  if (new Set(dates).size !== dates.length) return '같은 휴가 날짜를 중복 선택했어요.';

  for (const value of dates as string[]) {
    if (!new RegExp(`^${year}-\\d{2}-\\d{2}$`).test(value)) return '선택한 휴가 날짜가 분석 연도와 맞지 않아요.';
    if (value < analysisDate) return '이미 지난 날짜는 연차 날짜로 선택할 수 없어요.';
    const [month, day] = value.slice(5).split('-').map(Number);
    const calendarDay = monthDays(year, month - 1, holidays).find(date => date.date === value);
    if (!calendarDay || calendarDay.rest || !Number.isInteger(day)) {
      return `${value}은(는) 평일 근무일이 아니어서 연차 날짜로 선택할 수 없어요.`;
    }
  }
  return null;
}

export function buildGoldenAnalysisContext(
  holidayData: HolidayData,
  selectedLeaveDates: string[] = [],
  analysisDate = koreaDateKey()
): GoldenAnalysisContext {
  const year = holidayData.year;
  // Unverified calendar events must never change server-computed candidates.
  const holidays = holidayData.holidays.filter(holiday => holiday.verified !== false);
  const naturalBreaks = filterUpcomingPeriods(restPeriods(year, holidays), analysisDate)
    .sort((a, b) => b.days - a.days)
    .slice(0, 10)
    .map(period => candidate(`natural:${period.start}:${period.end}`, period, []));
  const allLeaveOptions = filterUpcomingPeriods(recommendLeave(year, holidays, 3), analysisDate);
  const leaveOptions = {
    1: allLeaveOptions.filter(option => option.leaveDates.length === 1).slice(0, 5).map(option => leaveCandidate(option)),
    2: allLeaveOptions.filter(option => option.leaveDates.length === 2).slice(0, 5).map(option => leaveCandidate(option)),
    3: allLeaveOptions.filter(option => option.leaveDates.length === 3).slice(0, 5).map(option => leaveCandidate(option))
  };
  const selectedLeavePlans = selectedLeaveDates.length
    ? filterUpcomingPeriods(evaluateLeave(year, selectedLeaveDates, holidays), analysisDate).map((period: LeaveImpact) => candidate(
      `selected:${period.start}:${period.end}:${period.leaveDates.join(',')}`,
      period,
      period.leaveDates
    ))
    : [];

  return {
    year,
    analysisDate,
    source: holidayData.source,
    holidayStatus: holidayData.status,
    holidays,
    naturalBreaks,
    leaveOptions,
    selectedLeaveDates,
    selectedLeavePlans
  };
}

export function resolveAiRecommendations(
  text: string | undefined,
  candidates: GoldenCandidate[]
): AiGoldenRecommendation[] {
  if (!text) throw new Error('AI returned an empty response');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('AI response is not valid JSON');
  }
  if (!parsed || typeof parsed !== 'object' || !('recommendations' in parsed) || !Array.isArray(parsed.recommendations)) {
    throw new Error('AI response has an invalid structure');
  }
  if (parsed.recommendations.length > 3) throw new Error('AI returned too many recommendations');

  const candidateById = new Map(candidates.map(item => [item.candidateId, item]));
  const seen = new Set<string>();
  return parsed.recommendations.map((item: unknown) => {
    if (!item || typeof item !== 'object') throw new Error('AI recommendation is invalid');
    const recommendation = item as Record<string, unknown>;
    const candidateId = recommendation.candidateId;
    const candidateData = typeof candidateId === 'string' ? candidateById.get(candidateId) : undefined;
    if (!candidateData || seen.has(candidateData.candidateId)) throw new Error('AI selected an unknown or repeated candidate');
    seen.add(candidateData.candidateId);
    const reason = recommendation.reason;
    const efficiencyAdvice = recommendation.efficiencyAdvice;
    const activitySuggestion = recommendation.activitySuggestion;
    if ([reason, efficiencyAdvice, activitySuggestion].some(value => typeof value !== 'string' || !value.trim())) {
      throw new Error('AI recommendation is missing required explanations');
    }
    const explanations = [reason, efficiencyAdvice, activitySuggestion] as string[];
    if (explanations.some(value => /(?:^|\D)(?:19|20)\d{2}\s*(?:[-/.년])\s*\d{1,2}\s*(?:[-/.월])\s*\d{1,2}\s*일?/.test(value))) {
      throw new Error('AI narrative included an unverified date');
    }
    return {
      ...candidateData,
      reason: String(reason).trim().slice(0, 500),
      efficiencyAdvice: String(efficiencyAdvice).trim().slice(0, 500),
      activitySuggestion: String(activitySuggestion).trim().slice(0, 500)
    };
  });
}
