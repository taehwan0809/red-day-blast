export class PlanAuthenticationRequiredError extends Error {
  constructor() {
    super('계획을 저장하려면 로그인이 필요합니다. 로그인 후 황금연휴 분석으로 돌아와 다시 저장해 주세요.');
    this.name = 'PlanAuthenticationRequiredError';
  }
}

export class PlanPermissionError extends Error {
  constructor() {
    super('현재 계정에는 이 계획을 저장할 권한이 없습니다. 로그인 상태를 확인한 뒤 다시 시도해 주세요.');
    this.name = 'PlanPermissionError';
  }
}

export class PlanNetworkError extends Error {
  constructor() {
    super('네트워크 오류로 계획을 저장하지 못했어요. 연결을 확인한 뒤 다시 시도해 주세요.');
    this.name = 'PlanNetworkError';
  }
}

export function isPlanNetworkFailure(error: unknown) {
  if (error instanceof TypeError) return true;
  if (!error || typeof error !== 'object') return false;
  const details = error as { name?: unknown; message?: unknown };
  return /fetch|network|connection/i.test(String(details.name ?? '')) ||
    /failed to fetch|network|connection/i.test(String(details.message ?? ''));
}

export function planAuthFailure(error: unknown, hasUser: boolean) {
  if (!error && hasUser) return null;
  if (!error) return new PlanAuthenticationRequiredError();
  const details = error as { status?: number; name?: string };
  if (details.status === 401 || details.name === 'AuthSessionMissingError') return new PlanAuthenticationRequiredError();
  if (details.status === 403) return new PlanPermissionError();
  if (isPlanNetworkFailure(error)) return new PlanNetworkError();
  return new Error('로그인 상태를 확인하지 못했어요. 네트워크 연결을 확인한 뒤 다시 시도해 주세요.');
}

export function classifyPlanSaveError(error: unknown) {
  if (error instanceof PlanAuthenticationRequiredError) return { kind: 'login' as const, message: error.message };
  if (error instanceof PlanPermissionError) return { kind: 'permission' as const, message: error.message };
  if (error instanceof PlanNetworkError || isPlanNetworkFailure(error)) {
    return { kind: 'network' as const, message: error instanceof PlanNetworkError ? error.message : new PlanNetworkError().message };
  }
  return {
    kind: 'save' as const,
    message: error instanceof Error ? error.message : '계획을 저장하지 못했어요. 잠시 후 다시 시도해 주세요.'
  };
}

export async function runPlanSaveAction(saveAction: () => Promise<void>) {
  try {
    await saveAction();
    return { kind: 'success' as const, message: '내 계획에 저장했어요.' };
  } catch (error) {
    return classifyPlanSaveError(error);
  }
}
