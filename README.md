# 빨간날 폭격기 · RED DAY BLAST

한국의 공휴일과 주말을 분석해 달력, 황금연휴, 연차 효율, 통계와 개인 휴식 계획을 제공하는 Next.js 서비스입니다.

## 주요 기능

- 연도별 대시보드·달력·월별 휴식일 및 연속 휴식 분석
- 3일 이상 황금연휴 탐색, 연차 날짜 조합과 효율 추천
- 자연어 요청에 맞는 Groq AI 계획 추천 및 기존 계획 날짜 중복 비교
- 개인 계획 등록·조회·수정·삭제
- 서버 계산 기반 일정 충돌 검사와 Groq 설명·대안
- Supabase Auth와 사용자별 RLS 기반 계획 저장. Supabase 미설정 시 브라우저 localStorage 사용

## 공휴일 데이터

`app/api/holidays/route.ts`가 Google Calendar 공개 피드와 KASI 특일정보를 서버에서 조회합니다. KASI 또는 검증된 2026년 로컬 자료를 공식 계산 데이터로 우선 사용합니다. Google 공개 캘린더 단독 항목은 법정 공휴일 근거로 간주하지 않으며 휴식일 계산에 포함하지 않습니다. 데이터가 없거나 외부 API가 실패하면 검증된 로컬 자료를 사용하고, 자료가 없는 연도는 미확인 상태로 표시합니다.

Google Calendar API 키는 Google Cloud Console에서 발급하고 API 제한을 Google Calendar API로 설정한 뒤 `GOOGLE_CALENDAR_API_KEY`로 등록하세요. 선택 사항인 `KASI_SERVICE_KEY`는 공공데이터포털의 한국천문연구원 특일정보 API 키입니다. 두 키 모두 브라우저에 노출하지 마세요.

## Groq AI

`https://api.groq.com/openai/v1/chat/completions` OpenAI 호환 API를 서버에서 호출합니다. `/ai-planner`는 자연어 요청, 선택적인 월·연차 한도·목표 기간·목적·추가 조건에 맞춰 최대 3개 계획을 추천합니다. 서버가 공휴일 달력에서 날짜 후보와 필요한 평일 연차를 계산하고, Groq 모델은 계산된 후보를 선택해 설명과 장단점을 작성합니다. 날짜·연차 수는 응답의 후보 ID와 서버 계산값으로 검증합니다. 사용자가 날짜를 수정하면 화면에서 기간과 필요한 연차를 다시 계산하며, 선택한 계획만 기존 `rest_plans` 저장 기능으로 저장할 수 있습니다.

저장된 계획을 읽을 수 있는 경우에는 시작일·종료일만 Groq 요청에 포함해 날짜 중복을 확인합니다. 제목과 메모는 전송하지 않습니다. 기존 계획을 읽지 못하면 충돌을 확인했다고 표시하지 않습니다.

