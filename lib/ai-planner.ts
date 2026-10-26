import { daysBetweenDateKeys, isDateKey, monthDays } from './calendar';
import type { Holiday } from './holidays';

export type ExistingPlanRange = { start: string; end: string };
export type PlannerCandidate = {
  candidateId: string;
  startDate: string;
  endDate: string;
  totalRestDays: number;
  requiredLeaveDays: number;
  leaveDates: string[];
  holidays: string[];
  conflictsWithExistingPlan: boolean;
};
export type PlannerRecommendation = PlannerCandidate & {
  title: string;
  description: string;
  reason: string;
  advantages: string;
  disadvantages: string;
};

export function validateExistingPlanRanges(value: unknown): ExistingPlanRange[] | null {
  if (!Array.isArray(value) || value.length > 100) return null;
  const ranges: ExistingPlanRange[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') return null;
    const range = item as Record<string, unknown>;
    if (!isDateKey(range.start) || !isDateKey(range.end) || range.start > range.end) return null;
    ranges.push({ start: range.start, end: range.end });
  }
  return ranges;
}

export function buildPlannerCandidates(
  year: number,
  month: number | null,
  maxLeaveDays: number,
  targetDays: number | null,
  holidays: Holiday[],
  analysisDate: string,
  existingPlans: ExistingPlanRange[]
): PlannerCandidate[] {
  const days = Array.from({ length: 12 }, (_, monthIndex) => monthDays(year, monthIndex, holidays)).flat();
  const candidatesByLeaveCount = new Map<number, PlannerCandidate[]>();

  for (let startIndex = 0; startIndex < days.length; startIndex++) {
    const first = days[startIndex];
    if (first.date < analysisDate || (month !== null && first.date.slice(5, 7) !== String(month).padStart(2, '0'))) continue;
    const leaveDates: string[] = [];
    const periodHolidays = new Set<string>();
    for (let endIndex = startIndex; endIndex < Math.min(days.length, startIndex + 14); endIndex++) {
      const day = days[endIndex];
      if (day.holiday) periodHolidays.add(day.holiday);
      if (!day.rest) leaveDates.push(day.date);
      if (leaveDates.length > maxLeaveDays) break;

      const totalRestDays = endIndex - startIndex + 1;
      const existingConflict = existingPlans.some(plan => plan.start <= day.date && plan.end >= first.date);
      const candidate: PlannerCandidate = {
        candidateId: `${first.date}:${day.date}`,
        startDate: first.date,
        endDate: day.date,
        totalRestDays,
        requiredLeaveDays: leaveDates.length,
        leaveDates: [...leaveDates],
        holidays: [...periodHolidays],
        conflictsWithExistingPlan: existingConflict
      };
      const bucket = candidatesByLeaveCount.get(leaveDates.length) ?? [];
      bucket.push(candidate);
      candidatesByLeaveCount.set(leaveDates.length, bucket);
    }
  }

  const rank = (a: PlannerCandidate, b: PlannerCandidate) => {
    const targetDifference = targetDays === null
      ? 0
      : Math.abs(a.totalRestDays - targetDays) - Math.abs(b.totalRestDays - targetDays);
    return targetDifference || b.totalRestDays - a.totalRestDays ||
      Number(a.conflictsWithExistingPlan) - Number(b.conflictsWithExistingPlan) ||
      a.startDate.localeCompare(b.startDate);
  };

  return [...candidatesByLeaveCount.values()]
    .flatMap(bucket => bucket.sort(rank).slice(0, 24))
    .sort(rank)
    .slice(0, 120);
}

export function parsePlannerResponse(text: string | undefined): unknown {
  if (!text) throw new Error('empty_response');
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('invalid_json');
  }
}

export function validatePlannerRecommendations(parsed: unknown, candidates: PlannerCandidate[]): PlannerRecommendation[] {
  if (!parsed || typeof parsed !== 'object' || !('recommendations' in parsed) || !Array.isArray(parsed.recommendations)) {
    throw new Error('invalid_structure');
  }
  if (parsed.recommendations.length > 3) throw new Error('too_many_recommendations');

  const candidateById = new Map(candidates.map(candidate => [candidate.candidateId, candidate]));
  const seen = new Set<string>();
  return parsed.recommendations.map((value: unknown) => {
    if (!value || typeof value !== 'object') throw new Error('invalid_recommendation');
    const item = value as Record<string, unknown>;
    const candidateId = item.candidateId;
    const candidate = typeof candidateId === 'string' ? candidateById.get(candidateId) : undefined;
    if (!candidate || seen.has(candidate.candidateId)) throw new Error('unknown_candidate');
    seen.add(candidate.candidateId);

    const fields = ['title', 'description', 'reason', 'advantages', 'disadvantages'] as const;
    for (const field of fields) {
      if (typeof item[field] !== 'string' || !item[field].trim() || item[field].length > (field === 'title' ? 80 : 500)) {
        throw new Error('invalid_explanation');
      }
      if (/(?:19|20)\d{2}[-/.년]\s?\d{1,2}[-/.월]\s?\d{1,2}일?|\d{1,2}월\s?\d{1,2}일/.test(item[field] as string)) {
        throw new Error('unverified_date');
      }
    }
    if (candidate.totalRestDays !== daysBetweenDateKeys(candidate.startDate, candidate.endDate) + 1 ||
      candidate.requiredLeaveDays !== candidate.leaveDates.length ||
      candidate.leaveDates.some(date => date < candidate.startDate || date > candidate.endDate)) {
      throw new Error('inconsistent_candidate');
    }

    return {
      ...candidate,
      title: (item.title as string).trim(),
      description: (item.description as string).trim(),
      reason: (item.reason as string).trim(),
      advantages: (item.advantages as string).trim(),
      disadvantages: (item.disadvantages as string).trim()
    };
  });
}

export function resolvePlannerRecommendations(text: string | undefined, candidates: PlannerCandidate[]): PlannerRecommendation[] {
  return validatePlannerRecommendations(parsePlannerResponse(text), candidates);
}