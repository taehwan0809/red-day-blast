export type GeminiFailureKind =
  | 'invalid_key'
  | 'model_unavailable'
  | 'request_rejected'
  | 'rate_limited'
  | 'temporarily_unavailable'
  | 'upstream_timeout'
  | 'upstream_error';

export type GeminiFailure = {
  kind: GeminiFailureKind;
  providerStatus: number | null;
  responseStatus: number;
  errorCode: string;
  userMessage: string;
  safeProviderMessage: string;
  retryable: boolean;
};

function providerStatus(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null;
  const details = error as { status?: unknown; response?: { status?: unknown }; cause?: { status?: unknown } };
  for (const value of [details.status, details.response?.status, details.cause?.status]) {
    if (typeof value === 'number' && Number.isInteger(value)) return value;
  }
  return null;
}

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : typeof error === 'string' ? error : 'Unknown Gemini API error';
}

export function sanitizeGeminiErrorMessage(message: string, apiKey?: string) {
  let safe = message.replace(/[\r\n\t]+/g, ' ');
  if (apiKey) safe = safe.replaceAll(apiKey, '[redacted]');
  return safe
    .replace(/([?&](?:key|api_key|apiKey)=)[^&\s"'<>]+/gi, '$1[redacted]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]')
    .slice(0, 400);
}

export function classifyGeminiError(error: unknown, apiKey?: string): GeminiFailure {
  const status = providerStatus(error);
  const providerMessage = messageOf(error);
  const safeProviderMessage = sanitizeGeminiErrorMessage(providerMessage, apiKey);
  const invalidKeyMessage = /api[ _-]?key.*(?:invalid|not valid|expired)|(?:invalid|not valid|expired).*api[ _-]?key/i.test(providerMessage);

  if (status === 401 || status === 403 || (status === 400 && invalidKeyMessage)) {
    return {
      kind: 'invalid_key', providerStatus: status, responseStatus: 503, errorCode: 'GEMINI_AUTH_FAILED',
      userMessage: 'Gemini API 키가 유효하지 않거나 권한이 없어요. 서버 환경변수를 확인해 주세요.',
      safeProviderMessage, retryable: false
    };
  }
  if (status === 404) {
    return {
      kind: 'model_unavailable', providerStatus: status, responseStatus: 502, errorCode: 'GEMINI_MODEL_UNAVAILABLE',
      userMessage: 'Gemini 모델을 사용할 수 없어요. 서버 모델 설정을 확인해 주세요.',
      safeProviderMessage, retryable: false
    };
  }
  if (status === 400 && /model.{0,40}(?:not found|not available|unsupported|invalid)/i.test(providerMessage)) {
    return {
      kind: 'model_unavailable', providerStatus: status, responseStatus: 502, errorCode: 'GEMINI_MODEL_UNAVAILABLE',
      userMessage: 'Gemini 모델을 사용할 수 없어요. 서버 모델 설정을 확인해 주세요.',
      safeProviderMessage, retryable: false
    };
  }
  if (status === 429) {
    return {
      kind: 'rate_limited', providerStatus: status, responseStatus: 429, errorCode: 'GEMINI_RATE_LIMITED',
      userMessage: 'AI 요청이 잠시 많아요. 잠시 후 다시 분석해 주세요.',
      safeProviderMessage, retryable: false
    };
  }
  if (status === 400) {
    return {
      kind: 'request_rejected', providerStatus: status, responseStatus: 502, errorCode: 'GEMINI_REQUEST_REJECTED',
      userMessage: 'Gemini가 분석 요청을 처리하지 못했어요. 서버 요청 형식을 확인해 주세요.',
      safeProviderMessage, retryable: false
    };
  }
  if (status === 500) {
    return {
      kind: 'temporarily_unavailable', providerStatus: status, responseStatus: 502, errorCode: 'GEMINI_INTERNAL_ERROR',
      userMessage: 'Gemini 내부 오류가 발생했어요. 잠시 후 다시 시도해 주세요.',
      safeProviderMessage, retryable: true
    };
  }
  if (status === 503) {
    return {
      kind: 'temporarily_unavailable', providerStatus: status, responseStatus: 503, errorCode: 'GEMINI_SERVICE_UNAVAILABLE',
      userMessage: 'Gemini 서비스가 잠시 중단됐어요. 잠시 후 다시 시도해 주세요.',
      safeProviderMessage, retryable: true
    };
  }
  if (status !== null && status >= 500) {
    return {
      kind: 'upstream_error', providerStatus: status, responseStatus: 502, errorCode: 'GEMINI_UPSTREAM_ERROR',
      userMessage: 'Gemini 분석 요청에 실패했어요. 잠시 후 다시 시도해 주세요.',
      safeProviderMessage, retryable: false
    };
  }
  if (/timeout|timed out|aborted/i.test(providerMessage)) {
    return {
      kind: 'upstream_timeout', providerStatus: status, responseStatus: 504, errorCode: 'GEMINI_TIMEOUT',
      userMessage: 'Gemini 응답 시간이 초과됐어요. 잠시 후 다시 시도해 주세요.',
      safeProviderMessage, retryable: false
    };
  }
  return {
    kind: 'upstream_error', providerStatus: status, responseStatus: 502, errorCode: 'GEMINI_UPSTREAM_ERROR',
    userMessage: 'Gemini 분석 요청에 실패했어요. 잠시 후 다시 시도해 주세요.',
    safeProviderMessage, retryable: false
  };
}

export async function withOneTransientRetry<T>(
  operation: () => Promise<T>,
  onRetry: (failure: GeminiFailure) => void,
  wait: () => Promise<void>
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    const failure = classifyGeminiError(error);
    if (!failure.retryable) throw error;
    onRetry(failure);
    await wait();
    return operation();
  }
}
