'use client';
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

interface Props {
  onAuthSuccess: () => void;
}

export default function AuthModal({ onAuthSuccess }: Props) {
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState('');

  const supabase = createClient();

  async function handleGoogleLogin() {
    setGoogleLoading(true);
    setError('');
    try {
      const { error: err } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin },
      });
      if (err) throw err;
      // 성공 시 Google 페이지로 리다이렉트되고, 돌아오면 onAuthSuccess는 page.tsx의 세션 체크가 처리
    } catch (e: any) {
      setError(e.message || 'Google 로그인에 실패했습니다');
      setGoogleLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl p-8 w-96 shadow-lg">
        <div className="flex flex-col items-center mb-6">
          <div className="w-10 h-10 rounded-lg bg-emerald-500 flex items-center justify-center text-white text-sm font-bold mb-3">AF</div>
          <h1 className="text-xl font-bold text-gray-800">Animation for Everyone</h1>
          <p className="text-xs text-gray-400 mt-1">로그인하고 프로젝트를 관리하세요</p>
        </div>

        <button
          onClick={handleGoogleLogin}
          disabled={googleLoading}
          className="w-full flex items-center justify-center gap-2.5 py-2.5 border border-gray-300 hover:bg-gray-50 disabled:opacity-50 rounded-lg text-sm font-medium text-gray-700 transition-colors"
        >
          <svg width="18" height="18" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
          {googleLoading ? '연결 중...' : 'Google로 계속하기'}
        </button>

        {error && (
          <p className="text-xs mt-3 text-center text-red-500">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
