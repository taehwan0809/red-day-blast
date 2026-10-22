'use client';

import { useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Plus, RotateCcw } from 'lucide-react';
import { SiteHeader } from '@/components/SiteHeader';
import { PageTitle } from '@/components/PageTitle';
import { useHolidays } from '@/lib/use-holidays';
import { evaluateLeave, koreaToday, monthDays, recommendLeave } from '@/lib/calendar';
import { makePlan, savePlan } from '@/lib/plans';

const week = ['일', '월', '화', '수', '목', '금', '토'];

type LeavePeriod = {
  start: string;
  end: string;
  days: number;
  leaveDates: string[];
};

export default function LeavePage() {
  const now = koreaToday();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [limit, setLimit] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const data = useHolidays(year);
  const days = useMemo(() => monthDays(year, month, data.holidays), [year, month, data.holidays]);
  const first = new Date(year, month, 1).getDay();
  const impact = useMemo(() => evaluateLeave(year, selected, data.holidays), [year, selected, data.holidays]);
  const recommendations = useMemo(
    () => data.status !== 'unavailable' ? recommendLeave(year, data.holidays, limit).slice(0, 6) : [],
    [year, limit, data.status, data.holidays]
  );

  function move(offset: number) {
    const next = new Date(year, month + offset, 1);
    setYear(next.getFullYear());
    setMonth(next.getMonth());
  }

  function toggle(date: string) {
    const day = days.find(item => item.date === date);
    if (!day || day.rest) return;
    setMessage('');
    setSelected(current =>
      current.includes(date)
        ? current.filter(item => item !== date)
        : current.length < limit ? [...current, date].sort() : current
    );
  }

  function applyRecommendation(option: LeavePeriod) {
    setSelected(option.leaveDates);
    setMessage('');
    const [selectedYear, selectedMonth] = option.start.split('-').map(Number);
    setYear(selectedYear);
    setMonth(selectedMonth - 1);
  }

  async function save(option: LeavePeriod) {
    const leaveCount = option.leaveDates.length;
    try {
      await savePlan(makePlan({
        title: '연차 ' + leaveCount + '일 · ' + option.days + '일 휴식',
        start: option.start,
        end: option.end,
        type: '휴식',
        memo: '연차 효율 계산기 추천 · 연속 휴식 ' + option.days + '일 · 연차 사용일 ' + option.leaveDates.join(', ')
      }));
      setMessage('계획을 저장했어요. 내 계획에서 확인할 수 있어요.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '계획을 저장하지 못했어요. 잠시 후 다시 시도해 주세요.');
    }
  }

  return (
    <>
      <SiteHeader active="/leave" />
      <main className="mx-auto max-w-[1180px] px-5 py-8 md:px-10 md:py-12">
        <PageTitle
          eyebrow="MAKE EVERY DAY OFF COUNT"
          title="연차 효율 계산기"
          description="연차를 쓸 날짜를 고르거나 추천 조합을 적용해 이어지는 휴식 기간을 확인하세요."
        >
          <label className="flex items-center gap-2 text-xs">
            사용 연차 제한
            <select
              className="border border-black/15 bg-transparent p-2 font-bold"
              value={limit}
              onChange={event => {
                setLimit(Number(event.target.value));
                setSelected([]);
              }}
            >
              {[1, 2, 3].map(count => <option key={count} value={count}>{count}일</option>)}
            </select>
          </label>
        </PageTitle>

        <div className="mb-6 border-l-2 border-[#f04432] bg-white p-4 text-xs leading-5 text-black/60">
          토·일요일과 공식 공휴일은 쉬는 날로 계산합니다. 실제 근무일과 회사별 휴무일은 다를 수 있어요. 이미 쉬는 날인 주말·공휴일은 연차 추천에서 제외합니다.
        </div>

        {data.status === 'unavailable' ? (
          <div className="bg-white p-6 text-sm">
            {data.loading ? '공식 공휴일 데이터를 확인하고 있어요.' : year + '년 공휴일 데이터가 없어 연차 효율을 계산할 수 없습니다.'}
          </div>
        ) : (
          <>
            <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
              <section className="bg-white p-4 md:p-7" aria-labelledby="leave-calendar-title">
                <div className="mb-4 flex items-center justify-between">
                  <button type="button" aria-label="이전 달" onClick={() => move(-1)}><ChevronLeft /></button>
                  <h2 id="leave-calendar-title" className="font-bold">{year}년 {month + 1}월</h2>
                  <button type="button" aria-label="다음 달" onClick={() => move(1)}><ChevronRight /></button>
                </div>
                <p className="mb-4 text-xs text-black/45">
                  평일 날짜를 눌러 선택하세요. 추천 연차 {limit}일 · {selected.length}일 선택됨
                </p>
                <div className="grid grid-cols-7 border-l border-t border-black/10">
                  {week.map((weekday, index) => (
                    <div key={weekday} className={'border-b border-r border-black/10 py-2 text-center text-xs ' + (index === 0 ? 'text-[#f04432]' : '')}>
                      {weekday}
                    </div>
                  ))}
                  {Array.from({ length: first }, (_, index) => (
                    <div key={'blank-' + index} className="h-16 border-b border-r border-black/10 bg-[#faf9f7]" />
                  ))}
                  {days.map(day => {
                    const blocked = day.rest;
                    return (
                      <button
                        key={day.date}
                        type="button"
                        disabled={blocked}
                        aria-pressed={selected.includes(day.date)}
                        onClick={() => toggle(day.date)}
                        title={day.holiday || (blocked ? '휴식일이라 연차를 선택할 수 없습니다' : '연차 사용일로 선택')}
                        className={'h-16 border-b border-r border-black/10 text-sm focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#f04432] ' + (
                          selected.includes(day.date)
                            ? 'bg-[#f04432] font-bold text-white'
                            : blocked ? 'bg-[#f5f4f1] text-black/25' : 'hover:bg-[#fff0ed]'
                        )}
                      >
                        <span>{day.day}</span>
                        {day.holiday && <small className="block truncate px-1 text-[8px]">{day.holiday}</small>}
                      </button>
                    );
                  })}
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setSelected([])}
                    className="flex items-center gap-1 border border-black/15 px-3 py-2 text-xs"
                  >
                    <RotateCcw size={12} />선택 초기화
                  </button>
                </div>
              </section>

              <aside className="space-y-5">
                <section className="bg-[#171717] p-5 text-white" aria-labelledby="selection-title">
                  <div className="mono text-[10px] tracking-[.15em] text-[#f04432]">YOUR SELECTION</div>
                  <h2 id="selection-title" className="mt-2 text-lg font-bold">선택한 연차로 연결되는 휴식</h2>
                  {selected.length > 0 && (
                    <p className="mt-3 text-xs text-white/60">연차 사용일: {selected.join(', ')}</p>
                  )}
                  {impact.length ? impact.map(period => (
                    <div key={period.start} className="mt-5 border-t border-white/15 pt-4">
                      <div className="text-xs text-white/55">{period.start} — {period.end}</div>
                      <div className="mt-1 flex items-end justify-between">
                        <strong className="mono text-4xl text-[#f04432]">
                          {period.days}<small className="ml-1 text-sm text-white/60">일</small>
                        </strong>
                        <span className="text-xs text-white/60">
                          연차 {period.leaveDates.length}일 · 효율 {period.efficiency}:1
                        </span>
                      </div>
                      <p className="mt-2 text-xs text-white/55">
                        주말·공휴일을 포함해 {period.days}일 연속 쉴 수 있어요.
                      </p>
                      <button
                        type="button"
                        onClick={() => void save(period)}
                        className="mt-3 flex items-center gap-1 text-xs text-white/70"
                      >
                        <Plus size={13} />계획에 저장
                      </button>
                    </div>
                  )) : (
                    <p className="mt-4 text-xs leading-5 text-white/50">
                      평일 날짜를 골라 보세요. 3일 이상 이어지는 휴식 기간이 생기면 여기에 표시됩니다.
                    </p>
                  )}
                </section>

                <section className="bg-white p-5" aria-labelledby="recommendations-title">
                  <div className="flex items-baseline justify-between">
                    <h2 id="recommendations-title" className="font-bold">연차 추천 조합</h2>
                    <span className="text-[10px] text-black/40">연차 최대 {limit}일 · {recommendations.length}개</span>
                  </div>
                  <p className="mt-2 text-xs leading-5 text-black/50">
                    추천 순위는 연차 대비 연속 휴식 효율과 휴식 일수를 기준으로 계산합니다.
                  </p>
                  {recommendations.map((option, index) => {
                    const isSelected = option.leaveDates.length === selected.length &&
                      option.leaveDates.every(date => selected.includes(date));
                    return (
                      <article key={option.start + '-' + option.leaveDates.join(',')} className="mt-4 border-t border-black/10 pt-4">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <span className="mono text-[10px] tracking-[.12em] text-[#f04432]">
                            RECOMMENDATION {String(index + 1).padStart(2, '0')}
                          </span>
                          <span className="text-xs font-bold text-[#f04432]">{option.days}일 연속 휴식</span>
                        </div>
                        <h3 className="mt-2 font-bold">{option.start} — {option.end}</h3>
                        <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                          <div className="bg-[#f7f6f3] p-3">
                            <div className="text-[10px] text-black/45">총 휴식</div>
                            <strong className="mt-1 block">{option.days}일</strong>
                          </div>
                          <div className="bg-[#f7f6f3] p-3">
                            <div className="text-[10px] text-black/45">연차 사용</div>
                            <strong className="mt-1 block">{option.leaveDates.length}일</strong>
                          </div>
                        </div>
                        <p className="mt-3 text-xs leading-5 text-black/60">
                          연차 {option.leaveDates.length}일을 주말·공휴일에 붙여 {option.days}일 연속으로 쉴 수 있어요.
                          {' '}효율 {option.efficiency}:1
                        </p>
                        <p className="mt-2 text-[10px] leading-5 text-black/45">연차 날짜: {option.leaveDates.join(', ')}</p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <button
                            type="button"
                            aria-pressed={isSelected}
                            onClick={() => applyRecommendation(option)}
                            className={'border px-3 py-2 text-xs font-bold ' + (
                              isSelected ? 'border-[#f04432] bg-[#fff0ed] text-[#f04432]' : 'border-black/15 hover:border-[#f04432]'
                            )}
                          >
                            {isSelected ? '선택됨' : '이 조합 적용'}
                          </button>
                          <button
                            type="button"
                            onClick={() => void save(option)}
                            className="border border-black/15 px-3 py-2 text-xs font-bold hover:border-[#f04432]"
                          >
                            계획에 저장
                          </button>
                        </div>
                      </article>
                    );
                  })}
                  {!recommendations.length && (
                    <p className="mt-4 text-xs text-black/45">이 연도에는 조건에 맞는 추천 기간이 없습니다.</p>
                  )}
                </section>

                {message && (
                  <p role="status" className="text-xs font-semibold text-[#f04432]">
                    {message} <a href="/plans" className="underline">내 계획 보기</a>
                  </p>
                )}
              </aside>
            </div>
            <p className="mt-6 text-[10px] leading-5 text-black/40">
              효율 = 연속 휴식 일수 ÷ 사용 연차 일수. 주말과 공휴일은 연차일에서 제외되며, 주 5일제와 다른 근무 일정에서는 결과가 달라질 수 있습니다.
            </p>
          </>
        )}
      </main>
    </>
  );
}
