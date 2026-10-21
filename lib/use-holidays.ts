'use client';
import { useEffect, useState } from 'react';
import { HOLIDAYS, type Holiday } from './holidays';
type Value={year:number;holidays:(Holiday & {verified?:boolean})[];status:'official'|'partial'|'unverified'|'unavailable';source:string|null;updatedAt:string|null;googleStatus?:'ok'|'error'|'not-configured';loading:boolean};
export function useHolidays(year:number):Value {
 const fallback=():Omit<Value,'year'>=>({holidays:HOLIDAYS[year]??[],status:HOLIDAYS[year]?'official':'unavailable',source:HOLIDAYS[year]?'한국천문연구원 2026 월력요항 + 2026년 공휴일 법령 확인 자료':null,updatedAt:HOLIDAYS[year]?'2026-04-30':null,loading:true});
 const [state,setState]=useState<Value>(()=>({year,...fallback()}));
 useEffect(()=>{let active=true; fetch(`/api/holidays?year=${year}`).then(async r=>{if(!r.ok)throw new Error('holiday data unavailable');return r.json()}).then(d=>{if(active)setState({year,holidays:d.holidays??[],status:d.status,source:d.source,updatedAt:d.updatedAt??null,googleStatus:d.googleStatus,loading:false})}).catch(()=>{if(active)setState({year,...fallback(),loading:false})}); return()=>{active=false}},[year]);
 return state.year===year?state:{year,...fallback()};
}

