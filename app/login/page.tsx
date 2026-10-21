'use client';

import { FormEvent, useEffect, useState } from 'react';
import { ArrowRight, Cloud, LogIn } from 'lucide-react';
import { SiteHeader } from '@/components/SiteHeader';
import { PageTitle } from '@/components/PageTitle';
import { getSupabase, supabaseConfigured } from '@/lib/plans';

function getReturnPath() {
  const next = new URLSearchParams(window.location.search).get('next');
  return next?.startsWith('/') && !next.startsWith('//') && !next.includes('\\') ? next : '/plans';
}

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [checkingSession, setCheckingSession] = useState(supabaseConfigured);

  useEffect(() => {
    if (!supabaseConfigured) return;
    let active = true;
    const supabase = getSupabase()!;
    const redirectIfSignedIn = () => window.location.replace(getReturnPath());
    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      if (data.session) redirectIfSignedIn();
      else setCheckingSession(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) redirectIfSignedIn();
    });
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  async function authenticate(mode: 'signin' | 'signup', event?: { preventDefault: () => void }) {
    event?.preventDefault();
    setError('');
    setMessage('');
    if (!email.trim() || password.length < 6) {
      setError('이메일과 6자 이상의 비밀번호를 입력해 주세요.');
      return;
    }
    const supabase = getSupabase();
    if (!supabase) {
      setError('Supabase 환경변수를 확인해 주세요.');
      return;
    }

    setBusy(true);
    try {
      const result = mode === 'signin'
        ? await supabase.auth.signInWithPassword({ email: email.trim(), password })
        : await supabase.auth.signUp({
            email: email.trim(),
            password,
            options: {
              emailRedirectTo: `${window.location.origin}/login?next=${encodeURIComponent(getReturnPath())}`,
            },
          });
      if (result.error) throw result.error;
      if (mode === 'signin') window.location.replace(getReturnPath());
      else if (!result.data.session) setMessage('가입 확인 메일을 보냈습니다. 이메일 인증을 완료해 주세요.');
      else window.location.replace(getReturnPath());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '인증에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  }

  return <>
    <SiteHeader active="/login" />
    <main className="mx-auto max-w-[760px] px-5 py-8 md:px-10 md:py-12">
      <PageTitle eyebrow="YOUR ACCOUNT" title="로그인" description="로그인하거나 계정을 만들어 휴식 계획을 저장하세요." />
      {!supabaseConfigured ? (
        <section className="bg-white p-6 text-sm leading-6 text-black/60">
          <div className="flex items-center gap-2 font-bold text-black"><Cloud size={17} className="text-[#f04432]" />Supabase 연결이 필요합니다</div>
          <p className="mt-3">배포 환경 변수에 `NEXT_PUBLIC_SUPABASE_URL`과 `NEXT_PUBLIC_SUPABASE_ANON_KEY`가 설정되어 있는지 확인해 주세요.</p>
          <a href="/plans" className="mt-5 inline-flex items-center gap-2 font-bold text-[#f04432]">내 계획으로 돌아가기 <ArrowRight size={15}/></a>
        </section>
      ) : checkingSession ? (
        <p className="bg-white p-6 text-sm text-black/55" role="status">로그인 상태를 확인하고 있어요.</p>
      ) : (
        <form className="space-y-4 bg-white p-5 md:p-7" onSubmit={(event) => void authenticate('signin', event)}>
          <div className="flex items-center gap-2 text-sm font-bold"><LogIn size={17} className="text-[#f04432]"/>Supabase 계정</div>
          <label className="block text-xs font-semibold">이메일
            <input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="이메일 주소" className="mt-2 w-full border border-black/15 p-3 text-sm" />
          </label>
          <label className="block text-xs font-semibold">비밀번호
            <input required minLength={6} type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="6자 이상" className="mt-2 w-full border border-black/15 p-3 text-sm" />
          </label>
          {error && <p role="alert" className="text-xs text-[#c5291a]">{error}</p>}
          {message && <p role="status" className="text-xs text-[#287345]">{message}</p>}
          <div className="grid gap-3 sm:grid-cols-2">
            <button disabled={busy} className="bg-[#f04432] p-3 text-sm font-bold text-white disabled:opacity-50">로그인</button>
            <button disabled={busy} type="button" onClick={(event) => void authenticate('signup', event)} className="border border-black/15 p-3 text-sm font-bold disabled:opacity-50">계정 만들기</button>
          </div>
          <p className="text-xs leading-5 text-black/45">가입 후 이메일 인증이 필요할 수 있습니다. 인증 링크는 이 로그인 페이지로 돌아옵니다.</p>
        </form>
      )}
    </main>
  </>;
}
