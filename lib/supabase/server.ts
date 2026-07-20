import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

// 라우트 핸들러 전용: 브라우저가 보낸 인증 쿠키로 로그인 세션을 읽어 RLS(to authenticated)를 통과시킴
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // Route Handler 응답이 이미 시작된 뒤에는 쿠키를 쓸 수 없음 — 예산 체크는 읽기 전용이라 무시해도 됨
          }
        },
      },
    }
  );
}
