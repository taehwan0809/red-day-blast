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
  const jsonStart = rawMessage.indexOf('{');
  const jsonEnd = rawMessage.lastIndexOf('}');
  if (jsonStart >= 0 && jsonEnd > jsonStart) {
    try {
      const parsed = JSON.parse(rawMessage.slice(jsonStart, jsonEnd + 1)) as {
        error?: { code?: unknown; type?: unknown; message?: unknown };
      };
      if (parsed.error && typeof parsed.error === 'object') {
        if (typeof parsed.error.code === 'string') code = parsed.error.code;
        else if (typeof parsed.error.type === 'string') code = parsed.error.type;
        if (typeof parsed.error.message === 'string') message = parsed.error.message;
      }
    } catch {
      // Preserve the provider body when it is not JSON.
    }
  }

  for (const value of sensitiveValues) {
    if (value.length >= 3) message = message.split(value).join('[redacted]');
  }
  message = message
    .replace(/gsk_[0-9A-Za-z_-]{12,}/g, '[redacted-api-key]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/[\w.%+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[redacted-email]')
    .slice(0, 1000);
  return { code, message: message || 'No provider message available.' };
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