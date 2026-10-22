import OpenAI from 'openai';
import { NextResponse } from 'next/server';
import { buildGoldenAnalysisContext, resolveAiRecommendations, validateSelectedLeaveDates } from '@/lib/golden-analysis';
import { classifyGptOutputError, classifyOpenAiError } from '@/lib/openai-errors';
import { getGptModel } from '@/lib/gpt-config';
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
  const apiKey = process.env.GPT_API_KEY?.trim();
  if (!apiKey) {
    logFailure(request, 'configuration', 'api_key_missing', null, 503);
    return NextResponse.json({
      error: 'GPT_API_KEY_MISSING',
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
    '후보 JSON만 근거로 가장 추천하는 기간을 최대 3개 고르세요. 날짜나 계산값을 새로 만들거나 고치지 마세요.',
    '한국어로 이유, 연차 효율, 활용법을 각각 간결하게 작성하세요. candidateId는 입력 값만 쓰고 설명에 새 날짜나 기간 숫자를 넣지 마세요. 요청한 JSON 형식만 반환하세요.',
    JSON.stringify({
      year: context.year,
      holidayStatus: context.holidayStatus,
      candidates: candidates.map(({ candidateId, startDate, endDate, totalRestDays, requiredLeaveDays, leaveDates, holidays, efficiency }) => ({
        candidateId, startDate, endDate, totalRestDays, requiredLeaveDays, leaveDates, holidays, efficiency
      }))
    })
  ].join('\n\n');

  let responseText: string | undefined;
  try {
    const ai = new OpenAI({
      apiKey,
      // At most two 9-second requests; no second retry layer. This leaves
      // room for holiday lookup and response handling within maxDuration=30.
      timeout: 9_000,
      maxRetries: 1
    });
    const response = await ai.responses.create({
      model: getGptModel(),
      input: prompt,
      max_output_tokens: 900,
      text: {
        format: {
          type: 'json_schema',
          name: 'golden_holiday_recommendations',
          strict: true,
          schema: recommendationSchema(candidates.map(candidate => candidate.candidateId))
        }
      }
    });
    responseText = response.output_text;
  } catch (error) {
    const failure = classifyOpenAiError(error);
    logFailure(request, 'generate_content', failure.kind, failure.providerStatus, failure.responseStatus);
    return NextResponse.json({ error: failure.errorCode, message: failure.userMessage }, { status: failure.responseStatus });
  }

  let recommendations;
  try {
    recommendations = resolveAiRecommendations(responseText, candidates);
  } catch (error) {
    const failure = classifyGptOutputError(error);
    logFailure(request, 'response_validation', failure.errorKind, null, 502);
    return NextResponse.json({
      error: failure.errorCode,
      message: failure.userMessage
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
