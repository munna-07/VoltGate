"use client"

import { AlertTriangle } from "lucide-react"
import { cn } from "@/lib/utils"

export interface ModelQuota {
  name: string
  tier?: string
  usage: number // 0-5 representing filled bars
  refreshTime: string
  warning?: boolean
}

interface ModelQuotaListProps {
  models: ModelQuota[]
  className?: string
}

export function ModelQuotaList({ models, className }: ModelQuotaListProps) {
  return (
    <div className={cn("rounded-md border border-border bg-card/50", className)}>
      <div className="px-4 py-3 border-b border-border">
        <h3 className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Model Quota
        </h3>
      </div>
      <div className="divide-y divide-border/50">
        {models.map((model, index) => (
          <ModelQuotaItem key={index} model={model} />
        ))}
      </div>
    </div>
  )
}

interface ModelQuotaItemProps {
  model: ModelQuota
}

function ModelQuotaItem({ model }: ModelQuotaItemProps) {
  const bars = 5
  const filledBars = model.usage

  return (
    <div className="px-4 py-3 hover:bg-secondary/20 transition-colors">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-medium text-foreground truncate">
            {model.name}
            {model.tier && (
              <span className="text-muted-foreground"> ({model.tier})</span>
            )}
          </span>
          {model.warning && (
            <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" />
          )}
        </div>
        <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
          {model.refreshTime}
        </span>
      </div>
      
      {/* Usage bars */}
      <div className="mt-2 flex gap-1.5">
        {Array.from({ length: bars }).map((_, i) => (
          <div
            key={i}
            className={cn(
              "h-1 flex-1 rounded-full transition-all",
              i < filledBars
                ? "bg-muted-foreground/60"
                : "bg-muted-foreground/15"
            )}
          />
        ))}
      </div>
    </div>
  )
}

// Standalone card version for dashboard
interface ModelQuotaCardProps {
  models: ModelQuota[]
  className?: string
}

export function ModelQuotaCard({ models, className }: ModelQuotaCardProps) {
  return (
    <div className={cn("rounded-md border border-border bg-card", className)}>
      <div className="px-4 py-3 border-b border-border/50">
        <h3 className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Model Quota
        </h3>
      </div>
      <div className="divide-y divide-border/30">
        {models.map((model, index) => (
          <ModelQuotaItem key={index} model={model} />
        ))}
      </div>
    </div>
  )
}
