'use client';

import { useMemo, useState } from 'react';
import { Bookmark, CalendarDays, LoaderCircle, Plus, Sparkles, X } from 'lucide-react';
import { SiteHeader } from '@/components/SiteHeader';
import { PageTitle } from '@/components/PageTitle';
import { useHolidays } from '@/lib/use-holidays';
import { goldenOptions } from '@/lib/calendar';
import { makePlan, savePlan } from '@/lib/plans';
import type { AiGoldenRecommendation } from '@/lib/golden-analysis';

type GoldenCard = { start: string; end: string; days: number; holidays: string[]; leaveDates: string[] };
type AiGoldenResult = {
  year: number;
  source: string | null;
  holidayStatus: string;
  generatedAt: string;
  recommendations: AiGoldenRecommendation[];
};

export default function GoldenPage() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [saved, setSaved] = useState('');
  const [leaveDateInput, setLeaveDateInput] = useState('');
  const [selectedLeaveDates, setSelectedLeaveDates] = useState<string[]>([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');
  const [aiResult, setAiResult] = useState<AiGoldenResult | null>(null);
  const data = useHolidays(year);
  const options = useMemo(
    () => data.status !== 'unavailable' ? goldenOptions(year, data.holidays) : { natural: [], withLeave: [] },
    [year, data]
  );
  const natural = [...options.natural].sort((a, b) => b.days - a.days);

  function changeYear(value: number) {
    setYear(value);
    setSelectedLeaveDates([]);
    setLeaveDateInput('');
    setAiResult(null);
    setAiError('');
  }

  function addLeaveDate() {
    if (!leaveDateInput || selectedLeaveDates.includes(leaveDateInput) || selectedLeaveDates.length >= 3) return;
    setSelectedLeaveDates([...selectedLeaveDates, leaveDateInput].sort());
    setLeaveDateInput('');
    setAiResult(null);
    setAiError('');
  }

  async function analyzeWithGemini() {
    setAiLoading(true);
    setAiError('');
    setAiResult(null);
    try {
      const response = await fetch('/api/golden/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year, selectedLeaveDates })
      });
      const result = await response.json() as AiGoldenResult & { message?: string };
      if (!response.ok) throw new Error(result.message || 'AI 분석에 실패했어요. 다시 시도해 주세요.');
      if (!Array.isArray(result.recommendations)) throw new Error('AI 분석 결과를 읽을 수 없어요. 다시 시도해 주세요.');
      setAiResult(result);
    } catch (error) {
      setAiError(error instanceof Error ? error.message : 'AI 분석에 실패했어요. 잠시 후 다시 시도해 주세요.');
    } finally {
      setAiLoading(false);
    }
  }

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
              onChange={event => changeYear(Number(event.target.value))}
            >
              {Array.from({ length: 9 }, (_, index) => new Date().getFullYear() - 3 + index)
                .map(value => <option key={value}>{value}</option>)}
            </select>
          </label>
        </PageTitle>

        <section className="mb-10 bg-[#171717] p-5 text-white md:p-7" aria-labelledby="ai-analysis-title">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="mono text-[10px] tracking-[.16em] text-[#f04432]">GEMINI · HOLIDAY PLANNER</div>
              <h2 id="ai-analysis-title" className="mt-2 text-2xl font-extrabold">AI 황금연휴 분석</h2>
              <p className="mt-2 max-w-2xl text-xs leading-5 text-white/55">
                실제 공휴일과 계산된 연휴 후보를 바탕으로 우선순위와 활용 방법을 분석합니다.
              </p>
            </div>
            <Sparkles className="text-[#f04432]" size={22} aria-hidden="true" />
          </div>

          <div className="mt-5 flex flex-wrap items-end gap-3 border-t border-white/15 pt-5">
            <label className="text-xs text-white/65">
              휴가 날짜 선택 · 선택 사항 · 최대 3일
              <span className="mt-2 flex gap-2">
                <input
                  type="date"
                  min={`${year}-01-01`}
                  max={`${year}-12-31`}
                  value={leaveDateInput}
                  onChange={event => setLeaveDateInput(event.target.value)}
                  className="border border-white/20 bg-[#171717] px-3 py-2 text-sm text-white"
                  aria-label="분석에 반영할 연차 날짜"
                />
                <button
                  type="button"
                  onClick={addLeaveDate}
                  disabled={!leaveDateInput || selectedLeaveDates.length >= 3 || selectedLeaveDates.includes(leaveDateInput)}
                  aria-label="휴가 날짜 추가"
                  className="border border-white/25 px-3 text-white disabled:opacity-40"
                >
                  <Plus size={16} />
                </button>
              </span>
            </label>
            <button
              type="button"
              onClick={() => void analyzeWithGemini()}
              disabled={aiLoading || data.status === 'unavailable'}
              className="inline-flex items-center justify-center gap-2 bg-[#f04432] px-4 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {aiLoading ? <LoaderCircle size={16} className="animate-spin" /> : <Sparkles size={16} />}
              {aiLoading ? 'Gemini가 분석 중이에요' : 'AI 황금연휴 분석 시작'}
            </button>
          </div>

          {selectedLeaveDates.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-2" aria-label="선택한 휴가 날짜">
              {selectedLeaveDates.map(date => (
                <li key={date} className="inline-flex items-center gap-2 border border-white/20 px-2 py-1 text-xs text-white/75">
                  {date}
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedLeaveDates(selectedLeaveDates.filter(selected => selected !== date));
                      setAiResult(null);
                    }}
                    aria-label={`${date} 삭제`}
                    className="text-white/60 hover:text-white"
                  >
                    <X size={13} />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {aiError && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-l-2 border-[#f04432] bg-white/5 p-3 text-sm" role="alert">
              <span>{aiError}</span>
              <button type="button" onClick={() => void analyzeWithGemini()} disabled={aiLoading} className="text-xs font-bold underline disabled:opacity-50">
                다시 분석
              </button>
            </div>
          )}

          {aiResult && (
            <div className="mt-6 border-t border-white/15 pt-5" aria-live="polite">
              <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-lg font-bold">{aiResult.year}년 추천 결과</h3>
                <span className="text-[10px] text-white/45">{aiResult.source ?? '공휴일 출처 미확인'} · 실제 후보 데이터 기준</span>
              </div>
              {aiResult.recommendations.length === 0 ? (
                <p className="bg-white/5 p-4 text-sm text-white/65">현재 조건에서 추천 결과가 없어요. 휴가 날짜를 바꾸거나 다시 분석해 주세요.</p>
              ) : (
                <div className="grid gap-3 lg:grid-cols-3">
                  {aiResult.recommendations.map((recommendation, index) => (
                    <article key={recommendation.candidateId} className="bg-white p-4 text-[#111] md:p-5">
                      <div className="mono text-[10px] tracking-[.12em] text-[#f04432]">AI PICK {String(index + 1).padStart(2, '0')}</div>
                      <h4 className="mt-2 font-bold">{recommendation.startDate} — {recommendation.endDate}</h4>
                      <div className="mt-3 flex items-baseline gap-2 border-b border-black/10 pb-3">
                        <strong className="mono text-4xl text-[#f04432]">{recommendation.totalRestDays}</strong>
                        <span className="text-xs text-black/55">일 연속 휴식</span>
                        <span className="ml-auto text-xs font-bold">연차 {recommendation.requiredLeaveDays}일</span>
                      </div>
                      <p className="mt-3 text-xs leading-5 text-black/70">{recommendation.reason}</p>
                      <p className="mt-3 border-l-2 border-[#f04432] pl-3 text-xs leading-5 text-black/65">{recommendation.efficiencyAdvice}</p>
                      <p className="mt-3 text-xs leading-5 text-black/50">{recommendation.activitySuggestion}</p>
                      {recommendation.leaveDates.length > 0 && (
                        <p className="mt-3 text-[10px] font-semibold text-black/55">연차 사용: {recommendation.leaveDates.join(', ')}</p>
                      )}
                    </article>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>

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
