'use client';
import type { PlatformMetric } from '@/types';

interface Props {
  metrics: PlatformMetric[];
  originalTitle?: string;  // 검색 링크 생성용 (URL 미확인 플랫폼)
  onAdd: () => void;
  onUpdate: (id: string, patch: Partial<PlatformMetric>) => void;
  onRemove: (id: string) => void;
}

// 플랫폼명 + 작품명으로 구글 검색 URL 생성 (네이버시리즈 등 직접 링크를 못 찾은 플랫폼용)
function searchUrl(platform: string, title: string) {
  const q = [platform, title].filter((s) => s && s.trim()).join(' ');
  return `https://www.google.com/search?q=${encodeURIComponent(q)}`;
}

// 플랫폼별로 조회수·평점을 따로 입력하는 에디터
export default function PlatformMetricsEditor({ metrics, originalTitle = '', onAdd, onUpdate, onRemove }: Props) {
  const rows = metrics ?? [];  // 레거시 데이터 방어 (platformMetrics 없던 프로젝트)
  return (
    <div className="space-y-2">
      {rows.length === 0 && (
        <p className="text-[10px] text-gray-400">
          아직 등록한 플랫폼이 없어요. 아래 &lsquo;+ 플랫폼 추가&rsquo;로 카카오페이지·문피아 등을 하나씩 넣어주세요.
        </p>
      )}

      {rows.map((m) => (
        <div key={m.id} className="rounded-lg border border-gray-200 bg-gray-50/60 p-2.5 space-y-2">
          <div className="flex items-center gap-1.5">
            {m.url ? (
              <a
                href={m.url}
                target="_blank"
                rel="noreferrer"
                title={`${m.platform} 페이지로 이동`}
                className="flex-1 px-2 py-1.5 rounded-md bg-white border border-emerald-300 text-emerald-700 hover:bg-emerald-50 font-medium text-xs transition-colors"
              >
                {m.platform || '(플랫폼)'} ↗
              </a>
            ) : (
              <input
                value={m.platform}
                onChange={(e) => onUpdate(m.id, { platform: e.target.value })}
                placeholder="플랫폼명 (예: 카카오페이지)"
                className="flex-1 bg-white border border-gray-200 rounded-md px-2 py-1.5 text-xs text-gray-800 placeholder-gray-400 outline-none focus:border-emerald-400"
              />
            )}
            <button
              onClick={() => onRemove(m.id)}
              title="이 플랫폼 삭제"
              className="w-6 h-6 flex items-center justify-center rounded-md text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors shrink-0"
            >
              ✕
            </button>
          </div>
          {/* 직접 링크를 못 찾은 플랫폼(예: 네이버시리즈)은 검색 링크로 대체하고 안내 */}
          {!m.url && (m.platform || originalTitle) && (
            <p className="text-[10px] text-gray-400 leading-relaxed">
              직접 링크가 없어요.{' '}
              <a
                href={searchUrl(m.platform, originalTitle)}
                target="_blank"
                rel="noreferrer"
                className="text-emerald-600 hover:underline font-medium"
              >
                🔍 {m.platform || '이 플랫폼'}에서 검색
              </a>
              해서 작품 페이지 URL을 찾아 위 칸에 붙여넣으세요.
            </p>
          )}
          <div className="flex gap-1.5">
            <label className="flex-1">
              <span className="block text-[9px] font-medium text-gray-400 mb-0.5">조회수</span>
              <input
                value={m.views}
                onChange={(e) => onUpdate(m.id, { views: e.target.value })}
                placeholder="예: 4,120만"
                className="w-full bg-white border border-gray-200 rounded-md px-2 py-1.5 text-xs text-gray-800 placeholder-gray-400 outline-none focus:border-emerald-400"
              />
            </label>
            <label className="flex-1">
              <span className="block text-[9px] font-medium text-gray-400 mb-0.5">평점</span>
              <input
                value={m.rating}
                onChange={(e) => onUpdate(m.id, { rating: e.target.value })}
                placeholder="예: 9.8"
                className="w-full bg-white border border-gray-200 rounded-md px-2 py-1.5 text-xs text-gray-800 placeholder-gray-400 outline-none focus:border-emerald-400"
              />
            </label>
          </div>
          <div>
            <label>
              <span className="block text-[9px] font-medium text-gray-400 mb-0.5">댓글·리뷰 (페이지에서 복사)</span>
              <textarea
                value={m.comments}
                onChange={(e) => onUpdate(m.id, { comments: e.target.value })}
                placeholder="이 플랫폼 페이지에서 복사한 댓글·리뷰를 붙여넣으세요. AI가 긍정/부정으로 분석합니다."
                rows={3}
                className="w-full bg-white border border-gray-200 rounded-md px-2 py-1.5 text-[11px] text-gray-800 placeholder-gray-400 outline-none focus:border-emerald-400 resize-none"
              />
            </label>
          </div>
        </div>
      ))}

      <button
        onClick={onAdd}
        className="w-full px-3 py-1.5 rounded-lg text-xs font-semibold border border-dashed border-emerald-300 text-emerald-600 hover:bg-emerald-50 transition-colors"
      >
        + 플랫폼 추가
      </button>
    </div>
  );
}
