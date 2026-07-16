'use client';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { PROVIDER_OF_MODEL, PROVIDER_LABEL, DEFAULT_BUDGET_USD, ADMIN_EMAIL, billingPeriodStart, type Provider } from '@/lib/budgets';
import type { ModelId } from '@/lib/models';

interface UsageRow {
  model: string;
  cost_usd: number;
  user_email: string | null;
  created_at: string;
}

const PROVIDERS: Provider[] = ['claude', 'openai', 'gemini'];

// 예산이 소액이라 0.01달러 미만 사용량도 보이도록 소수점 4자리까지 표시
function fmtUsd(n: number) {
  return `$${n.toFixed(4)}`;
}

// 사용 기간 표시용 (예: "7월 14일 ~ 8월 13일") — 잠금 판정에 쓰는 billingPeriodStart와 같은 기준
function formatBillingPeriod(billingDate: string, today = new Date()) {
  const start = billingPeriodStart(billingDate, today);
  const end = new Date(start.getFullYear(), start.getMonth() + 1, start.getDate() - 1);
  const fmt = (d: Date) => `${d.getMonth() + 1}월 ${d.getDate()}일`;
  return `${fmt(start)} ~ ${fmt(end)}`;
}

interface Props {
  userEmail: string | null;
  onClose: () => void;
}

