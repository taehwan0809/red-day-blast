export type OpenAiFailure = {
  kind: 'invalid_key' | 'access_denied' | 'model_unavailable' | 'request_rejected' | 'rate_limited' | 'upstream_timeout' | 'temporarily_unavailable' | 'upstream_error';
  providerStatus: number | null;
  responseStatus: number;
  errorCode: string;
  userMessage: string;
};

function statusOf(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null;
  const value = (error as { status?: unknown; response?: { status?: unknown } }).status
    ?? (error as { response?: { status?: unknown } }).response?.status;
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

function nameOf(error: unknown) {
  return error && typeof error === 'object' && 'name' in error ? String((error as { name?: unknown }).name ?? '') : '';
}

export function classifyOpenAiError(error: unknown): OpenAiFailure {
  const providerStatus = statusOf(error);
  const name = nameOf(error);
  if (providerStatus === 401) return { kind: 'invalid_key', providerStatus, responseStatus: 503, errorCode: 'GPT_AUTHENTICATION_FAILED', userMessage: 'AI 인증에 실패했어요. 잠시 후 다시 시도해 주세요.' };
  if (providerStatus === 403) return { kind: 'access_denied', providerStatus, responseStatus: 503, errorCode: 'GPT_ACCESS_DENIED', userMessage: 'AI 서비스 접근 권한이 없어요. 잠시 후 다시 시도해 주세요.' };
  if (providerStatus === 404) return { kind: 'model_unavailable', providerStatus, responseStatus: 503, errorCode: 'GPT_MODEL_UNAVAILABLE', userMessage: 'AI 모델을 사용할 수 없어요. 잠시 후 다시 시도해 주세요.' };
  if (providerStatus === 429) return { kind: 'rate_limited', providerStatus, responseStatus: 429, errorCode: 'GPT_RATE_LIMITED', userMessage: 'AI 사용량 한도에 도달했어요. 잠시 후 다시 시도해 주세요.' };
  if (providerStatus === 408 || providerStatus === 504 || name === 'APIConnectionTimeoutError' || /timeout/i.test(name)) {
    return { kind: 'upstream_timeout', providerStatus, responseStatus: 504, errorCode: 'GPT_TIMEOUT', userMessage: 'AI 응답 시간이 초과됐어요. 잠시 후 다시 시도해 주세요.' };
  }
  if (providerStatus === 400) return { kind: 'request_rejected', providerStatus, responseStatus: 502, errorCode: 'GPT_REQUEST_REJECTED', userMessage: 'AI가 분석 요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.' };
  if (providerStatus !== null && providerStatus >= 500) {
    return { kind: 'temporarily_unavailable', providerStatus, responseStatus: 503, errorCode: 'GPT_TEMPORARILY_UNAVAILABLE', userMessage: 'AI 서비스가 일시적으로 응답하지 않아요. 잠시 후 다시 시도해 주세요.' };
  }
  if (name === 'APIConnectionError') return { kind: 'temporarily_unavailable', providerStatus, responseStatus: 503, errorCode: 'GPT_CONNECTION_FAILED', userMessage: 'AI 서비스에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.' };
  return { kind: 'upstream_error', providerStatus, responseStatus: 502, errorCode: 'GPT_ANALYSIS_FAILED', userMessage: 'AI 분석에 실패했어요. 잠시 후 다시 시도해 주세요.' };
}

export function classifyGptOutputError(error: unknown) {
  const invalidJson = error instanceof Error && error.message === 'AI response is not valid JSON';
  return {
    errorCode: invalidJson ? 'GPT_RESPONSE_JSON_INVALID' : 'GPT_RESPONSE_INVALID',
    errorKind: invalidJson ? 'json_parse_failed' : 'schema_validation_failed',
    userMessage: invalidJson ? 'AI 응답을 읽지 못했어요. 다시 분석해 주세요.' : 'AI 응답 형식이 올바르지 않아요. 다시 분석해 주세요.'
  };
}
