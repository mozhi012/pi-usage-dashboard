"use client";

import type { DateRange, UsageFilters as Filters } from "@/lib/filter-usage";

const DATE_RANGES: { value: DateRange; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "today", label: "今天" },
  { value: "24h", label: "24 小时" },
  { value: "7d", label: "7 天" },
  { value: "30d", label: "30 天" },
];

interface Props {
  filters: Filters;
  providers: string[];
  models: string[];
  onChange: (filters: Filters) => void;
}

export function UsageFilters({ filters, providers, models, onChange }: Props) {
  const selectClass = "h-9 w-full min-w-0 rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-52";
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-3" role="group" aria-label="统计筛选">
      <div className="flex max-w-full items-center gap-0.5 overflow-x-auto rounded-lg bg-muted p-1" role="group" aria-label="日期范围">
        {DATE_RANGES.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            aria-pressed={filters.dateRange === value}
            onClick={() => onChange({ ...filters, dateRange: value })}
            className={`whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${filters.dateRange === value ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
          >
            {label}
          </button>
        ))}
      </div>
      <select
        aria-label="供应商"
        value={filters.provider}
        onChange={(event) => onChange({ ...filters, provider: event.target.value })}
        className={selectClass}
      >
        <option value="">全部供应商</option>
        {providers.map((provider) => <option key={provider} value={provider}>{provider}</option>)}
      </select>
      <select
        aria-label="模型"
        value={filters.model}
        onChange={(event) => onChange({ ...filters, model: event.target.value })}
        className={selectClass}
      >
        <option value="">全部模型</option>
        {models.map((model) => <option key={model} value={model}>{model}</option>)}
      </select>
    </div>
  );
}
