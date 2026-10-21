import { createClient, type SupabaseClient } from '@supabase/supabase-js';
export type PlanType='여행'|'휴식'|'공부'|'기타';
export type RestPlan={id:string;title:string;start:string;end:string;type:PlanType;memo:string;createdAt:string};
type PlanRow={id:string;user_id:string;title:string;start_date:string;end_date:string;plan_type:PlanType;memo:string;created_at:string};
type PlanInsert={id?:string;user_id:string;title:string;start_date:string;end_date:string;plan_type:PlanType;memo?:string;created_at?:string};
type PlanUpdate=Partial<Omit<PlanInsert,'user_id'>>;
type Database={public:{Tables:{rest_plans:{Row:PlanRow;Insert:PlanInsert;Update:PlanUpdate;Relationships:[]}};Views:Record<never,never>;Functions:Record<never,never>;Enums:Record<never,never>;CompositeTypes:Record<never,never>}};
const KEY='red-day-blast:plans:v1';
const url=process.env.NEXT_PUBLIC_SUPABASE_URL, anon=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
export const supabaseConfigured=Boolean(url&&anon);
let client:SupabaseClient<Database>|null=null;
export function getSupabase(){if(!supabaseConfigured)return null;return client??=createClient<Database>(url!,anon!);}
const validDate=(s:unknown):s is string=>{if(typeof s!=='string'||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(s))return false;const [y,m,d]=s.split('-').map(Number);const x=new Date(y,m-1,d);return x.getFullYear()===y&&x.getMonth()===m-1&&x.getDate()===d};
function readLocal():RestPlan[]{try{const raw=localStorage.getItem(KEY);if(!raw)return[];const v:unknown=JSON.parse(raw);if(!Array.isArray(v))return[];return v.filter((p):p is RestPlan=>Boolean(p)&&typeof p==='object'&&typeof p.id==='string'&&typeof p.title==='string'&&validDate(p.start)&&validDate(p.end)&&p.start<=p.end&&['여행','휴식','공부','기타'].includes(p.type)&&typeof p.memo==='string'&&typeof p.createdAt==='string')}catch{return[]}}
function writeLocal(plans:RestPlan[]){try{localStorage.setItem(KEY,JSON.stringify(plans));window.dispatchEvent(new Event('red-day-blast:plans'));return true}catch{return false}}
export function makePlan(data:Omit<RestPlan,'id'|'createdAt'>):RestPlan{return {...data,id:globalThis.crypto?.randomUUID?.()??`${Date.now()}-${Math.random().toString(36).slice(2)}`,createdAt:new Date().toISOString()}}
function fromRow(row:PlanRow):RestPlan{return {id:row.id,title:row.title,start:row.start_date,end:row.end_date,type:row.plan_type,memo:row.memo??'',createdAt:row.created_at}}
async function requireUser(){const supabase=getSupabase();if(!supabase)throw new Error('로그인 기능을 사용할 수 없어요. 잠시 후 다시 시도해 주세요.');const {data,error}=await supabase.auth.getUser();if(error||!data.user)throw new Error('내 계획을 보려면 먼저 로그인해 주세요.');return {supabase,user:data.user};}
const storageError='기기에 저장 공간이 부족해요. 공간을 확보한 뒤 다시 시도해 주세요.';
export async function listPlans():Promise<RestPlan[]>{if(!supabaseConfigured)return readLocal();const {supabase}=await requireUser();const {data,error}=await supabase.from('rest_plans').select('*').order('start_date');if(error)throw new Error('계획을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.');return (data??[]).map(fromRow)}
export async function savePlan(plan:RestPlan):Promise<void>{if(!supabaseConfigured){if(!writeLocal([plan,...readLocal()]))throw new Error(storageError);return}const {supabase,user}=await requireUser();const {error}=await supabase.from('rest_plans').insert({user_id:user.id,title:plan.title,start_date:plan.start,end_date:plan.end,plan_type:plan.type,memo:plan.memo});if(error)throw new Error('계획을 저장하지 못했어요. 잠시 후 다시 시도해 주세요.')}
export async function updatePlan(id:string,patch:Omit<RestPlan,'id'|'createdAt'>):Promise<void>{if(!supabaseConfigured){const plans=readLocal();if(!writeLocal(plans.map(p=>p.id===id?{...p,...patch}:p)))throw new Error(storageError);return}const {supabase,user}=await requireUser();const {data,error}=await supabase.from('rest_plans').update({title:patch.title,start_date:patch.start,end_date:patch.end,plan_type:patch.type,memo:patch.memo}).eq('id',id).eq('user_id',user.id).select('id').maybeSingle();if(error||!data)throw new Error('계획을 수정하지 못했어요. 잠시 후 다시 시도해 주세요.')}
export async function deletePlan(id:string):Promise<void>{if(!supabaseConfigured){if(!writeLocal(readLocal().filter(p=>p.id!==id)))throw new Error(storageError);return}const {supabase,user}=await requireUser();const {data,error}=await supabase.from('rest_plans').delete().eq('id',id).eq('user_id',user.id).select('id').maybeSingle();if(error||!data)throw new Error('계획을 삭제하지 못했어요. 잠시 후 다시 시도해 주세요.')}
export function localPlanCount(){return typeof window==='undefined'?0:readLocal().length}
export async function importLocalPlans(){if(!supabaseConfigured)return;const local=readLocal();if(!local.length)return;const {supabase,user}=await requireUser();const rows=local.map(p=>({user_id:user.id,title:p.title,start_date:p.start,end_date:p.end,plan_type:p.type,memo:p.memo}));const {error}=await supabase.from('rest_plans').insert(rows);if(error)throw new Error('기존 계획을 계정으로 옮기지 못했어요. 잠시 후 다시 시도해 주세요.');localStorage.removeItem(KEY);window.dispatchEvent(new Event('red-day-blast:plans'))}