Groq Console에서 API 키를 발급해 `.env.local`의 `GROQ_API_KEY`에 설정하세요. 현재 계정에서 사용 가능한 모델은 [Groq Models](https://console.groq.com/docs/models)에서 확인하고, Chat Completions JSON mode를 지원하는 모델 ID를 `GROQ_MODEL`에 입력합니다. 기본 모델명은 임의로 지정하지 않습니다. 두 변수 모두 서버 전용이며 키 이름에 `NEXT_PUBLIC_`을 붙이지 마세요. JSON mode로 JSON 객체를 요청하고 서버에서 필드와 후보 ID를 검증합니다. 5xx 및 네트워크 오류는 최대 한 번만 재시도하며 429는 기다린 뒤 다시 시도하도록 사용자에게 안내합니다.

## 일정 점검

`/schedule-check`는 일정의 시간 중복을 서버에서 판정합니다. Groq는 서버가 검출한 이슈를 설명하고 대안을 제안하며, 응답 검증 후 사용자가 적용을 선택해야 변경됩니다. `GOOGLE_MAPS_API_KEY`가 설정된 경우에만 Places API로 장소 정보를, Routes API로 예상 이동 시간을 조회합니다. 예약 시스템과 연결되어 있지 않으므로 예약 가능 여부를 확인하지 않습니다. Groq 키나 모델 설정이 없거나 요청이 실패해도 기본 시간 충돌 검사는 동작합니다.

일정 저장용 마이그레이션은 `supabase/migrations/20261023000100_create_schedule_check_data.sql`입니다. 일정 기록은 사용자별 RLS로 보호되고, Supabase 미설정 시 현재 브라우저의 localStorage를 사용합니다.

## Supabase 계획 저장

계획은 `public.rest_plans`에 저장합니다. 로그인한 사용자는 자신의 데이터만 CRUD할 수 있도록 RLS 정책을 사용합니다. 적용할 마이그레이션은 다음과 같습니다.

- `supabase/migrations/20261021000100_create_rest_plans.sql`
- `supabase/migrations/20261022000100_add_local_plan_import_id.sql`

Supabase Dashboard의 SQL Editor에서 마이그레이션을 적용하고 Authentication의 허용 리디렉션 URL에 로컬 및 배포 주소의 `/login`을 등록하세요. service_role 키는 사용하지 않습니다. 브라우저에는 공개 anon/publishable 키만 전달하며 사용자 JWT와 RLS가 권한을 제한합니다. 가입 이메일 확인 여부는 Supabase Email provider 설정을 따릅니다.

## 기술 및 로컬 실행

Next.js App Router, TypeScript, Tailwind CSS, Recharts, lucide-react, Supabase JS, Groq OpenAI-compatible API, 한국천문연구원 특일정보 API, Google Calendar API를 사용합니다. Node.js 22 이상이 필요합니다.

```powershell
npm install
Copy-Item .env.example .env.local
npm run dev
```

`http://localhost:3000`에서 확인합니다. 환경변수를 변경한 뒤 개발 서버를 재시작하세요.

## 환경 변수

| 변수 | 필요 여부 | 용도 |
|---|---|---|
| `GROQ_API_KEY` | AI 계획 추천·일정 설명에 필요 | 서버 전용 Groq API 키 |
| `GROQ_MODEL` | AI 사용 시 필요 | Groq 공식 모델 목록에서 선택한 모델 ID |
| `GOOGLE_CALENDAR_API_KEY` | Google 공휴일 피드를 사용할 때 | 서버 전용 Calendar API 키 |
| `KASI_SERVICE_KEY` | 선택 | KASI 공휴일 자료 보강 |
| `GOOGLE_MAPS_API_KEY` | 장소·경로 기능 사용 시 | 서버 전용 Places 및 Routes API 키 |
| `NEXT_PUBLIC_SUPABASE_URL` | 계정 저장 사용 시 | Supabase 프로젝트 URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 계정 저장 사용 시 | Supabase 공개 anon/publishable 키 |

`.env.local`은 Git에 올리지 마세요. `.env.example`에는 실제 비밀값을 넣지 않습니다.

## Vercel 배포

Vercel Project Settings → Environment Variables에서 `GROQ_API_KEY`와 `GROQ_MODEL`을 Preview 및 Production에 각각 등록한 뒤 재배포하세요. 키에 `NEXT_PUBLIC_` 접두사를 사용하지 마세요. 모델 ID는 Groq Console의 현재 계정 모델 목록에서 확인합니다. Google 키는 사용할 API별로 제한하고, Supabase Auth의 Site URL 및 Redirect URLs에는 배포 도메인과 `/login` 주소를 등록하세요.

## 검증

```bash
npm test
npm run typecheck
npm run build
```

Groq 실 API, Google/KASI 실 API, Supabase CRUD와 계정 간 RLS 격리, Vercel 배포는 각 계정과 키가 설정된 환경에서 별도로 확인해야 합니다.

## 계산과 한계

달력 계산은 날짜 키를 사용해 시간대 UTC 밀림을 피하고, 주말과 공휴일 중복을 제거합니다. 연차 계산은 월~금 근무를 가정하므로 실제 근무 일정과 다를 수 있습니다. Google Calendar 단독 일정은 공식 공휴일로 취급하지 않으며 법정 공휴일 확정에는 KASI 자료와 관련 법령을 확인하세요.

일정의 이동 시간은 Routes의 예상값이며 교통 상황에 따라 달라질 수 있습니다. 일반 영업시간은 공휴일 운영을 보장하지 않습니다. 예약 가능 여부를 확인하는 기능은 없습니다. Groq에는 일정명·일시·장소명과 서버 산출 이슈만 전달하며 메모, 주소, Place ID 및 연락처 등은 전달하지 않습니다.