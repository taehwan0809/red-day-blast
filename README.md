# 빨간날 폭격기 · RED DAY BLAST

한국의 공휴일과 주말을 분석해 대시보드, 달력, 황금연휴, 연차 효율, 통계와 개인 휴식 계획을 제공하는 Next.js 서비스입니다.

## 주요 기능

- 연도별 대시보드·달력·월별 휴식일 및 연속 휴식 분석
- 3일 이상 황금연휴 탐색, 연차 날짜 조합과 효율 추천
- 개인 계획 등록·조회·수정·삭제
- Google Calendar 대한민국 공휴일 데이터와 KASI 자료의 서버 측 조회·병합
- Gemini 기반 AI 황금연휴 추천 이유와 휴가 활용 분석
- Supabase Auth와 사용자별 RLS 기반 계획 저장. Supabase 미설정 시 기존 브라우저 localStorage 임시 저장 사용

## 공휴일 데이터: Google Calendar 및 KASI

`app/api/holidays/route.ts`에서만 외부 API를 요청합니다. 한국 공개 캘린더 ID `ko.south_korea#holiday@group.v.calendar.google.com`의 `events.list`를 연도 범위로 조회하고, 종일 일정의 `start.date`와 제목을 서비스의 공휴일 목록으로 변환합니다. 날짜가 겹치면 KASI 또는 검증된 로컬 자료가 우선하며, Google 단독 날짜는 `verified: false`로 남깁니다. Google 공개 캘린더는 공식 법령 원본으로 간주하지 않으므로 Google-only 데이터는 미검증 추정치라고 UI에서 안내합니다. API 장애 시 KASI 응답이나 검증된 2026 로컬 자료를 사용합니다. 둘 다 없으면 해당 연도는 미확인 상태로 표시합니다. 현재 연도 다음 해를 초과한 자료는 확정처럼 표시하지 않습니다.

Google 공개 캘린더 조회는 API 키 방식이며 사용자 OAuth는 필요하지 않습니다. Google Cloud Console에서 프로젝트를 만들고 **Google Calendar API**를 활성화한 뒤 API 키를 발급하세요. 키의 API 제한을 Google Calendar API로 설정하고, 서버 환경변수 `GOOGLE_CALENDAR_API_KEY`로만 등록합니다. 브라우저 번들에 포함되는 `NEXT_PUBLIC_` 접두사는 사용하지 마세요. API 응답은 하루 캐시됩니다.

선택 사항으로 공공데이터포털에서 `한국천문연구원_특일 정보` 활용 신청 후 `KASI_SERVICE_KEY`를 설정하면 공식 자료 우선 대조가 가능합니다. API 키가 없는 경우 2026년 자료만 KASI 월력요항 및 관련 법령 확인을 바탕으로 제공합니다. 미래 임시공휴일 등은 자료 제공 시점에 따라 빠질 수 있습니다.

## Gemini AI 황금연휴 분석

Gemini는 `/golden`에서 계산된 황금연휴 후보 중 최대 3개를 고르고, 추천 이유·연차 효율·여행 또는 휴식 활용 방법을 작성합니다. Gemini가 공휴일 날짜나 연속 휴일 수를 결정하지 않습니다. 서버가 Google Calendar/KASI/검증된 로컬 자료를 사용해 자연 연휴와 연차 1·2·3일 후보를 계산하고, Gemini 응답의 후보 ID를 검증한 뒤 날짜·연차 수·휴일 수를 서버 계산값으로 복원합니다. 사용자가 선택한 휴가 날짜도 서버에서 연도와 평일 여부를 확인합니다.

브라우저는 `POST /api/golden/analyze`에 연도와 선택 휴가 날짜만 전달합니다. Gemini SDK 호출과 응답 검증은 서버에서 수행하며 API 키는 브라우저에 노출되지 않습니다.

