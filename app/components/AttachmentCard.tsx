'use client';
import type { UploadedSource } from '@/types';

const TYPE_ICON: Record<UploadedSource['type'], string> = {
  file: '📄', link: '🔗', text: '📝',
};

const ANALYSIS_LABEL: Record<UploadedSource['analysisStatus'], string> = {
  pending:   '분석 대기',
  analyzing: '분석 중...',
  done:      '분석 완료',
  error:     '분석 실패',
};

const ANALYSIS_CLS: Record<UploadedSource['analysisStatus'], string> = {
  pending:   'text-gray-400',
  analyzing: 'text-blue-500',
  done:      'text-emerald-600',
  error:     'text-red-500',
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
          {' · '}
          <span className={ANALYSIS_CLS[source.analysisStatus]}>
            {ANALYSIS_LABEL[source.analysisStatus]}
          </span>
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
