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
