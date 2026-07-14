'use client';
import type { UploadedSource } from '@/types';

const TYPE_ICON: Record<UploadedSource['type'], string> = {
  file: '📄', link: '🔗', text: '📝',
};

// 분석 진행/실패만 표시 (완료·대기는 채팅 메시지로 안내되므로 배지 생략)
const ANALYSIS_INFO: Partial<Record<UploadedSource['analysisStatus'], { label: string; cls: string }>> = {
  analyzing: { label: '분석 중...', cls: 'text-blue-500' },
  error:     { label: '분석 실패', cls: 'text-red-500' },
};

interface Props {
  source: UploadedSource;
  onDelete: (id: string) => void;
}

export default function AttachmentCard({ source, onDelete }: Props) {
  return (
    <div className="flex items-start gap-3 bg-white border border-gray-200 rounded-xl px-4 py-3 shadow-sm max-w-xs">
      <span className="text-xl shrink-0 mt-0.5">{TYPE_ICON[source.type]}</span>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-gray-800 truncate">{source.name}</p>
        <p className="text-[10px] text-gray-400 mt-0.5">
          {source.uploadStatus === 'uploading' ? '업로드 중...' : '업로드 완료'}
          {ANALYSIS_INFO[source.analysisStatus] && (
            <>
              {' · '}
              <span className={ANALYSIS_INFO[source.analysisStatus]!.cls}>
                {ANALYSIS_INFO[source.analysisStatus]!.label}
              </span>
            </>
          )}
        </p>
      </div>
      <button
        onClick={() => onDelete(source.id)}
        className="text-gray-300 hover:text-red-400 transition-colors text-sm shrink-0"
      >
        ✕
      </button>
    </div>
  );
}
