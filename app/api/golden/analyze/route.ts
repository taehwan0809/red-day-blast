import { GoogleGenAI } from '@google/genai';
import { NextResponse } from 'next/server';
import { buildGoldenAnalysisContext, resolveGeminiRecommendations, validateSelectedLeaveDates } from '@/lib/golden-analysis';
import { classifyGeminiError } from '@/lib/gemini-errors';
import { getHolidayData, isValidHolidayData } from '@/lib/holiday-service';

export const runtime = 'nodejs';
export const maxDuration = 30;

function requestId(request: Request) {
  const value = request.headers.get('x-vercel-id') ?? request.headers.get('x-request-id') ?? '';
  return /^[a-zA-Z0-9._:-]{1,100}$/.test(value) ? value : 'unavailable';
}

function logFailure(
  request: Request,
  stage: string,
  errorKind: string,
  providerStatus: number | null,
  responseStatus: number
) {
  console.error('[golden-analysis] failure', JSON.stringify({
    requestId: requestId(request), stage, errorKind, providerStatus, responseStatus
  }));
}

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
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    logFailure(request, 'configuration', 'api_key_missing', null, 503);
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

  let holidayData;
  try {
    holidayData = await getHolidayData(year);
  } catch {
    logFailure(request, 'holiday_lookup', 'holiday_data_unavailable', null, 503);
    return NextResponse.json({ error: 'HOLIDAY_DATA_UNAVAILABLE', message: `${year}년 공휴일 자료를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.` }, { status: 503 });
  }
  if (!isValidHolidayData(holidayData, year)) {
    logFailure(request, 'holiday_validation', 'holiday_data_invalid', null, 503);
    return NextResponse.json({ error: 'HOLIDAY_DATA_INVALID', message: '공휴일 자료 형식이 올바르지 않아 분석할 수 없어요.' }, { status: 503 });
  }
  if (holidayData.status === 'unavailable') {
    return NextResponse.json({
      error: 'HOLIDAY_DATA_UNAVAILABLE',
      message: `${year}년 공휴일 자료가 없어 분석할 수 없습니다.`
    }, { status: 503 });
  }
  if (holidayData.holidays.length === 0) {
    logFailure(request, 'holiday_validation', 'holiday_data_empty', null, 503);
    return NextResponse.json({ error: 'HOLIDAY_DATA_EMPTY', message: `${year}년 공휴일 자료가 비어 있어 분석할 수 없어요.` }, { status: 503 });
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
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        timeout: 12_000,
        retryOptions: { attempts: 2, initialDelay: 0.2, maxDelay: 0.5, jitter: 0 }
      }
    });
    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseJsonSchema: recommendationSchema(candidates.map(candidate => candidate.candidateId))
      }
    });
    responseText = response.text;
  } catch (error) {
    const failure = classifyGeminiError(error, apiKey);
    logFailure(request, 'generate_content', failure.kind, failure.providerStatus, failure.responseStatus);
    return NextResponse.json({ error: failure.errorCode, message: failure.userMessage }, { status: failure.responseStatus });
  }

  let recommendations;
  try {
    recommendations = resolveGeminiRecommendations(responseText, candidates);
  } catch (error) {
    const invalidJson = error instanceof Error && error.message === 'Gemini response is not valid JSON';
    const errorCode = invalidJson ? 'GEMINI_RESPONSE_JSON_INVALID' : 'GEMINI_RESPONSE_INVALID';
    logFailure(request, 'response_validation', invalidJson ? 'json_parse_failed' : 'schema_validation_failed', null, 502);
    return NextResponse.json({
      error: errorCode,
      message: invalidJson ? 'AI 응답을 JSON으로 읽지 못했어요. 다시 분석해 주세요.' : 'AI 응답 형식이 올바르지 않아요. 다시 분석해 주세요.'
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
