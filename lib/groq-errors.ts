export type GroqFailure = {
  kind: 'configuration' | 'invalid_key' | 'access_denied' | 'model_unavailable' | 'rate_limited' | 'quota_exceeded' | 'timeout' | 'temporarily_unavailable' | 'request_rejected' | 'network' | 'upstream_error';
  providerStatus: number | null;
  responseStatus: number;
  errorCode: string;
  userMessage: string;
};

function statusOf(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null;
  const status = (error as { status?: unknown; response?: { status?: unknown } }).status
    ?? (error as { response?: { status?: unknown } }).response?.status;
  return typeof status === 'number' && Number.isInteger(status) ? status : null;
}

function textOf(error: unknown) {
  if (!error || typeof error !== 'object') return String(error ?? '');
  const value = error as { name?: unknown; message?: unknown; status?: unknown };
  return [value.name, value.message, value.status].map(String).join(' ').toLowerCase();
}

export function getSafeGroqErrorDetails(error: unknown, sensitiveValues: string[] = []) {
  const rawMessage = error instanceof Error ? error.message : '';
  let message = rawMessage;
  let code: string | null = null;
  let failedGeneration: string | undefined;
  const jsonStart = rawMessage.indexOf('{');
  const jsonEnd = rawMessage.lastIndexOf('}');
  if (jsonStart >= 0 && jsonEnd > jsonStart) {
    try {
      const parsed = JSON.parse(rawMessage.slice(jsonStart, jsonEnd + 1)) as {
        error?: { code?: unknown; type?: unknown; message?: unknown; failed_generation?: unknown };
        failed_generation?: unknown;
      };
      const payload: { code?: unknown; type?: unknown; message?: unknown; failed_generation?: unknown } =
        parsed.error && typeof parsed.error === 'object' ? parsed.error : parsed;
      if (typeof payload.code === 'string') code = payload.code;
      else if (typeof payload.type === 'string') code = payload.type;
      if (typeof payload.message === 'string') message = payload.message;
      const generation = payload.failed_generation ?? parsed.failed_generation;
      if (typeof generation === 'string') failedGeneration = generation;
      else if (generation !== undefined) failedGeneration = JSON.stringify(generation);
    } catch {
      // Preserve the provider body when it is not JSON.
    }
  }

  return {
    code,
    message: sanitizeProviderText(message, sensitiveValues, 1000) || 'No provider message available.',
    failedGeneration: failedGeneration === undefined
      ? undefined
      : sanitizeFailedGeneration(failedGeneration, sensitiveValues)
  };
}

const plannerFieldNames = new Set(['recommendations', 'candidateId', 'title', 'description', 'reason', 'advantages', 'disadvantages', 'true', 'false', 'null']);

function sanitizeProviderText(value: string, sensitiveValues: string[], maxLength: number) {
  let sanitized = value;
  for (const secret of sensitiveValues) {
    if (secret.length >= 3) sanitized = sanitized.split(secret).join('[redacted]');
  }
  return sanitized
    .replace(/gsk_[0-9A-Za-z_-]{12,}/g, '[redacted-api-key]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/[\w.%+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[redacted-email]')
    .replace(/(?:\+?82[- ]?)?0\d{1,2}[- ]?\d{3,4}[- ]?\d{4}/g, '[redacted-phone]')
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, '[redacted-date]')
    .slice(0, maxLength);
}

function sanitizeFailedGeneration(value: string, sensitiveValues: string[]) {
  const redacted = sanitizeProviderText(value, sensitiveValues, 10_000)
    .replace(/"((?:\\.|[^"\\])*)"/g, (match, key: string, offset: number, source: string) => {
      const followsColon = source.slice(offset + match.length).trimStart().startsWith(':');
      return followsColon && plannerFieldNames.has(key) ? match : '"[redacted]"';
    })
    .replace(/\b[A-Za-z][A-Za-z0-9_-]*\b/g, token => plannerFieldNames.has(token) ? token : '[redacted]')
    .replace(/[\p{Script=Hangul}\p{Script=Han}]{2,}/gu, '[redacted]');
  return redacted.slice(0, 400);
}