export default function UsageSummary({ userEmail, onClose }: Props) {
  const isAdmin = userEmail === ADMIN_EMAIL;
  const [rows, setRows] = useState<UsageRow[] | null>(null);
  const [budgets, setBudgets] = useState<Record<Provider, number>>(DEFAULT_BUDGET_USD);
  const [billingDates, setBillingDates] = useState<Record<Provider, string | null>>({ claude: null, openai: null, gemini: null });
  const [error, setError] = useState<string | null>(null);

  // 예산 편집 상태
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<Provider, string>>({ claude: '', openai: '', gemini: '' });
  const [draftDate, setDraftDate] = useState<Record<Provider, string>>({ claude: '', openai: '', gemini: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    // 사용량 로그
    supabase.from('usage_logs').select('model, cost_usd, user_email, created_at').then(({ data, error }) => {
      if (error) { setError(error.message); return; }
      setRows((data ?? []) as UsageRow[]);
    });
    // 충전 예산 + 결제일
    supabase.from('provider_budgets').select('provider, budget_usd, billing_date').then(({ data }) => {
      if (!data) return;
      const nextBudgets = { ...DEFAULT_BUDGET_USD };
      const nextDates: Record<Provider, string | null> = { claude: null, openai: null, gemini: null };
      for (const r of data as { provider: Provider; budget_usd: number; billing_date: string | null }[]) {
        if (r.provider in nextBudgets) {
          nextBudgets[r.provider] = Number(r.budget_usd);
          nextDates[r.provider] = r.billing_date;
        }
      }
      setBudgets(nextBudgets);
      setBillingDates(nextDates);
    });
  }, []);

  function startEdit() {
    setDraft({
      claude: String(budgets.claude),
      openai: String(budgets.openai),
      gemini: String(budgets.gemini),
    });
    setDraftDate({
      claude: billingDates.claude ?? '',
      openai: billingDates.openai ?? '',
      gemini: billingDates.gemini ?? '',
    });
    setEditing(true);
  }

  async function saveBudgets() {
    setSaving(true);
    const supabase = createClient();
    try {
      for (const p of PROVIDERS) {
        const value = parseFloat(draft[p]);
        if (isNaN(value)) continue;
        const { error } = await supabase.from('provider_budgets')
          .update({
            budget_usd: value,
            billing_date: draftDate[p] || null,
            updated_at: new Date().toISOString(),
          })
          .eq('provider', p);
        if (error) throw error;
      }
      // 화면 반영
      setBudgets({
        claude: parseFloat(draft.claude) || budgets.claude,
        openai: parseFloat(draft.openai) || budgets.openai,
        gemini: parseFloat(draft.gemini) || budgets.gemini,
      });
      setBillingDates({
        claude: draftDate.claude || null,
        openai: draftDate.openai || null,
        gemini: draftDate.gemini || null,
      });
      setEditing(false);
    } catch (e: any) {
      alert('예산 저장에 실패했습니다: ' + (e?.message ?? ''));
    } finally {
      setSaving(false);
    }
  }

  // 집계 (이번 결제 주기 사용량만 — API 라우트의 잠금 판정과 동일한 기준)
  const byProvider: Record<Provider, number> = { claude: 0, openai: 0, gemini: 0 };
  const byUserProvider = new Map<string, Record<Provider, number>>();
  for (const row of rows ?? []) {
    const provider = PROVIDER_OF_MODEL[row.model as ModelId];
    if (!provider) continue;
    const billingDate = billingDates[provider];
    if (billingDate && new Date(row.created_at) < billingPeriodStart(billingDate)) continue;
    byProvider[provider] += Number(row.cost_usd);
    const email = row.user_email ?? '(알 수 없음)';
    if (!byUserProvider.has(email)) byUserProvider.set(email, { claude: 0, openai: 0, gemini: 0 });
    byUserProvider.get(email)![provider] += Number(row.cost_usd);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-xl p-6 w-[520px] max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-sm font-bold text-gray-800">팀 AI 사용량</h2>
          <div className="flex items-center gap-2">
            {isAdmin && !editing && (
              <button onClick={startEdit} className="text-[11px] text-gray-400 hover:text-emerald-600 transition-colors">
                예산 수정
              </button>
            )}
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-sm">✕</button>
          </div>
        </div>
        <p className="text-[10px] text-gray-400 mb-4">
          우리 앱에서 호출한 내역 기준 추정치입니다 (실제 청구액과 소폭 다를 수 있음)
        </p>

        {error && <p className="text-xs text-red-500">불러오기 실패: {error}</p>}
        {!rows && !error && <p className="text-xs text-gray-400">불러오는 중...</p>}

        {rows && (
          <>
            {/* 프로바이더별 잔액 */}
            <div className="space-y-3 mb-6">
              {PROVIDERS.map((p) => {
                const used = byProvider[p];
                const total = budgets[p];
                const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0;
                const remaining = Math.max(0, total - used);
                const locked = used >= total;
                return (
                  <div key={p}>
                    <div className="flex justify-between items-center text-xs mb-1">
                      <span className="font-semibold text-gray-700 flex items-center gap-1.5">
                        {PROVIDER_LABEL[p]}
                        {!editing && locked && (
                          <span className="text-[10px] font-semibold text-red-500 bg-red-50 px-1.5 py-0.5 rounded-full">
                            🔒 한도 도달
                          </span>
                        )}
                      </span>
                      {editing ? (
                        <span className="flex items-center gap-1.5 text-gray-500">
                          충전액 $
                          <input
                            type="number"
                            step="0.01"
                            value={draft[p]}
                            onChange={(e) => setDraft((d) => ({ ...d, [p]: e.target.value }))}
                            className="w-20 border border-gray-200 rounded px-1.5 py-0.5 text-xs text-right outline-none focus:border-emerald-400"
                          />
                          <span className="text-gray-300">·</span>
                          결제일
                          <input
                            type="date"
                            value={draftDate[p]}
                            onChange={(e) => setDraftDate((d) => ({ ...d, [p]: e.target.value }))}
                            className="border border-gray-200 rounded px-1.5 py-0.5 text-xs outline-none focus:border-emerald-400"
                          />
                        </span>
                      ) : (
                        <span className="text-gray-500">
                          {fmtUsd(used)} / ${total.toFixed(2)} (잔액 {fmtUsd(remaining)})
                        </span>
                      )}
                    </div>
                    <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${
                          locked ? 'bg-red-500' : pct >= 70 ? 'bg-amber-400' : 'bg-emerald-400'
                        }`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    {!editing && billingDates[p] && (
                      <p className="text-[10px] text-gray-400 mt-0.5">
                        사용 가능 기간: {formatBillingPeriod(billingDates[p]!)}
                        {locked && ' · 이번 주기 API 호출이 차단됩니다'}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>

            {editing && (
              <div className="flex gap-2 justify-end mb-6 -mt-3">
                <p className="text-[10px] text-gray-400 mr-auto self-center">수수료·환율을 뺀 실제 충전 달러를 입력하세요</p>
                <button onClick={() => setEditing(false)} className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700">취소</button>
                <button onClick={saveBudgets} disabled={saving}
                  className="px-3 py-1.5 text-xs font-semibold bg-emerald-500 hover:bg-emerald-600 disabled:opacity-40 text-white rounded-lg transition-colors">
                  {saving ? '저장 중...' : '저장'}
                </button>
              </div>
            )}

            {/* 팀원별 사용량 */}
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-2">팀원별 사용량 (USD)</p>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-gray-400 border-b border-gray-100">
                  <th className="text-left font-medium py-1.5">팀원</th>
                  {PROVIDERS.map((p) => (
                    <th key={p} className="text-right font-medium py-1.5">{PROVIDER_LABEL[p]}</th>
                  ))}
                  <th className="text-right font-medium py-1.5">합계</th>
                </tr>
              </thead>
              <tbody>
                {[...byUserProvider.entries()].map(([email, costs]) => {
                  const total = PROVIDERS.reduce((sum, p) => sum + costs[p], 0);
                  return (
                    <tr key={email} className="border-b border-gray-50">
                      <td className="py-1.5 text-gray-700 truncate max-w-[140px]">{email}</td>
                      {PROVIDERS.map((p) => (
                        <td key={p} className="text-right py-1.5 text-gray-600">{fmtUsd(costs[p])}</td>
                      ))}
                      <td className="text-right py-1.5 font-semibold text-gray-800">{fmtUsd(total)}</td>
                    </tr>
                  );
                })}
                {byUserProvider.size === 0 && (
                  <tr><td colSpan={PROVIDERS.length + 2} className="py-3 text-center text-gray-400">아직 사용 기록이 없어요</td></tr>
                )}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  );
}
