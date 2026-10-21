import test from 'node:test';
import assert from 'node:assert/strict';
import { dateKey, evaluateLeave, goldenOptions, monthDays, recommendLeave, restPeriods, restStats } from './calendar';
import { HOLIDAYS, mergeHolidayData } from './holidays';

test('날짜 키와 실제 월 길이, 요일을 계산한다',()=>{
  assert.equal(dateKey(2024,1,29),'2024-02-29');
  assert.equal(monthDays(2024,1).length,29);
  assert.equal(monthDays(2025,1).length,28);
  assert.equal(monthDays(2026,9)[8].weekday,5); // 2026-10-09 금요일
});
test('주말과 공휴일이 겹치는 날은 휴식일 한 번으로 센다',()=>{
  const stats=restStats(2026,new Date(2026,0,1),HOLIDAYS[2026]);
  assert.equal(stats.total,120);
  assert.equal(monthDays(2026,5,HOLIDAYS[2026]).find(d=>d.date==='2026-06-06')?.rest,true);
  assert.equal(monthDays(2026,9,HOLIDAYS[2026]).find(d=>d.date==='2026-10-03')?.holiday,'개천절');
});
test('Google 단독 기념일은 제외하되 공식 지정된 같은 날짜는 공휴일로 유지한다',()=>{
  const armyDay={date:'2026-10-01',name:'국군의 날',kind:'national' as const};
  const unverified=mergeHolidayData(HOLIDAYS[2026], [{...armyDay,name:'국군의날'}]);
  assert.equal(unverified.some(h=>h.date===armyDay.date),false);
  assert.equal(monthDays(2026,9,unverified).find(d=>d.date===armyDay.date)?.rest,false);
  assert.equal(monthDays(2026,9,unverified).filter(d=>d.rest).length,11);
  assert.equal(restStats(2026,new Date(2026,9,1),unverified).thisMonth,11);

  const staleCachedArmyDay={...armyDay,name:'국군의날',verified:false};
  const staleCacheDays=monthDays(2026,9,[...HOLIDAYS[2026],staleCachedArmyDay]);
  assert.equal(staleCacheDays.find(d=>d.date===armyDay.date)?.holiday,undefined);
  assert.equal(staleCacheDays.filter(d=>d.rest).length,11);

  const unverifiedGovernmentHoliday={date:'2026-10-01',name:'임시공휴일',kind:'national' as const,verified:false};
  assert.equal(monthDays(2026,9,[...HOLIDAYS[2026],unverifiedGovernmentHoliday]).find(d=>d.date===armyDay.date)?.rest,true);

  const officiallyDeclared={date:'2027-10-01',name:'국군의 날 임시공휴일',kind:'national' as const};
  const verified=mergeHolidayData([officiallyDeclared], [{...officiallyDeclared,name:'국군의 날'}]);
  assert.deepEqual(verified.find(h=>h.date===officiallyDeclared.date),{...officiallyDeclared,verified:true});

  const verified2026=mergeHolidayData([...HOLIDAYS[2026],{...armyDay,name:'국군의 날 임시공휴일'}],[armyDay]);
  assert.equal(monthDays(2026,9,verified2026).filter(d=>d.rest).length,12);
});
test('공식 자료가 확인한 기념일은 Google 제목과 무관하게 포함한다',()=>{
  const constitutionDay={date:'2026-07-17',name:'제헌절',kind:'national' as const};
  const merged=mergeHolidayData([constitutionDay],[constitutionDay]);
  assert.deepEqual(merged,[{...constitutionDay,verified:true}]);
  assert.deepEqual(mergeHolidayData([],[{...constitutionDay,date:'2025-07-17'}]),[]);
});
test('공식 2026 달력에서 연속 휴식 기간을 정확히 찾는다',()=>{
  const periods=restPeriods(2026,HOLIDAYS[2026]);
  assert.equal(periods.length,10);
  assert.ok(periods.some(p=>p.start==='2026-02-14'&&p.end==='2026-02-18'&&p.days===5));
  assert.ok(periods.some(p=>p.start==='2026-09-24'&&p.end==='2026-09-27'&&p.days===4));
});
test('연차 선택은 쉬는 날을 거부하고 효율을 계산한다',()=>{
  assert.equal(evaluateLeave(2026,['2026-05-02'],HOLIDAYS[2026]).length,0);
  const result=evaluateLeave(2026,['2026-04-30'],HOLIDAYS[2026]);
  assert.ok(result.some(p=>p.start==='2026-04-30'&&p.end==='2026-05-03'&&p.days===4&&p.efficiency===4));
  assert.ok(recommendLeave(2026,HOLIDAYS[2026],1).some(p=>p.days>=4&&p.leaveDates.length===1));
});
test('월말·연말 이동과 윤년 날짜를 정확히 처리한다',()=>{
  assert.equal(monthDays(2024,1).length,29);
  assert.equal(monthDays(2024,1)[28].date,'2024-02-29');
  assert.equal(dateKey(2026,11,31),'2026-12-31');
  assert.equal(monthDays(2026,11)[30].weekday,4); // 2026-12-31 목요일
});
test('연차 추천은 주말·공휴일을 연차일로 중복 추천하지 않는다',()=>{
  const options=recommendLeave(2026,HOLIDAYS[2026],3);
  const rest=new Set(Array.from({length:12},(_,m)=>monthDays(2026,m,HOLIDAYS[2026])).flat().filter(d=>d.rest).map(d=>d.date));
  assert.ok(options.length>0);
  assert.ok(options.every(o=>o.leaveDates.every(d=>!rest.has(d))));
  assert.ok(options.every(o=>o.days>=3&&o.efficiency===Math.round(o.days/o.leaveDates.length*10)/10));
});
test('해당 연도의 휴식 통계가 연도 입력을 기준으로 다시 계산된다',()=>{
  const a=restStats(2026,new Date(2026,0,1),HOLIDAYS[2026]);
  const b=restStats(2025,new Date(2025,0,1),[]);
  assert.equal(a.total,120);
  assert.equal(b.total,104);
});

test('leave recommendations can bridge a weekend with consecutive workdays',()=>{
  const options=recommendLeave(2026,[],2);
  assert.ok(options.some(o=>o.start==='2026-04-03'&&o.end==='2026-04-06'&&o.leaveDates.join(',')==='2026-04-03,2026-04-06'&&o.days===4));
});

test('황금연휴 카드는 자연 연휴와 실제 필요한 연차 추천을 구분한다',()=>{
  const options=goldenOptions(2026,HOLIDAYS[2026]);
  const natural=options.natural.find(option=>option.start==='2026-02-14'&&option.end==='2026-02-18');
  assert.deepEqual(natural?.leaveDates,[]);
  assert.ok(options.withLeave.every(option=>option.leaveDates.length>0));
  assert.deepEqual([...new Set(options.withLeave.map(option=>option.leaveDates.length))],[1,2,3]);
  assert.ok(options.withLeave.every(option=>option.days>option.leaveDates.length));
});
