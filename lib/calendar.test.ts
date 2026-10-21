import test from 'node:test';
import assert from 'node:assert/strict';
import { dateKey, evaluateLeave, monthDays, recommendLeave, restPeriods, restStats } from './calendar';
import { HOLIDAYS } from './holidays';

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
