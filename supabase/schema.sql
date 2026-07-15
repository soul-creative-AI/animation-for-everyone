-- animation-for-everyone: projects 테이블 생성 + 보안 규칙(RLS)
-- Supabase 대시보드 > SQL Editor 에서 전체 실행하세요.

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default '새 프로젝트',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  data jsonb not null default '{}'::jsonb  -- 기획/리서치 데이터 전체를 JSON으로 저장
);

-- 사용자별 조회 속도 향상
create index if not exists projects_user_id_idx on public.projects(user_id);

-- 사이드바 프로젝트 목록 사용자 정의 순서
alter table public.projects add column if not exists sort_order integer not null default 0;

-- 행 단위 보안 활성화: 이게 없으면 모든 유저가 서로의 데이터를 볼 수 있음
alter table public.projects enable row level security;

-- 내 프로젝트만 조회
create policy "select own projects"
  on public.projects for select
  using (auth.uid() = user_id);

-- 내 프로젝트만 생성 (user_id가 본인이어야 함)
create policy "insert own projects"
  on public.projects for insert
  with check (auth.uid() = user_id);

-- 내 프로젝트만 수정
create policy "update own projects"
  on public.projects for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 내 프로젝트만 삭제
create policy "delete own projects"
  on public.projects for delete
  using (auth.uid() = user_id);

-- ── 리서치 원본 파일 저장소 (각색 원작 등) ──────────────────────
-- 경로 규칙: {user_id}/{project_id}/{파일명} — 첫 폴더가 본인 user_id와 일치해야 접근 가능
insert into storage.buckets (id, name, public)
values ('research-sources', 'research-sources', false)
on conflict (id) do nothing;

create policy "select own research source files"
  on storage.objects for select
  using (bucket_id = 'research-sources' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "insert own research source files"
  on storage.objects for insert
  with check (bucket_id = 'research-sources' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "update own research source files"
  on storage.objects for update
  using (bucket_id = 'research-sources' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "delete own research source files"
  on storage.objects for delete
  using (bucket_id = 'research-sources' and (storage.foldername(name))[1] = auth.uid()::text);

-- ── AI 사용량 기록 (모델별 토큰/비용 추적) ──────────────────────
-- append-only 로그. 예산/사용량 집계에 사용.
-- API 키 1개를 팀원 여럿이 공유하는 구조라, user_email을 같이 저장해서
-- 팀 전체 사용량 화면에서 "누가 얼마 썼는지" 바로 보여줄 수 있게 함.
create table if not exists public.usage_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  user_email text,                             -- 기록 시점의 이메일 (표시용, auth.users 조인 불필요)
  project_id uuid references public.projects(id) on delete set null,
  model text not null,                         -- 'gemini' | 'claude-fable' | 'gpt-4o' 등
  feature text not null,                       -- 'planning-chat' | 'research-analyze' 등
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cached_input_tokens integer not null default 0,
  cost_usd numeric(12, 6) not null default 0,  -- 근사 비용 (lib/usage.ts 단가 기준)
  created_at timestamptz not null default now()
);

-- 이미 테이블이 있던 경우를 위한 컬럼 추가 (신규 생성 시엔 위에서 이미 포함됨)
alter table public.usage_logs add column if not exists user_email text;

create index if not exists usage_logs_user_created_idx on public.usage_logs(user_id, created_at);

alter table public.usage_logs enable row level security;

-- 팀 전체가 같은 API 키를 공유하므로, 로그인한 사람이면 누구나 전체 사용량을 조회 가능
-- (기존엔 본인 것만 조회 가능했으나, 팀 예산 공유 화면을 위해 범위를 넓힘)
drop policy if exists "select own usage logs" on public.usage_logs;
create policy "select usage logs (team-wide)"
  on public.usage_logs for select
  to authenticated
  using (true);

-- 생성은 본인 이름으로만 가능 (남의 user_id로 기록 위조 방지) — 수정·삭제 정책 없음(append-only)
create policy "insert own usage logs"
  on public.usage_logs for insert
  with check (auth.uid() = user_id);

-- ── 프로바이더별 충전 예산 (운영자만 수정) ──────────────────────
-- 팀원 모두가 잔액을 조회하되, 충전액 수정은 운영자 계정만 가능.
create table if not exists public.provider_budgets (
  provider text primary key,            -- 'claude' | 'openai' | 'gemini'
  budget_usd numeric(12, 2) not null default 0,
  billing_date date,                    -- 충전(결제)일 — "이 예산은 이 날짜 기준 한 달치" 안내용
  updated_at timestamptz not null default now()
);

-- 이미 테이블이 있던 경우를 위한 컬럼 추가
alter table public.provider_budgets add column if not exists billing_date date;

-- 초기값 (수수료 뺀 실제 충전 달러로 운영자가 나중에 조정)
insert into public.provider_budgets (provider, budget_usd, billing_date) values
  ('claude', 21, '2026-07-14'), ('openai', 13, '2026-07-14'), ('gemini', 10, '2026-07-14')
on conflict (provider) do nothing;

alter table public.provider_budgets enable row level security;

-- 조회: 로그인한 팀원 누구나
create policy "select provider budgets"
  on public.provider_budgets for select
  to authenticated
  using (true);

-- 수정(update): 운영자 이메일 계정만 (화면 숨김만으로는 우회 가능하므로 DB에서도 강제)
create policy "admin update provider budgets"
  on public.provider_budgets for update
  to authenticated
  using ((auth.jwt() ->> 'email') = 'mina214@sookmyung.ac.kr')
  with check ((auth.jwt() ->> 'email') = 'mina214@sookmyung.ac.kr');
