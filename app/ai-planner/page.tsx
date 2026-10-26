'use client';

import { useEffect, useState } from 'react';
import { Bookmark, LoaderCircle, Sparkles } from 'lucide-react';
import { PageTitle } from '@/components/PageTitle';
import { SiteHeader } from '@/components/SiteHeader';
import { daysBetweenDateKeys, isDateKey, monthDays, koreaToday } from '@/lib/calendar';
import type { PlannerRecommendation } from '@/lib/ai-planner';
import { listPlans, makePlan, savePlan, supabaseConfigured, type PlanType, type RestPlan } from '@/lib/plans';
import { useHolidays } from '@/lib/use-holidays';

type Purpose = 'travel' | 'rest' | 'personal' | 'leave' | 'other';
type PlannerResult = PlannerRecommendation & {
  planType: PlanType;
  editedTitle: string;
  editedStart: string;
  editedEnd: string;
  editedType: PlanType;
  memo: string;
  saved: boolean;
  saveMessage: string;
};
type ExistingPlansState = 'loading' | 'available' | 'unavailable';

const fieldClass = 'mt-1 w-full border border-black/15 bg-white p-2.5 text-sm';

function periodMetrics(start: string, end: string, year: number, holidays: ReturnType<typeof useHolidays>['holidays']) {
  if (!isDateKey(start) || !isDateKey(end) || start > end || Number(start.slice(0, 4)) !== year || Number(end.slice(0, 4)) !== year) return null;
  const calendar = new Map(Array.from({ length: 12 }, (_, month) => monthDays(year, month, holidays)).flat().map(day => [day.date, day]));
  const totalRestDays = daysBetweenDateKeys(start, end) + 1;
  let requiredLeaveDays = 0;
  for (let offset = 0; offset < totalRestDays; offset++) {
    const date = new Date(Date.UTC(Number(start.slice(0, 4)), Number(start.slice(5, 7)) - 1, Number(start.slice(8, 10)) + offset)).toISOString().slice(0, 10);
    const day = calendar.get(date);
    if (day && !day.rest) requiredLeaveDays++;
  }
  return { totalRestDays, requiredLeaveDays };
}

