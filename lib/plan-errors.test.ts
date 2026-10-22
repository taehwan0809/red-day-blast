import test from 'node:test';
import assert from 'node:assert/strict';
import { planAuthFailure, PlanAuthenticationRequiredError, PlanNetworkError, PlanPermissionError, classifyPlanSaveError, runPlanSaveAction } from './plan-errors';

test('save feedback distinguishes successful, unauthenticated, permission and network outcomes', async () => {
  assert.deepEqual(await runPlanSaveAction(async () => {}), { kind: 'success', message: '내 계획에 저장했어요.' });
  assert.equal(classifyPlanSaveError(new PlanAuthenticationRequiredError()).kind, 'login');
  assert.equal(classifyPlanSaveError(new PlanPermissionError()).kind, 'permission');
  assert.equal(classifyPlanSaveError(new PlanNetworkError()).kind, 'network');
  assert.equal(classifyPlanSaveError(new TypeError('Failed to fetch')).kind, 'network');
});

test('save action failures remain visible and are classified instead of being swallowed', async () => {
  const failure = await runPlanSaveAction(async () => { throw new Error('database rejected the insert'); });
  assert.equal(failure.kind, 'save');
  assert.match(failure.message, /database rejected/);
  const login = await runPlanSaveAction(async () => { throw new PlanAuthenticationRequiredError(); });
  assert.equal(login.kind, 'login');
  assert.match(login.message, /로그인이 필요/);
});

test('server-verified Supabase user lookup rejects missing users and distinguishes auth, permission and network failures', () => {
  assert.equal(planAuthFailure(null, true), null);
  assert.ok(planAuthFailure(null, false) instanceof PlanAuthenticationRequiredError);
  assert.ok(planAuthFailure({ name: 'AuthSessionMissingError' }, false) instanceof PlanAuthenticationRequiredError);
  assert.ok(planAuthFailure({ status: 403 }, true) instanceof PlanPermissionError);
  assert.ok(planAuthFailure(new TypeError('Failed to fetch'), true) instanceof PlanNetworkError);
});
