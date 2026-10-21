import { GoogleGenAI } from '@google/genai';
import { NextResponse } from 'next/server';
import { buildGoldenAnalysisContext, isGeminiRateLimitError, resolveGeminiRecommendations, validateSelectedLeaveDates } from '@/lib/golden-analysis';
import { getHolidayData } from '@/lib/holiday-service';

export const runtime = 'nodejs';
export const maxDuration = 30;

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
            reason: { type: 'string' },
            efficiencyAdvice: { type: 'string' },
            activitySuggestion: { type: 'string' }
          },
          required: ['candidateId', 'reason', 'efficiencyAdvice', 'activitySuggestion'],
          additionalProperties: false
        }
      }
    },
    required: ['recommendations'],
    additionalProperties: false
  };
}

export async function POST(request: Request) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({
      error: 'GEMINI_API_KEY_MISSING',
      message: 'AI 분석 설정이 아직 완료되지 않았어요. 잠시 후 다시 시도해 주세요.'
    }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'INVALID_JSON', message: '요청 형식이 올바르지 않아요.' }, { status: 400 });
  }
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'INVALID_REQUEST', message: '분석 요청을 확인해 주세요.' }, { status: 400 });
  }

  const payload = body as { year?: unknown; selectedLeaveDates?: unknown };
  const year = payload.year;
  if (typeof year !== 'number' || !Number.isInteger(year) || year < 1900 || year > 2100) {
    return NextResponse.json({ error: 'INVALID_YEAR', message: '분석할 연도를 확인해 주세요.' }, { status: 400 });
  }

  const holidayData = await getHolidayData(year);
  if (holidayData.status === 'unavailable') {
    return NextResponse.json({
      error: 'HOLIDAY_DATA_UNAVAILABLE',
      message: `${year}년 공휴일 자료가 없어 분석할 수 없습니다.`
    }, { status: 503 });
  }

  const leaveDateError = validateSelectedLeaveDates(year, payload.selectedLeaveDates, holidayData.holidays);
  if (leaveDateError) {
    return NextResponse.json({ error: 'INVALID_LEAVE_DATES', message: leaveDateError }, { status: 400 });
  }
  const selectedLeaveDates = (payload.selectedLeaveDates ?? []) as string[];
  const context = buildGoldenAnalysisContext(holidayData, selectedLeaveDates);
  const candidates = [
    ...context.naturalBreaks,
    ...context.leaveOptions[1],
    ...context.leaveOptions[2],
    ...context.leaveOptions[3],
    ...context.selectedLeavePlans
  ];
  if (!candidates.length) {
    return NextResponse.json({
      year,
      source: holidayData.source,
      recommendations: [],
      generatedAt: new Date().toISOString()
    });
  }

  const prompt = [
    '당신은 한국의 연차와 휴일을 고려하는 여행·휴식 계획 도우미입니다.',
    '아래 JSON에 있는 공휴일과 후보만 사용하세요. 후보에 없는 날짜, 공휴일, 연속 휴일 수를 만들거나 수정하지 마세요.',
    '가장 추천하는 황금연휴를 최대 3개 고르고, 연차 대비 효율, 추천 이유, 여행 또는 휴식 활용법을 한국어로 작성하세요.',
    'candidateId는 제공된 후보 ID 중에서만 선택하세요. 설명 문장에는 날짜나 숫자로 된 기간을 쓰지 말고, 후보 ID에 연결된 서버 계산 결과만 사용합니다.',
    JSON.stringify({
      year: context.year,
      holidaySource: context.source,
      holidayStatus: context.holidayStatus,
      officialAndCalendarHolidayData: context.holidays,
      naturallyConnectedBreaks: context.naturalBreaks,
      optionsUsingOneLeaveDay: context.leaveOptions[1],
      optionsUsingTwoLeaveDays: context.leaveOptions[2],
      optionsUsingThreeLeaveDays: context.leaveOptions[3],
      userSelectedLeaveDates: context.selectedLeaveDates,
      plansUsingSelectedLeaveDates: context.selectedLeavePlans,
      allowedCandidates: candidates
    })
  ].join('\n\n');

  let responseText: string | undefined;
  try {
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseJsonSchema: recommendationSchema(candidates.map(candidate => candidate.candidateId))
      }
    });
    responseText = response.text;
  } catch (error) {
    if (isGeminiRateLimitError(error)) {
      return NextResponse.json({
        error: 'GEMINI_RATE_LIMITED',
        message: 'AI 요청이 잠시 많아요. 잠시 후 다시 분석해 주세요.'
      }, { status: 429 });
    }
    return NextResponse.json({
      error: 'GEMINI_REQUEST_FAILED',
      message: 'Gemini 분석 요청에 실패했어요. 잠시 후 다시 시도해 주세요.'
    }, { status: 502 });
  }

  let recommendations;
  try {
    recommendations = resolveGeminiRecommendations(responseText, candidates);
  } catch {
    return NextResponse.json({
      error: 'GEMINI_RESPONSE_INVALID',
      message: '분석 결과를 확인하지 못했어요. 다시 분석해 주세요.'
    }, { status: 502 });
  }

  return NextResponse.json({
    year,
    source: holidayData.source,
    holidayStatus: holidayData.status,
    generatedAt: new Date().toISOString(),
    recommendations
  });
}
