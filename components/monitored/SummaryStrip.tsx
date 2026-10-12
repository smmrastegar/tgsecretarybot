"use client";

import { Tile, Usd, fa, type BudgetState } from "./shared";

// Four numbers at the top of the page: accounts, events in the last 24 h, accounts with errors, budget.
export default function SummaryStrip({
  loading,
  total,
  enabled,
  eventsDay,
  eventsMore,
  errors,
  budget,
}: {
  loading: boolean;
  total: number;
  enabled: number;
  eventsDay: number;
  eventsMore: boolean;
  errors: number;
  budget: BudgetState | null;
}) {
  const dash = "—";
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
      <Tile label="حساب‌های فعال">
        {loading ? (
          dash
        ) : (
          <bdi dir="ltr">
            {fa(enabled)}/{fa(total)}
          </bdi>
        )}
      </Tile>
      <Tile label="رویداد ۲۴ ساعت اخیر">
        {loading ? (
          dash
        ) : (
          <bdi dir="ltr">
            {fa(eventsDay)}
            {eventsMore ? "+" : ""}
          </bdi>
        )}
      </Tile>
      <Tile label="اکانت با خطا" tone={!loading && errors > 0 ? "bad" : "neutral"}>
        {loading ? dash : fa(errors)}
      </Tile>
      <Tile
        label="بودجه HikerAPI"
        tone={budget?.budgetExceeded ? "bad" : budget?.needsApproval ? "warn" : "neutral"}
        sub={
          budget ? (
            <>
              از <Usd v={budget.budgetUsd} d={0} />
            </>
          ) : undefined
        }
      >
        {budget ? <Usd v={budget.spentUsd} /> : dash}
      </Tile>
    </div>
  );
}
