'use client';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { PROVIDER_OF_MODEL, DEFAULT_BUDGET_USD, billingPeriodStart, type Provider } from '@/lib/budgets';
import type { ModelId } from '@/lib/models';

interface UsageRow { model: string; cost_usd: number; created_at: string; }

const EMPTY: Record<Provider, number> = { claude: 0, openai: 0, gemini: 0 };

// 모델 선택 드롭다운 등에서 "이번 결제 주기 예산의 몇 %를 썼는지"를 바로 보여주기 위한 훅
export function useProviderUsage() {
  const [pct, setPct] = useState<Record<Provider, number>>(EMPTY);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();

    async function load() {
      const [{ data: rows }, { data: budgetRows }] = await Promise.all([
        supabase.from('usage_logs').select('model, cost_usd, created_at'),
        supabase.from('provider_budgets').select('provider, budget_usd, billing_date'),
      ]);
      if (cancelled) return;

      const budget = { ...DEFAULT_BUDGET_USD };
      const billingDate: Record<Provider, string | null> = { claude: null, openai: null, gemini: null };
      for (const r of (budgetRows ?? []) as { provider: Provider; budget_usd: number; billing_date: string | null }[]) {
        if (r.provider in budget) {
          budget[r.provider] = Number(r.budget_usd);
          billingDate[r.provider] = r.billing_date;
        }
      }

      const used = { ...EMPTY };
      for (const row of (rows ?? []) as UsageRow[]) {
        const provider = PROVIDER_OF_MODEL[row.model as ModelId];
        if (!provider) continue;
        const start = billingDate[provider] ? billingPeriodStart(billingDate[provider]!) : null;
        if (start && new Date(row.created_at) < start) continue;
        used[provider] += Number(row.cost_usd);
      }

      setPct({
        claude: budget.claude > 0 ? (used.claude / budget.claude) * 100 : 0,
        openai: budget.openai > 0 ? (used.openai / budget.openai) * 100 : 0,
        gemini: budget.gemini > 0 ? (used.gemini / budget.gemini) * 100 : 0,
      });
    }

    load();
    return () => { cancelled = true; };
  }, []);

  return pct;
}
