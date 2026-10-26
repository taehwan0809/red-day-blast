import { NextResponse } from 'next/server';
import { buildPlannerCandidates, resolvePlannerRecommendations, validateExistingPlanRanges } from '@/lib/ai-planner';
import { koreaDateKey } from '@/lib/calendar';
import { classifyGeminiError } from '@/lib/gemini-errors';
import { generateGeminiJson } from '@/lib/gemini';
import { getHolidayData, isValidHolidayData } from '@/lib/holiday-service';
import type { PlanType } from '@/lib/plans';

export const runtime = 'nodejs';
export const maxDuration = 30;

const purposes = ['travel', 'rest', 'personal', 'leave', 'other'] as const;
const purposeLabels: Record<typeof purposes[number], string> = {
  travel: '여행', rest: '휴식', personal: '개인 일정', leave: '연차 활용', other: '기타'
};
const planTypes: Record<typeof purposes[number], PlanType> = {
  travel: '여행', rest: '휴식', personal: '기타', leave: '휴식', other: '기타'
};

function recommendationSchema(candidateIds: string[]) {
  return {
    type: 'object',
    properties: {
      recommendations: {
        type: 'array',
        maxItems: 3,
        items: {
          type: 'object',
          properties: {
            candidateId: { type: 'string', enum: candidateIds },
            title: { type: 'string' },
            description: { type: 'string' },
            reason: { type: 'string' },
            advantages: { type: 'string' },
            disadvantages: { type: 'string' }
          },
          required: ['candidateId', 'title', 'description', 'reason', 'advantages', 'disadvantages'],
          additionalProperties: false
        }
      }
    },
    required: ['recommendations'],
    additionalProperties: false
  };
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'INVALID_JSON', message: '요청 데이터 형식이 올바르지 않아요.' }, { status: 400 });
  }
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'INVALID_REQUEST', message: '계획 요청을 확인해 주세요.' }, { status: 400 });
  }

  const payload = body as Record<string, unknown>;
  const requestText = typeof payload.requestText === 'string' ? payload.requestText.trim() : '';
  const year = payload.year;
  const month = payload.month === null || payload.month === undefined ? null : payload.month;
  const maxLeaveDays = payload.maxLeaveDays;
  const targetDays = payload.targetDays === null || payload.targetDays === undefined ? null : payload.targetDays;
  const purpose = payload.purpose;
  const additionalConditions = typeof payload.additionalConditions === 'string' ? payload.additionalConditions.trim() : '';
  if (requestText.length < 3 || requestText.length > 600 || additionalConditions.length > 400) {
    return NextResponse.json({ error: 'INVALID_TEXT', message: '요청은 3~600자, 추가 조건은 400자 이내로 입력해 주세요.' }, { status: 400 });
  }
  if (typeof year !== 'number' || !Number.isInteger(year) || year < Number(koreaDateKey().slice(0, 4)) || year > 2100) {
    return NextResponse.json({ error: 'INVALID_YEAR', message: '현재 연도 이후를 선택해 주세요.' }, { status: 400 });
  }
  if (month !== null && (typeof month !== 'number' || !Number.isInteger(month) || month < 1 || month > 12)) {
    return NextResponse.json({ error: 'INVALID_MONTH', message: '월 선택을 확인해 주세요.' }, { status: 400 });
  }
  if (typeof maxLeaveDays !== 'number' || !Number.isInteger(maxLeaveDays) || maxLeaveDays < 0 || maxLeaveDays > 5) {
    return NextResponse.json({ error: 'INVALID_LEAVE_DAYS', message: '사용 가능한 연차는 0~5일로 입력해 주세요.' }, { status: 400 });
  }
  if (targetDays !== null && (typeof targetDays !== 'number' || !Number.isInteger(targetDays) || targetDays < 1 || targetDays > 14)) {
    return NextResponse.json({ error: 'INVALID_TARGET_DAYS', message: '목표 휴식 기간은 1~14일로 선택해 주세요.' }, { status: 400 });
  }
  if (typeof purpose !== 'string' || !purposes.includes(purpose as typeof purposes[number])) {
    return NextResponse.json({ error: 'INVALID_PURPOSE', message: '계획 목적을 선택해 주세요.' }, { status: 400 });
  }

  const existingPlansAvailable = payload.existingPlansAvailable === true;
  const existingPlans = validateExistingPlanRanges(payload.existingPlans ?? []);
  if (!existingPlans || (!existingPlansAvailable && existingPlans.length > 0)) {
    return NextResponse.json({ error: 'INVALID_EXISTING_PLANS', message: '기존 계획 정보를 확인해 주세요.' }, { status: 400 });
  }

  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json({
      error: 'GEMINI_API_KEY_MISSING',
      message: 'Gemini API 설정이 완료되지 않았어요. 관리자에게 문의해 주세요.'
    }, { status: 503 });
  }

  let holidayData;
  try {
    holidayData = await getHolidayData(year);
  } catch {
    return NextResponse.json({ error: 'HOLIDAY_DATA_UNAVAILABLE', message: '공휴일 자료를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.' }, { status: 503 });
  }
  if (!isValidHolidayData(holidayData, year) || holidayData.status === 'unavailable') {
    return NextResponse.json({ error: 'HOLIDAY_DATA_UNAVAILABLE', message: `${year}년 공휴일 자료를 확인할 수 없어 추천을 만들지 못했어요.` }, { status: 503 });
  }

  const verifiedHolidays = holidayData.holidays.filter(holiday => holiday.verified !== false);
  const candidates = buildPlannerCandidates(
    year,
    month,
    maxLeaveDays,
    targetDays,
    verifiedHolidays,
    koreaDateKey(),
    existingPlansAvailable ? existingPlans : []
  );
  if (!candidates.length) {
    return NextResponse.json({
      year, purpose: planTypes[purpose as typeof purposes[number]], source: holidayData.source,
      existingPlansChecked: existingPlansAvailable, recommendations: [], generatedAt: new Date().toISOString()
    });
  }

  const prompt = [
    '당신은 사용자의 연차와 휴식 계획을 돕는 한국어 플래너입니다.',
    '입력 요청과 서버가 제공한 후보만 근거로 최대 3개를 고르세요. 날짜, 연속 휴식 일수, 연차 일수, 휴일 이름을 만들거나 수정하지 마세요.',
    '후보의 시작일과 종료일은 포함된 날짜이며 requiredLeaveDays는 후보 계산값입니다. 날짜는 candidateId로만 선택하고 설명 문장에 날짜를 쓰지 마세요.',
    '사용자가 제시한 희망 기간, 목적, 조건을 우선 반영하세요. 기존 계획과 겹치는 후보는 가능하면 피하고, 불가피하면 장점과 단점에서 겹침을 분명히 설명하세요.',
    '장소 운영, 예약 가능 여부, 여행 상품이나 가격처럼 확인되지 않은 사실을 주장하지 마세요. 후보가 요청에 맞지 않으면 recommendations를 빈 배열로 반환하세요.',
    JSON.stringify({
      requestText, purpose: purposeLabels[purpose as typeof purposes[number]], month, maxLeaveDays, targetDays,
      additionalConditions, existingPlansChecked: existingPlansAvailable,
      existingPlanRanges: existingPlansAvailable ? existingPlans : [],
      candidates
    })
  ].join('\n\n');

  let recommendations;
  try {
    const responseText = await generateGeminiJson(prompt, recommendationSchema(candidates.map(candidate => candidate.candidateId)), 1500);
    recommendations = resolvePlannerRecommendations(responseText, candidates);
  } catch (error) {
    if (error instanceof Error && ['invalid_json', 'invalid_structure', 'too_many_recommendations', 'invalid_recommendation', 'unknown_candidate', 'invalid_explanation', 'unverified_date', 'inconsistent_candidate'].includes(error.message)) {
      return NextResponse.json({ error: 'GEMINI_RESPONSE_INVALID', message: 'Gemini가 검증할 수 없는 결과를 반환했어요. 다시 시도해 주세요.' }, { status: 502 });
    }
    const failure = classifyGeminiError(error);
    console.error('[ai-planner] failure', JSON.stringify({ errorKind: failure.kind, providerStatus: failure.providerStatus }));
    return NextResponse.json({ error: failure.errorCode, message: failure.userMessage }, { status: failure.responseStatus });
  }

  return NextResponse.json({
    year,
    purpose: planTypes[purpose as typeof purposes[number]],
    source: holidayData.source,
    existingPlansChecked: existingPlansAvailable,
    recommendations,
    generatedAt: new Date().toISOString()
  }, { headers: { 'Cache-Control': 'no-store' } });
}