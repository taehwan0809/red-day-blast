export type GeminiFailure = {
  kind: 'configuration' | 'invalid_key' | 'access_denied' | 'model_unavailable' | 'rate_limited' | 'quota_exceeded' | 'timeout' | 'temporarily_unavailable' | 'request_rejected' | 'upstream_error';
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
  const value = error as { name?: unknown; message?: unknown; status?: unknown; error?: unknown };
  return [value.name, value.message, value.status, value.error].map(String).join(' ').toLowerCase();
}

export function getSafeGeminiErrorDetails(error: unknown, sensitiveValues: string[] = []) {
  const rawMessage = error instanceof Error ? error.message : '';
  let message = rawMessage;
  let code: string | null = null;
  const jsonStart = rawMessage.indexOf('{');
  const jsonEnd = rawMessage.lastIndexOf('}');
  if (jsonStart >= 0 && jsonEnd > jsonStart) {
    try {
      const parsed = JSON.parse(rawMessage.slice(jsonStart, jsonEnd + 1)) as {
        error?: { code?: unknown; status?: unknown; message?: unknown };
      };
      if (parsed.error && typeof parsed.error === 'object') {
        if (typeof parsed.error.code === 'string') code = parsed.error.code;
        else if (typeof parsed.error.status === 'string') code = parsed.error.status;
        if (typeof parsed.error.message === 'string') message = parsed.error.message;
      }
    } catch {
      // Keep the SDK's message when it is not a JSON error body.
    }
  }

  for (const value of sensitiveValues) {
    if (value.length >= 3) message = message.split(value).join('[redacted]');
  }
  message = message
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, '[redacted-api-key]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/[\w.%+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[redacted-email]')
    .slice(0, 1000);
  return { code, message: message || 'No provider message available.' };
}

export function classifyGeminiError(error: unknown): GeminiFailure {
  const providerStatus = statusOf(error);
  const details = textOf(error);
  if (details.includes('gemini_api_key_missing')) return {
    kind: 'configuration', providerStatus, responseStatus: 503, errorCode: 'GEMINI_API_KEY_MISSING',
    userMessage: 'Gemini API 설정이 완료되지 않았어요. 관리자에게 문의해 주세요.'
  };
  if (providerStatus === 401) return {
    kind: 'invalid_key', providerStatus, responseStatus: 503, errorCode: 'GEMINI_AUTHENTICATION_FAILED',
    userMessage: 'Gemini API 인증에 실패했어요. API 키 설정을 확인해 주세요.'
  };
  if (providerStatus === 403) return {
    kind: 'access_denied', providerStatus, responseStatus: 503, errorCode: 'GEMINI_ACCESS_DENIED',
    userMessage: 'Gemini API 접근 권한이 없어요. 프로젝트 설정을 확인해 주세요.'
  };
  if (providerStatus === 404) return {
    kind: 'model_unavailable', providerStatus, responseStatus: 503, errorCode: 'GEMINI_MODEL_UNAVAILABLE',
    userMessage: '설정한 Gemini 모델을 사용할 수 없어요. GEMINI_MODEL을 확인해 주세요.'
  };
  if (providerStatus === 429 && /quota|resource_exhausted|billing/.test(details)) return {
    kind: 'quota_exceeded', providerStatus, responseStatus: 429, errorCode: 'GEMINI_QUOTA_EXCEEDED',
    userMessage: 'Gemini API 사용 한도를 초과했어요. 한도가 갱신된 뒤 다시 시도해 주세요.'
  };
  if (providerStatus === 429) return {
    kind: 'rate_limited', providerStatus, responseStatus: 429, errorCode: 'GEMINI_RATE_LIMITED',
    userMessage: 'Gemini API 요청이 많아요. 잠시 후 다시 시도해 주세요.'
  };
  if (providerStatus === 408 || providerStatus === 504 || /timeout|timed out|aborterror/.test(details)) return {
    kind: 'timeout', providerStatus, responseStatus: 504, errorCode: 'GEMINI_TIMEOUT',
    userMessage: 'Gemini 응답 시간이 초과됐어요. 잠시 후 다시 시도해 주세요.'
  };
  if (providerStatus === 503 || (providerStatus !== null && providerStatus >= 500)) return {
    kind: 'temporarily_unavailable', providerStatus, responseStatus: 503, errorCode: 'GEMINI_TEMPORARILY_UNAVAILABLE',
    userMessage: 'Gemini 서비스가 일시적으로 응답하지 않아요. 잠시 후 다시 시도해 주세요.'
  };
  if (providerStatus === 400) return {
    kind: 'request_rejected', providerStatus, responseStatus: 502, errorCode: 'GEMINI_REQUEST_REJECTED',
    userMessage: 'Gemini가 요청을 처리하지 못했어요. 입력을 확인하고 다시 시도해 주세요.'
  };
  return {
    kind: 'upstream_error', providerStatus, responseStatus: 502, errorCode: 'GEMINI_REQUEST_FAILED',
    userMessage: 'Gemini 분석에 실패했어요. 잠시 후 다시 시도해 주세요.'
  };
}