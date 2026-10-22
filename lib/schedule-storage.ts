'use client';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { ScheduleInput } from './schedule-check';
export type StoredScheduleAnalysis = Record<string, unknown> | null;
export type ScheduleState = { schedules: ScheduleInput[]; analysis: StoredScheduleAnalysis; updatedAt: string };
type Row = { user_id: string; schedules: ScheduleInput[]; analysis: StoredScheduleAnalysis; updated_at: string };
type Database = { public: { Tables: { schedule_check_data: { Row: Row; Insert: Row; Update: Partial<Row>; Relationships: [] } }; Views: Record<never, never>; Functions: Record<never, never>; Enums: Record<never, never>; CompositeTypes: Record<never, never> } };
const KEY = 'red-day-blast:schedule-check:v1';
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
export const scheduleSupabaseConfigured = Boolean(url && anonKey);
let client: SupabaseClient<Database> | null = null;
function getClient() { return client ??= createClient<Database>(url!, anonKey!); }
export function readLocalScheduleState(): ScheduleState | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (!value || typeof value !== 'object') return null;
    const state = value as Partial<ScheduleState>;
    if (!Array.isArray(state.schedules) || typeof state.updatedAt !== 'string') return null;
    return state as ScheduleState;
  } catch { return null; }
}
export function writeLocalScheduleState(state: ScheduleState) {
  localStorage.setItem(KEY, JSON.stringify(state));
  window.dispatchEvent(new Event('red-day-blast:schedules'));
}
export async function loadScheduleState(): Promise<{ state: ScheduleState | null; signedIn: boolean }> {
  if (!scheduleSupabaseConfigured) return { state: readLocalScheduleState(), signedIn: false };
  const supabase = getClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) return { state: null, signedIn: false };
  const { data, error } = await supabase.from('schedule_check_data').select('*').eq('user_id', auth.user.id).maybeSingle();
  if (error) throw new Error('계정에서 일정을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.');
  return { state: data ? { schedules: data.schedules, analysis: data.analysis, updatedAt: data.updated_at } : null, signedIn: true };
}
export async function saveScheduleState(state: ScheduleState): Promise<void> {
  if (!scheduleSupabaseConfigured) { writeLocalScheduleState(state); return; }
  const supabase = getClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) throw new Error('일정을 계정에 저장하려면 먼저 로그인해 주세요.');
  const { error } = await supabase.from('schedule_check_data').upsert({ user_id: auth.user.id, schedules: state.schedules, analysis: state.analysis, updated_at: state.updatedAt });
  if (error) throw new Error(error.code === '42501' ? '일정 저장 권한이 없어요. 로그인 상태와 데이터베이스 정책을 확인해 주세요.' : '일정을 계정에 저장하지 못했어요. 잠시 후 다시 시도해 주세요.');
}
