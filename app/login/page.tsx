'use client';

import { useEffect, useState } from 'react';
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

  async function authenticate(event: { preventDefault: () => void }) {
    event.preventDefault();
    setError('');
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
      const result = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (result.error) throw result.error;
      window.location.replace(getReturnPath());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '인증에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  }

  async function signInWithGoogle() {
    setError('');
    const supabase = getSupabase();
    if (!supabase) {
      setError('Supabase 환경변수를 확인해 주세요.');
      return;
    }
    setBusy(true);
    try {
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: `${window.location.origin}/login?next=${encodeURIComponent(getReturnPath())}` },
      });
      if (oauthError) throw oauthError;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Google 로그인에 실패했습니다.');
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
        <section className="space-y-5">
          <div className="bg-white p-5 md:p-7">
            <button type="button" disabled={busy} onClick={() => void signInWithGoogle()} className="flex w-full items-center justify-center gap-3 border border-black/15 p-3 text-sm font-bold hover:bg-[#f8f7f4] disabled:opacity-50">
              <span aria-hidden="true" className="font-bold text-base">G</span>Google 계정으로 계속하기
            </button>
            <p className="mt-3 text-xs leading-5 text-black/45">처음 이용하면 Google 계정으로 바로 가입됩니다. 이메일 인증 메일을 기다릴 필요가 없습니다.</p>
          </div>
          <form className="space-y-4 bg-white p-5 md:p-7" onSubmit={(event) => void authenticate(event)}>
          <div className="flex items-center gap-2 text-sm font-bold"><LogIn size={17} className="text-[#f04432]"/>기존 이메일 계정 로그인</div>
          <label className="block text-xs font-semibold">이메일
            <input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="이메일 주소" className="mt-2 w-full border border-black/15 p-3 text-sm" />
          </label>
          <label className="block text-xs font-semibold">비밀번호
            <input required minLength={6} type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="6자 이상" className="mt-2 w-full border border-black/15 p-3 text-sm" />
          </label>
          {error && <p role="alert" className="text-xs text-[#c5291a]">{error}</p>}
          <button disabled={busy} className="w-full bg-[#f04432] p-3 text-sm font-bold text-white disabled:opacity-50">로그인</button>
          </form>
        </section>
      )}
    </main>
  </>;
}
