'use client';

import { useMemo, useState } from 'react';
import { Bookmark, CalendarDays } from 'lucide-react';
import { SiteHeader } from '@/components/SiteHeader';
import { PageTitle } from '@/components/PageTitle';
import { useHolidays } from '@/lib/use-holidays';
import { goldenOptions } from '@/lib/calendar';
import { makePlan, savePlan } from '@/lib/plans';

type GoldenCard = { start: string; end: string; days: number; holidays: string[]; leaveDates: string[] };

export default function GoldenPage() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [saved, setSaved] = useState('');
  const data = useHolidays(year);
  const options = useMemo(
    () => data.status !== 'unavailable' ? goldenOptions(year, data.holidays) : { natural: [], withLeave: [] },
    [year, data]
  );
  const natural = [...options.natural].sort((a, b) => b.days - a.days);

  async function save(option: GoldenCard) {
    const leaveCount = option.leaveDates.length;
    try {
      await savePlan(makePlan({
        title: `연차 ${leaveCount}일 · ${option.days}일 연휴`,
        start: option.start,
        end: option.end,
        type: '휴식',
        memo: leaveCount
          ? `황금연휴 추천 · 연차 사용일 ${option.leaveDates.join(', ')}`
          : '황금연휴 탐색기에서 저장 · 연차 사용 없음'
      }));
      setSaved('내 계획에 저장했어요.');
    } catch (error) {
      setSaved(error instanceof Error ? error.message : '계획 저장에 실패했습니다.');
    }
  }

  function renderCard(option: GoldenCard, label: string) {
    const leaveCount = option.leaveDates.length;
    return (
      <article key={`${option.start}-${option.end}-${leaveCount}`} className="bg-white p-5 md:p-6">
        <div className="flex items-start justify-between">
          <span className="mono text-[10px] tracking-[.15em] text-[#f04432]">{label}</span>
          <CalendarDays size={17} className="text-black/35" />
        </div>
        <div className="mt-3 text-xl font-bold">{option.start.replaceAll('-', '.')} — {option.end.replaceAll('-', '.')}</div>
        <div className="mt-3 flex items-baseline gap-2">
          <strong className="mono text-5xl text-[#f04432]">{option.days}</strong>
          <span className="text-xs text-black/45">일 연속 휴식 · 연차 {leaveCount}일</span>
        </div>
        <div className="mt-4 min-h-5 text-xs text-black/50">
          {option.holidays.length ? option.holidays.join(' · ') : '주말 연속 휴식'}
        </div>
        {leaveCount > 0 && (
          <p className="mt-2 text-xs text-black/55">
            연차 사용일: {option.leaveDates.map(date => date.replaceAll('-', '.')).join(', ')}
          </p>
        )}
        <button
          onClick={() => void save(option)}
          className="mt-5 inline-flex items-center gap-2 border border-black/15 px-3 py-2 text-xs font-bold hover:border-[#f04432] hover:text-[#f04432]"
        >
          <Bookmark size={14} />계획에 저장
        </button>
      </article>
    );
  }

  return (
    <>
      <SiteHeader active="/golden" />
      <main className="mx-auto max-w-[1100px] px-5 py-8 md:px-10 md:py-12">
        <PageTitle
          eyebrow="FIND YOUR LONG WEEKEND"
          title="황금연휴를 찾아서."
          description="공휴일과 주말만으로 쉬는 기간, 연차를 더해 늘리는 기간을 함께 찾아봅니다."
        >
          <label className="flex items-center gap-2 text-xs text-black/50">
            연도
            <select
              className="border border-black/15 bg-transparent px-2 py-2 font-bold text-black"
              value={year}
              onChange={event => setYear(Number(event.target.value))}
            >
              {Array.from({ length: 9 }, (_, index) => new Date().getFullYear() - 3 + index)
                .map(value => <option key={value}>{value}</option>)}
            </select>
          </label>
        </PageTitle>

        {data.status === 'unavailable' ? (
          <div className="border border-[#f04432]/25 bg-[#fff4f1] p-6 text-sm">
            {data.loading ? '공휴일 정보를 확인하고 있어요.' : `${year}년 공휴일 정보를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.`}
          </div>
        ) : (
          <>
            <section aria-labelledby="natural-breaks">
              <div className="mb-5 flex items-center justify-between bg-[#171717] p-5 text-white">
                <h2 id="natural-breaks" className="text-sm">연차 없이 쉬는 기간</h2>
                <span className="mono text-3xl text-[#f04432]">
                  {natural.length}<small className="ml-2 text-xs text-white/50">기간</small>
                </span>
              </div>
              {natural.length ? (
                <div className="grid gap-3 md:grid-cols-2">
                  {natural.map((option, index) => renderCard(
                    option,
                    index === 0 ? '가장 긴 휴식' : `휴식 기간 ${String(index + 1).padStart(2, '0')}`
                  ))}
                </div>
              ) : (
                <p className="bg-white p-6 text-sm text-black/50">이 연도에는 연차 없이 3일 이상 연속 휴식 기간이 없습니다.</p>
              )}
            </section>

            <section className="mt-10" aria-labelledby="leave-breaks">
              <div className="mb-2 flex items-center justify-between">
                <h2 id="leave-breaks" className="text-lg font-bold">연차를 더해 만드는 연휴</h2>
                <span className="text-xs text-black/45">최대 3일 사용 · 추천 {options.withLeave.length}개</span>
              </div>
              <p className="mb-5 text-xs text-black/45">연차 사용일은 주말과 공휴일을 제외해 계산합니다.</p>
              {options.withLeave.length ? (
                <div className="grid gap-3 md:grid-cols-2">
                  {options.withLeave.map((option, index) => renderCard(
                    option,
                    `연차 ${option.leaveDates.length}일 추천 ${String(index + 1).padStart(2, '0')}`
                  ))}
                </div>
              ) : (
                <p className="bg-white p-6 text-sm text-black/50">추천할 수 있는 연차 사용 기간이 없습니다.</p>
              )}
            </section>

            {saved && (
              <p className="mt-5 text-xs font-semibold text-[#f04432]" role="status">
                {saved} <a href="/plans" className="underline">내 계획 보기</a>
              </p>
            )}
            <p className="mt-8 border-t border-black/10 pt-4 text-[10px] text-black/40">
              공휴일 자료를 기준으로 계산했습니다.{data.loading ? ' 최신 자료 확인 중' : ''}
            </p>
          </>
        )}
      </main>
    </>
  );
}