1. [Google AI Studio API 키 페이지](https://aistudio.google.com/apikey)에서 Gemini API 키를 발급합니다.
2. 로컬 `.env.local`에 `GEMINI_API_KEY=발급받은_키`를 설정하고 개발 서버를 재시작합니다. `.env.local`은 Git에 올리지 마세요.
3. Vercel Project Settings → Environment Variables에서 `GEMINI_API_KEY`를 Preview와 Production 환경에 등록하고 재배포합니다.

키 이름에 `NEXT_PUBLIC_`을 붙이지 마세요. 키가 없으면 분석 API는 설정 오류를 반환하며, 할당량 또는 요청 제한 응답은 재시도 안내로 표시합니다.

실제 Gemini 연결 테스트는 API 사용량이 발생할 수 있어 기본 `npm test`에서는 실행하지 않습니다. `GEMINI_API_KEY`를 설정한 뒤 PowerShell에서 `$env:GEMINI_LIVE_TEST="1"; npm test`를 실행하면 모델명과 JSON 응답 형식을 실제 API로 확인합니다. 키가 없거나 옵트인 변수가 없으면 해당 테스트만 건너뜁니다.

## Supabase 계획 저장

계획은 `public.rest_plans` 테이블에 저장합니다. 저장 필드는 UUID, 소유자 `user_id`, 제목, 시작·종료일, 계획 종류, 메모, 생성 시각입니다. 날짜 범위와 글자 수 제약을 DB에서 확인하고, RLS를 활성화하여 로그인 사용자가 본인 행에만 SELECT/INSERT/UPDATE/DELETE할 수 있도록 합니다. 정책은 `supabase/migrations/20261021000100_create_rest_plans.sql`에 있습니다. service_role 키는 사용하지 않습니다. 브라우저에는 공개 anon/publishable 키만 전달하며 사용자 JWT와 RLS가 권한을 제한합니다.

Supabase Dashboard에서 SQL Editor에 마이그레이션 SQL을 적용하고 Authentication의 허용 리디렉션 URL에 로컬 및 배포 주소의 `/login`을 등록하세요. 인증 화면은 `/login`이며 이메일과 비밀번호로 가입·로그인합니다. 가입 직후 인증 이메일 대기를 없애려면 Supabase Authentication의 Email provider 설정에서 **Confirm email**을 끄세요. 이 경우 이메일 주소 검증 없이 가입 즉시 세션이 발급되므로 주소 오타나 타인의 주소 사용을 막지 못합니다. 확인 옵션을 켜 둔 경우 Supabase가 이메일 링크를 보낸 뒤 사용자가 인증해야 로그인할 수 있습니다. 로컬 개발에는 `.env.local`에 프로젝트 URL과 공개 키가 필요합니다. Vercel 환경 변수는 사용자가 등록했다고 확인했으며, 이 저장소에서는 실제 Vercel 설정을 직접 확인하지 않았습니다. 기존 localStorage 계획은 로그인 후 내 계획 화면의 “내 계정으로 옮기기”를 눌러 이동할 수 있습니다.

## 기술

Next.js App Router, TypeScript, Tailwind CSS, Recharts, lucide-react, Supabase JS, Google Gen AI SDK, 한국천문연구원 특일정보 API, Google Calendar API.

## 로컬 실행

Node.js 20.9 이상이 필요합니다.

```bash
npm install
Copy-Item .env.example .env.local
npm run dev
```

`http://localhost:3000`에서 확인합니다. Supabase 값이 비어 있으면 계획은 브라우저 localStorage 임시 모드입니다. Google/KASI 키가 비어 있으면 Google 자료를 호출하지 않고 검증된 2026 로컬 자료만 사용합니다.

## 환경 변수

| 변수 | 필요 여부 | 용도 |
|---|---|---|
| `GOOGLE_CALENDAR_API_KEY` | Google 공휴일을 쓸 때 필요 | 서버 전용 Google Calendar API 키 |
| `KASI_SERVICE_KEY` | 선택 | KASI 공휴일 자료 보강 |
| `GEMINI_API_KEY` | AI 황금연휴 분석에 필요 | 서버 전용 Gemini API 키 |
| `NEXT_PUBLIC_SUPABASE_URL` | DB 사용 시 필요 | Supabase 프로젝트 URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | DB 사용 시 필요 | 브라우저 공개 anon/publishable 키 |

`.env.local`은 Git에 커밋하지 마세요. `.env.example`에는 실제 비밀값을 넣지 않습니다. Vercel에서는 Project Settings → Environment Variables에 같은 이름으로 등록하고 Preview/Production 환경을 선택하세요. 로컬 환경변수 변경 후 개발 서버를 재시작해야 합니다.

## Vercel 배포

GitHub 저장소에 프로젝트를 올리고 Vercel에서 저장소를 가져와 Next.js 프로젝트로 배포합니다. Google, KASI, Supabase 환경 변수는 Vercel에 등록했다고 사용자가 확인했습니다. Preview/Production 환경에 모두 필요한 변수가 지정되어 있는지 대시보드에서 확인하고, 값을 바꾼 경우 재배포하세요. Google 키는 Google Calendar API로 제한합니다. Gemini 키는 `GEMINI_API_KEY`로 등록하고 `NEXT_PUBLIC_` 접두사를 사용하지 마세요. Supabase Auth의 Site URL 및 Redirect URLs에는 실제 배포 도메인과 `https://배포도메인/login`을 등록합니다. 실제 GitHub 저장소나 배포 주소는 아직 문서에 제공되지 않았습니다.

- GitHub 저장소: `[여기에 저장소 주소 입력]`
- 배포 서비스: `[여기에 Vercel 서비스 주소 입력]`

## 검증 명령

```bash
npm test
npm run typecheck
npm run build
```

Supabase가 구성된 후 별도 계정 두 개로 CRUD 및 격리를 확인하고, Google API 키 설정 후 `/api/holidays?year=2026` 응답의 `googleStatus`, `verified`와 화면 계산을 확인하세요. API 장애도 키를 일시적으로 제한해 검증할 수 있습니다. 이 문서 작성 시 실제 외부 계정/API 자격증명은 제공되지 않아 실 API와 계정 간 RLS 동작은 검증할 수 없습니다.

## 수행평가 참고 및 한계

달력 산술은 날짜 문자열과 현지 날짜를 사용해 시간대 UTC 밀림을 피하고, 주말·공휴일은 날짜 집합으로 합쳐 중복 계산하지 않습니다. 연차 계산은 월~금 근무를 가정하므로 실제 사업장 근무일과 다를 수 있습니다. Google 캘린더 단독 일정은 공식 확정 정보가 아닙니다. 법정 공휴일 확정에는 KASI 자료와 법령을 확인하세요.

## 구현 및 검증 상태

- Google Calendar API는 `app/api/holidays/route.ts`에서 서버 측으로 호출합니다. 연도 범위의 종일 일정을 페이지 단위로 최대 10페이지까지 읽고, 유효한 해당 연도 날짜만 사용합니다. KASI 또는 검증된 로컬 자료와 같은 날짜면 해당 자료가 우선하며, Google 단독 날짜는 `verified: false`와 `partial`/`unverified` 상태로 전달됩니다.
- 계획 CRUD는 `lib/plans.ts`에서 처리합니다. Supabase 사용 시 로그인 사용자의 JWT와 `rest_plans` RLS 정책을 적용하고, 설정 전에는 localStorage 임시 저장을 사용합니다. RLS SQL은 `supabase/migrations/20261021000100_create_rest_plans.sql`입니다.
- `.gitignore`는 `.env*` 파일을 제외하며, 예시 파일 `.env.example`만 추적하도록 설정되어 있습니다. 실제 키를 저장소에 추가하지 마세요.
- `npm test`는 캘린더 계산과 황금연휴 분석 후보·응답 검증 테스트를 실행합니다. `npm run typecheck`와 `npm run build`로 TypeScript 및 프로덕션 빌드를 확인하세요.
- 실제 Gemini 생성 호출은 `GEMINI_API_KEY`가 필요합니다. Google/KASI 실 API, 실제 Supabase CRUD/RLS 격리, Vercel 배포 결과도 각 계정·키·배포 환경에서 별도로 확인해야 합니다.