export function classifyGroqError(error: unknown): GroqFailure {
  const providerStatus = statusOf(error);
  const details = textOf(error);
  if (details.includes('groq_api_key_missing')) return {
    kind: 'configuration', providerStatus, responseStatus: 503, errorCode: 'GROQ_API_KEY_MISSING',
    userMessage: 'Groq API 키가 설정되지 않았어요. 관리자에게 문의해 주세요.'
  };
  if (details.includes('groq_model_missing')) return {
    kind: 'configuration', providerStatus, responseStatus: 503, errorCode: 'GROQ_MODEL_MISSING',
    userMessage: 'Groq 모델이 설정되지 않았어요. 관리자에게 문의해 주세요.'
  };
  if (providerStatus === 401) return {
    kind: 'invalid_key', providerStatus, responseStatus: 503, errorCode: 'GROQ_AUTHENTICATION_FAILED',
    userMessage: 'Groq API 인증에 실패했어요. API 키 설정을 확인해 주세요.'
  };
  if (providerStatus === 403) return {
    kind: 'access_denied', providerStatus, responseStatus: 503, errorCode: 'GROQ_ACCESS_DENIED',
    userMessage: 'Groq API 접근 권한이 없어요. 프로젝트 설정을 확인해 주세요.'
  };
  if (providerStatus === 404) return {
    kind: 'model_unavailable', providerStatus, responseStatus: 503, errorCode: 'GROQ_MODEL_UNAVAILABLE',
    userMessage: '설정한 Groq 모델을 사용할 수 없어요. 공식 모델 목록에서 모델 ID를 확인해 주세요.'
  };
  if (providerStatus === 429 && /quota|daily|billing|credit/.test(details)) return {
    kind: 'quota_exceeded', providerStatus, responseStatus: 429, errorCode: 'GROQ_QUOTA_EXCEEDED',
    userMessage: 'Groq API 사용 한도에 도달했어요. 한도가 갱신된 뒤 다시 시도해 주세요.'
  };
  if (providerStatus === 429) return {
    kind: 'rate_limited', providerStatus, responseStatus: 429, errorCode: 'GROQ_RATE_LIMITED',
    userMessage: 'Groq API 요청이 많아요. 잠시 후 다시 시도해 주세요.'
  };
  if (providerStatus === 408 || providerStatus === 504 || /timeout|timed out|aborterror/.test(details)) return {
    kind: 'timeout', providerStatus, responseStatus: 504, errorCode: 'GROQ_TIMEOUT',
    userMessage: 'Groq 응답 시간이 초과됐어요. 잠시 후 다시 시도해 주세요.'
  };
  if ([500, 502, 503].includes(providerStatus ?? 0)) return {
    kind: 'temporarily_unavailable', providerStatus, responseStatus: providerStatus!, errorCode: 'GROQ_TEMPORARILY_UNAVAILABLE',
    userMessage: 'Groq 서비스가 일시적으로 응답하지 않아요. 잠시 후 다시 시도해 주세요.'
  };
  if (providerStatus !== null && providerStatus >= 500) return {
    kind: 'temporarily_unavailable', providerStatus, responseStatus: 503, errorCode: 'GROQ_TEMPORARILY_UNAVAILABLE',
    userMessage: 'Groq 서비스가 일시적으로 응답하지 않아요. 잠시 후 다시 시도해 주세요.'
  };
  if (providerStatus === 400 && /json_validate_failed/.test(details)) return {
    kind: 'request_rejected', providerStatus, responseStatus: 502, errorCode: 'GROQ_JSON_GENERATION_FAILED',
    userMessage: 'AI가 올바른 JSON 응답을 만들지 못했어요. 잠시 후 다시 시도해 주세요.'
  };
  if (providerStatus === 400) return {
    kind: 'request_rejected', providerStatus, responseStatus: 502, errorCode: 'GROQ_REQUEST_REJECTED',
    userMessage: 'Groq가 요청을 처리하지 못했어요. 입력과 모델 설정을 확인해 주세요.'
  };
  if (error instanceof TypeError || /fetch failed|network|econn|enotfound/.test(details)) return {
    kind: 'network', providerStatus, responseStatus: 503, errorCode: 'GROQ_NETWORK_ERROR',
    userMessage: 'Groq 서비스에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.'
  };
  return {
    kind: 'upstream_error', providerStatus, responseStatus: 502, errorCode: 'GROQ_REQUEST_FAILED',
    userMessage: 'AI 요청에 실패했어요. 잠시 후 다시 시도해 주세요.'
  };
}