export default function AiPlannerPage() {
  const currentYear = koreaToday().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [month, setMonth] = useState('');
  const [requestText, setRequestText] = useState('');
  const [maxLeaveDays, setMaxLeaveDays] = useState(2);
  const [targetDays, setTargetDays] = useState('');
  const [purpose, setPurpose] = useState<Purpose>('leave');
  const [additionalConditions, setAdditionalConditions] = useState('');
  const [existingPlans, setExistingPlans] = useState<RestPlan[]>([]);
  const [existingPlansState, setExistingPlansState] = useState<ExistingPlansState>('loading');
  const [recommendations, setRecommendations] = useState<PlannerResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [savingId, setSavingId] = useState('');
  const [error, setError] = useState('');
  const holidayData = useHolidays(year);

  useEffect(() => {
    let active = true;
    void listPlans().then(plans => {
      if (!active) return;
      setExistingPlans(plans);
      setExistingPlansState('available');
    }).catch(() => {
      if (active) setExistingPlansState('unavailable');
    });
    return () => { active = false; };
  }, []);

  function updateRecommendation(candidateId: string, patch: Partial<PlannerResult>) {
    setRecommendations(current => current.map(item => item.candidateId === candidateId ? { ...item, ...patch } : item));
  }

  async function analyze() {
    setError('');
    setRecommendations([]);
    setBusy(true);
    try {
      const response = await fetch('/api/ai-planner/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestText,
          year,
          month: month ? Number(month) : null,
          maxLeaveDays,
          targetDays: targetDays ? Number(targetDays) : null,
          purpose,
          additionalConditions,
          existingPlansAvailable: existingPlansState === 'available',
          existingPlans: existingPlansState === 'available' ? existingPlans.map(plan => ({ start: plan.start, end: plan.end })) : []
        })
      });
      const data = await response.json() as {
        message?: string;
        recommendations?: Array<PlannerRecommendation>;
        purpose?: PlanType;
        existingPlansChecked?: boolean;
      };
      if (!response.ok) throw new Error(data.message || '계획 추천을 불러오지 못했어요. 다시 시도해 주세요.');
      if (!Array.isArray(data.recommendations)) throw new Error('추천 결과 형식이 올바르지 않아요. 다시 시도해 주세요.');
      setRecommendations(data.recommendations.map(item => ({
        ...item,
        planType: data.purpose ?? '기타',
        editedTitle: item.title,
        editedStart: item.startDate,
        editedEnd: item.endDate,
        editedType: data.purpose ?? '기타',
        memo: `AI 계획 추천 · ${item.reason}\n${item.description}\n장점: ${item.advantages}\n단점: ${item.disadvantages}`.slice(0, 600),
        saved: false,
        saveMessage: ''
      })));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '계획 추천에 실패했어요. 잠시 후 다시 시도해 주세요.');
    } finally {
      setBusy(false);
    }
  }

  async function saveRecommendation(item: PlannerResult) {
    const title = item.editedTitle.trim();
    const memo = item.memo.trim();
    const metrics = periodMetrics(item.editedStart, item.editedEnd, year, holidayData.holidays);
    if (!title || title.length > 80 || memo.length > 600 || !metrics) {
      updateRecommendation(item.candidateId, { saveMessage: '제목·메모 길이와 같은 연도의 시작일·종료일을 확인해 주세요.' });
      return;
    }
    if (holidayData.status === 'unavailable') {
      updateRecommendation(item.candidateId, { saveMessage: '공휴일 정보를 확인할 수 없어 수정한 날짜를 검증할 수 없어요.' });
      return;
    }
    setSavingId(item.candidateId);
    updateRecommendation(item.candidateId, { saveMessage: '' });
    try {
      const plan = makePlan({
        title,
        start: item.editedStart,
        end: item.editedEnd,
        type: item.editedType,
        memo: memo || `연속 ${metrics.totalRestDays}일 · 필요한 연차 ${metrics.requiredLeaveDays}일`
      });
      await savePlan(plan);
      setExistingPlans(current => [...current, plan]);
      setExistingPlansState('available');
      updateRecommendation(item.candidateId, { saved: true, saveMessage: '내 계획에 저장했어요.' });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '저장하지 못했어요. 다시 시도해 주세요.';
      updateRecommendation(item.candidateId, { saveMessage: supabaseConfigured ? `${message} 로그인 상태를 확인해 주세요.` : message });
    } finally {
      setSavingId('');
    }
  }

  return <>
    <SiteHeader active="/ai-planner" />
    <main className="mx-auto max-w-[1100px] px-5 py-8 md:px-10 md:py-12">
      <PageTitle
        eyebrow="MAKE A PLAN THAT FITS"
        title="AI 계획 추천"
        description="원하는 휴식과 조건을 적으면 실제 공휴일 달력에 맞는 계획 후보를 제안합니다."
      />

      {existingPlansState === 'loading' ? (
        <p className="mb-5 bg-white p-3 text-xs text-black/55" role="status">내 계획을 불러오고 있어요.</p>
      ) : existingPlansState === 'unavailable' ? (
        <p className="mb-5 border-l-2 border-[#f04432] bg-white p-3 text-xs text-black/55">내 계획을 확인하지 못해 추천과 일정 겹침을 대조하지 않습니다. 로그인 또는 저장 연결을 확인해 주세요.</p>
      ) : (
        <p className="mb-5 border-l-2 border-black/20 bg-white p-3 text-xs text-black/55">저장된 계획 {existingPlans.length}개의 날짜 범위를 비교합니다. 제목이나 메모는 분석에 전송하지 않습니다.</p>
      )}

      <section className="grid items-start gap-6 lg:grid-cols-[350px_1fr]">
        <form className="space-y-4 bg-white p-5 md:p-6" onSubmit={event => { event.preventDefault(); void analyze(); }}>
          <div className="flex items-center gap-2 font-bold"><Sparkles size={17} className="text-[#f04432}" />요청 조건</div>
          <label className="block text-xs font-semibold">원하는 계획<textarea required minLength={3} maxLength={600} rows={4} value={requestText} onChange={event => setRequestText(event.target.value)} placeholder="예: 12월에 연차 2일을 사용해서 주말 포함 4일 쉬고 싶어요." className={fieldClass} /></label>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs font-semibold">연도<select value={year} onChange={event => { setYear(Number(event.target.value)); setRecommendations([]); }} className={fieldClass}>{[currentYear, currentYear + 1].map(value => <option key={value} value={value}>{value}년</option>)}</select></label>
            <label className="text-xs font-semibold">월<select value={month} onChange={event => setMonth(event.target.value)} className={fieldClass}><option value="">전체</option>{Array.from({ length: 12 }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}월</option>)}</select></label>
            <label className="text-xs font-semibold">사용 가능 연차<select value={maxLeaveDays} onChange={event => setMaxLeaveDays(Number(event.target.value))} className={fieldClass}>{Array.from({ length: 6 }, (_, days) => <option key={days} value={days}>{days}일 이하</option>)}</select></label>
            <label className="text-xs font-semibold">목표 휴식 기간<select value={targetDays} onChange={event => setTargetDays(event.target.value)} className={fieldClass}><option value="">자유롭게</option>{Array.from({ length: 14 }, (_, days) => <option key={days + 1} value={days + 1}>{days + 1}일</option>)}</select></label>
          </div>
          <label className="block text-xs font-semibold">목적<select value={purpose} onChange={event => setPurpose(event.target.value as Purpose)} className={fieldClass}><option value="travel">여행</option><option value="rest">휴식</option><option value="personal">개인 일정</option><option value="leave">연차 활용</option><option value="other">기타</option></select></label>
          <label className="block text-xs font-semibold">추가 조건 <span className="font-normal text-black/40">(선택)</span><textarea maxLength={400} rows={2} value={additionalConditions} onChange={event => setAdditionalConditions(event.target.value)} placeholder="예: 연차는 월요일과 금요일에만 사용" className={fieldClass} /></label>
          {error && <p role="alert" className="border-l-2 border-[#f04432] bg-[#fff4f1] p-3 text-xs text-[#64251e]">{error}</p>}
          <button type="submit" disabled={busy || existingPlansState === 'loading' || !requestText.trim() || holidayData.status === 'unavailable'} className="flex w-full items-center justify-center gap-2 bg-[#f04432] p-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50">
            {busy ? <LoaderCircle size={16} className="animate-spin" /> : <Sparkles size={16} />}
            {busy ? '달력과 조건을 분석 중이에요' : '계획 추천 받기'}
          </button>
          {holidayData.status === 'unavailable' && <p className="text-xs text-[#b42318]">{holidayData.loading ? '공휴일 자료를 확인하고 있어요.' : `${year}년 공휴일 자료가 없어 추천할 수 없습니다.`}</p>}
        </form>

        <section aria-live="polite" className="space-y-4">
          <div className="flex items-end justify-between border-b border-black/10 pb-3">
            <div><div className="mono text-[10px] tracking-[.15em] text-[#f04432]">PREVIEW</div><h2 className="mt-1 text-lg font-bold">추천 계획</h2></div>
            {recommendations.length > 0 && <span className="mono text-xs text-black/45">{recommendations.length}개</span>}
          </div>
          {!busy && !error && recommendations.length === 0 && <p className="bg-white p-7 text-sm text-black/45">요청 조건을 입력하면 최대 3개의 계획 후보를 비교해 보여 드립니다.</p>}
          {!busy && !error && recommendations.length === 0 && !holidayData.loading && holidayData.status !== 'unavailable' && requestText && <p className="bg-white p-4 text-xs text-black/50">추천 결과가 아직 없습니다. 연도·월·연차 조건을 바꾸거나 요청을 구체적으로 적어 보세요.</p>}
          {recommendations.map((item, index) => {
            const metrics = periodMetrics(item.editedStart, item.editedEnd, year, holidayData.holidays);
            const conflicts = existingPlansState === 'available' && existingPlans.some(plan => plan.start <= item.editedEnd && plan.end >= item.editedStart);
            return <article key={item.candidateId} className="bg-white p-5 md:p-6">
              <div className="flex items-center justify-between gap-3"><span className="mono text-[10px] tracking-[.15em] text-[#f04432]">OPTION {String(index + 1).padStart(2, '0')}</span>{conflicts && <span className="text-[10px] font-bold text-[#b42318]">저장된 계획과 날짜 중복</span>}</div>
              <label className="mt-3 block text-xs font-semibold">계획 제목<input maxLength={80} value={item.editedTitle} onChange={event => updateRecommendation(item.candidateId, { editedTitle: event.target.value })} className={fieldClass} /></label>
              <div className="mt-3 grid grid-cols-2 gap-3"><label className="text-xs font-semibold">시작일<input type="date" min={`${year}-01-01`} max={`${year}-12-31`} value={item.editedStart} onChange={event => updateRecommendation(item.candidateId, { editedStart: event.target.value })} className={fieldClass} /></label><label className="text-xs font-semibold">종료일<input type="date" min={`${year}-01-01`} max={`${year}-12-31`} value={item.editedEnd} onChange={event => updateRecommendation(item.candidateId, { editedEnd: event.target.value })} className={fieldClass} /></label></div>
              <div className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-black/10 pb-3 text-xs text-black/50"><span className="mono text-lg font-bold text-[#f04432]">{metrics?.totalRestDays ?? '—'}일</span><span>연속 일정 기간</span><span>필요 연차 {metrics?.requiredLeaveDays ?? '—'}일</span></div>
              <p className="mt-3 text-sm font-semibold">{item.description}</p><p className="mt-2 text-xs leading-5 text-black/60">{item.reason}</p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2"><div className="border-l-2 border-[#287345] bg-[#f5f8f5] p-3 text-xs leading-5"><b>장점</b><p className="mt-1">{item.advantages}</p></div><div className="border-l-2 border-black/20 bg-[#f8f7f4] p-3 text-xs leading-5"><b>고려할 점</b><p className="mt-1">{item.disadvantages}</p></div></div>
              <label className="mt-4 block text-xs font-semibold">계획 종류<select value={item.editedType} onChange={event => updateRecommendation(item.candidateId, { editedType: event.target.value as PlanType })} className={fieldClass}><option value="여행">여행</option><option value="휴식">휴식</option><option value="공부">공부</option><option value="기타">기타</option></select></label>
              <label className="mt-3 block text-xs font-semibold">메모<textarea maxLength={600} rows={3} value={item.memo} onChange={event => updateRecommendation(item.candidateId, { memo: event.target.value })} className={fieldClass} /></label>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3"><p className="text-[10px] text-black/40">{item.holidays.length ? `포함 공휴일: ${item.holidays.join(' · ')}` : '주말과 공휴일 달력 기준'}</p><button type="button" disabled={savingId === item.candidateId || item.saved || !metrics} onClick={() => void saveRecommendation(item)} className="flex items-center gap-2 border border-black/15 px-3 py-2 text-xs font-bold hover:border-[#f04432] hover:text-[#f04432] disabled:opacity-45">{savingId === item.candidateId ? <LoaderCircle size={14} className="animate-spin" /> : <Bookmark size={14} />}{item.saved ? '저장됨' : '내 계획에 저장'}</button></div>
              {item.saveMessage && <p role="status" className={`mt-3 text-xs ${item.saved ? 'text-[#287345]' : 'text-[#b42318]'}`}>{item.saveMessage}{!item.saved && supabaseConfigured && <a href="/login?next=%2Fai-planner" className="ml-2 font-bold underline">로그인</a>}</p>}
            </article>;
          })}
        </section>
      </section>
      <p className="mt-6 text-[10px] leading-5 text-black/40">날짜와 필요한 연차는 제공된 공휴일 달력으로 서버가 계산합니다. 저장 전 날짜를 수정하면 기간과 연차 수는 수정한 날짜 기준으로 다시 계산됩니다. 예약이나 장소 운영 여부는 확인하지 않습니다.</p>
    </main>
  </>;
}