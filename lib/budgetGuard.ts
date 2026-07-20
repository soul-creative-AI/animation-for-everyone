import { createClient } from '@/lib/supabase/server';
import { PROVIDER_OF_MODEL, PROVIDER_LABEL, MODELS_OF_PROVIDER, billingPeriodStart, type Provider } from '@/lib/budgets';
import type { ModelId } from '@/lib/models';

export interface BudgetLockResult {
  locked: boolean;
  provider: Provider;
  used: number;
  budget: number;
}

// 이번 결제 주기 기준으로 해당 모델의 프로바이더 예산을 다 썼는지 확인.
// 조회 자체가 실패하면(네트워크 오류 등) 기능 전체가 막히지 않도록 통과시킴(fail-open).
export async function checkBudgetLock(modelId: ModelId): Promise<BudgetLockResult | null> {
  const provider = PROVIDER_OF_MODEL[modelId];
  if (!provider) return null;

  try {
    const supabase = await createClient();

    const { data: budgetRow } = await supabase
      .from('provider_budgets')
      .select('budget_usd, billing_date')
      .eq('provider', provider)
      .maybeSingle();

    if (!budgetRow) return null;
    const budget = Number(budgetRow.budget_usd);

    const periodStart = budgetRow.billing_date ? billingPeriodStart(budgetRow.billing_date) : new Date(0);

    const { data: usageRows, error } = await supabase
      .from('usage_logs')
      .select('cost_usd')
      .in('model', MODELS_OF_PROVIDER[provider])
      .gte('created_at', periodStart.toISOString());

    if (error) return null;

    const used = (usageRows ?? []).reduce((sum, r) => sum + Number(r.cost_usd), 0);
    return { locked: used >= budget, provider, used, budget };
  } catch (e) {
    console.error('예산 체크 실패 (fail-open으로 통과):', e);
    return null;
  }
}

export function budgetLockMessage(result: BudgetLockResult): string {
  return `이번 달 ${PROVIDER_LABEL[result.provider]} 예산($${result.budget.toFixed(2)})을 모두 사용했어요. 관리자에게 예산 충전을 요청하거나 다른 프로바이더의 모델을 선택해주세요.`;
}
