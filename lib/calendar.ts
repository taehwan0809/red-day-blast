import { HOLIDAYS, type Holiday, type MergedHoliday } from './holidays';
export type DayInfo = { date: string; day: number; weekday: number; holiday?: string; weekend: boolean; rest: boolean };
export const dateKey = (year:number, month:number, day:number) => `${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
export function findNextHoliday(holidayList:(Holiday|MergedHoliday)[], todayKey:string) {
  return holidayList.filter(holiday => !('verified' in holiday && holiday.verified === false) && holiday.date >= todayKey)
    .sort((a,b)=>a.date.localeCompare(b.date))[0];
}
export function daysBetweenDateKeys(from:string, to:string) {
  const parse = (key:string) => { const [year,month,day]=key.split('-').map(Number); return Date.UTC(year,month-1,day); };
  return Math.round((parse(to)-parse(from))/86_400_000);
}
export function koreaToday(){const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());const value=(type:Intl.DateTimeFormatPartTypes)=>Number(parts.find(part=>part.type===type)?.value);return new Date(value('year'),value('month')-1,value('day'),12)}
const shiftDate = (key:string, offset:number) => {const [y,m,d]=key.split('-').map(Number); const date=new Date(y,m-1,d+offset); return dateKey(date.getFullYear(),date.getMonth(),date.getDate())};
export function monthDays(year:number, month:number, holidayList:(Holiday|MergedHoliday)[]=HOLIDAYS[year]??[]): DayInfo[] {
  const total = new Date(year, month+1, 0).getDate();
  const holidays = new Map(holidayList
    .filter(h => !('verified' in h && h.verified === false))
    .map(h => [h.date,h.name]));
  return Array.from({length:total},(_,i)=> { const day=i+1, weekday=new Date(year,month,day).getDay(), date=dateKey(year,month,day), holiday=holidays.get(date); return {date,day,weekday,holiday,weekend:weekday===0||weekday===6,rest:Boolean(holiday)||weekday===0||weekday===6}; });
}
export function restStats(year:number, today = new Date(), holidayList:(Holiday|MergedHoliday)[]=HOLIDAYS[year]??[]) {
  const all=Array.from({length:12},(_,m)=>monthDays(year,m,holidayList)).flat();
  const key=dateKey(today.getFullYear(),today.getMonth(),today.getDate());
  const holidays=holidayList.filter(h => !('verified' in h && h.verified === false));
  let longest=0,run=0; all.forEach(d=>{run=d.rest?run+1:0;longest=Math.max(longest,run)});
  return { total:all.filter(d=>d.rest).length, remaining:all.filter(d=>d.rest&&d.date>=key).length, thisMonth:year===today.getFullYear()?monthDays(year,today.getMonth(),holidayList).filter(d=>d.rest).length:all.filter(d=>d.rest).length, longest, holidays };
}

export type RestPeriod = { start:string; end:string; days:number; holidays:string[] };
export function restPeriods(year:number, holidayList:Holiday[]=HOLIDAYS[year]??[], minimum=3):RestPeriod[] {
  const days=Array.from({length:12},(_,m)=>monthDays(year,m,holidayList)).flat();
  const periods:RestPeriod[]=[]; let run:DayInfo[]=[];
  const flush=()=>{if(run.length>=minimum)periods.push({start:run[0].date,end:run[run.length-1].date,days:run.length,holidays:run.flatMap(d=>d.holiday?[d.holiday]:[])});run=[]};
  for(const day of days){if(day.rest)run.push(day);else flush()} flush(); return periods;
}

export type LeaveOption = RestPeriod & { leaveDates:string[]; efficiency:number };
export type LeaveImpact = RestPeriod & { leaveDates:string[]; efficiency:number };
export type GoldenOptions = { natural: (RestPeriod & { leaveDates:string[] })[]; withLeave: LeaveOption[] };
export function evaluateLeave(year:number, leaveDates:string[], holidayList:Holiday[]=HOLIDAYS[year]??[]):LeaveImpact[] {
  const days=Array.from({length:12},(_,m)=>monthDays(year,m,holidayList)).flat();const available=new Set(days.filter(d=>d.rest).map(d=>d.date));
  const valid=leaveDates.filter(d=>days.some(x=>x.date===d&&!x.rest));const all=new Set([...available,...valid]);const result:LeaveImpact[]=[];let run:DayInfo[]=[];
  const flush=()=>{const chosen=run.filter(d=>valid.includes(d.date)).map(d=>d.date);if(run.length>=3&&chosen.length){result.push({start:run[0].date,end:run[run.length-1].date,days:run.length,holidays:run.flatMap(d=>d.holiday?[d.holiday]:[]),leaveDates:chosen,efficiency:Math.round(run.length/chosen.length*10)/10})}run=[]};
  for(const d of days){if(all.has(d.date))run.push(d);else flush()}flush();return result.sort((a,b)=>b.efficiency-a.efficiency||b.days-a.days);
}
export function recommendLeave(year:number, holidayList:Holiday[]=HOLIDAYS[year]??[], maxLeave=3):LeaveOption[] {
  const calendar=Array.from({length:12},(_,m)=>monthDays(year,m,holidayList)).flat();
  const rest=new Set(calendar.filter(d=>d.rest).map(d=>d.date));
  const options:LeaveOption[]=[];
  const workdays=calendar.filter(d=>!d.rest);
  for(let first=0;first<workdays.length;first++){
    for(let count=1;count<=maxLeave&&first+count<=workdays.length;count++){
      const leaveDates=workdays.slice(first,first+count).map(d=>d.date);
      const full=new Set([...rest,...leaveDates]); let start=leaveDates[0],end=leaveDates[leaveDates.length-1];
      while(full.has(shiftDate(start,-1))) start=shiftDate(start,-1);
      while(full.has(shiftDate(end,1))) end=shiftDate(end,1);
      const span=Math.round((new Date(end+'T12:00:00').getTime()-new Date(start+'T12:00:00').getTime())/86400000)+1;
      if(span>=3) options.push({start,end,days:span,leaveDates,holidays:holidayList.filter(h=>h.date>=start&&h.date<=end).map(h=>h.name),efficiency:Math.round((span/count)*10)/10});
    }
  }
  const unique=new Map<string,LeaveOption>(); for(const o of options){const k=`${o.start}:${o.end}:${o.leaveDates.join(',')}`;unique.set(k,o)}
  return [...unique.values()].sort((a,b)=>b.efficiency-a.efficiency||b.days-a.days);
}

export function goldenOptions(year:number, holidayList:Holiday[]=HOLIDAYS[year]??[], maxLeave=3, recommendationLimit=6):GoldenOptions {
  const recommendations = recommendLeave(year,holidayList,maxLeave);
  const byLeaveCount = Array.from({length:maxLeave},(_,index)=>recommendations.filter(option=>option.leaveDates.length===index+1));
  const withLeave:LeaveOption[] = [];
  for(let rank=0;withLeave.length<recommendationLimit;rank++){
    let found=false;
    for(const options of byLeaveCount){
      if(options[rank]&&withLeave.length<recommendationLimit){withLeave.push(options[rank]);found=true}
    }
    if(!found)break;
  }
  return {
    natural: restPeriods(year,holidayList).map(period=>({...period,leaveDates:[]})),
    withLeave
  };
}
