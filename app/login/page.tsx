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

  async function authenticate(mode: 'signin' | 'signup', event: { preventDefault: () => void }) {
    event.preventDefault();
    setError('');
    setMessage('');
    if (!email.trim() || password.length < 6) {
      setError('이메일과 6자 이상의 비밀번호를 입력해 주세요.');
      return;
    }
    const supabase = getSupabase();
    if (!supabase) {
      setError('지금은 로그인을 이용할 수 없어요. 잠시 후 다시 시도해 주세요.');
      return;
    }

    setBusy(true);
    try {
      const result = mode === 'signin'
        ? await supabase.auth.signInWithPassword({ email: email.trim(), password })
        : await supabase.auth.signUp({
            email: email.trim(),
            password,
            options: { emailRedirectTo: `${window.location.origin}/login?next=${encodeURIComponent(getReturnPath())}` },
          });
      if (result.error) throw result.error;
      if (mode === 'signin' || result.data.session) window.location.replace(getReturnPath());
      else setMessage('가입 요청을 받았어요. 이메일 확인 안내가 보이면 받은 편지함의 링크를 누른 뒤 로그인해 주세요. 메일이 없다면 스팸함도 확인해 주세요.');
    } catch (cause) {
      const code = typeof cause === 'object' && cause !== null && 'code' in cause ? String(cause.code) : '';
      if (code === 'email_not_confirmed') {
        setError('이메일 확인이 필요해요. 받은 편지함에서 확인 링크를 누른 뒤 다시 로그인해 주세요. 메일이 없다면 스팸함도 확인해 주세요.');
      } else if (code === 'invalid_credentials') {
        setError('이메일과 비밀번호를 다시 확인해 주세요. 아직 가입하지 않았다면 회원가입을 선택해 주세요.');
      } else if (code === 'user_already_exists' || code === 'email_exists') {
        setError('이미 가입된 이메일이에요. 로그인 버튼을 눌러 이용해 주세요.');
      } else if (code === 'weak_password') {
        setError('비밀번호가 너무 짧거나 단순해요. 조금 더 길고 안전한 비밀번호를 입력해 주세요.');
      } else if (code === 'email_address_invalid') {
        setError('이메일 주소를 다시 확인해 주세요.');
      } else {
        setError('로그인 정보를 처리하지 못했어요. 잠시 후 다시 시도해 주세요. 문제가 계속되면 서비스 관리자에게 알려 주세요.');
      }
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
          <div className="flex items-center gap-2 font-bold text-black"><Cloud size={17} className="text-[#f04432]" />지금은 로그인을 이용할 수 없어요</div>
          <p className="mt-3">로그인 기능을 준비하고 있어요. 잠시 후 다시 방문해 주세요.</p>
          <a href="/plans" className="mt-5 inline-flex items-center gap-2 font-bold text-[#f04432]">내 계획으로 돌아가기 <ArrowRight size={15}/></a>
        </section>
      ) : checkingSession ? (
        <p className="bg-white p-6 text-sm text-black/55" role="status">로그인 상태를 확인하고 있어요.</p>
      ) : (
        <form className="space-y-4 bg-white p-5 md:p-7" onSubmit={(event) => void authenticate('signin', event)}>
          <div className="flex items-center gap-2 text-sm font-bold"><LogIn size={17} className="text-[#f04432]"/>이메일 계정</div>
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
            <button disabled={busy} type="button" onClick={(event) => void authenticate('signup', event)} className="border border-black/15 p-3 text-sm font-bold disabled:opacity-50">회원가입</button>
          </div>
        </form>
      )}
    </main>
  </>;
}
