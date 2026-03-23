"use client"

import { useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ChevronDown, ChevronUp, Trash2, Power, RefreshCw, Zap, Clock, Shield, Server, AlertTriangle } from "lucide-react"
import { cn } from "@/lib/utils"

export interface ModelQuota {
  name: string
  tier?: string
  usage?: number
  refreshTime: string
  warning?: boolean
}

interface AccountCardProps {
  email: string
  projectName: string
  description?: string
  status: "ready" | "cooling" | "limited" | "disabled"
  models: number
  blocked: number
  updated: string
  modelTags: string[]
  modelQuotas?: ModelQuota[]
  project?: string
  expires?: string
  nextRetry?: string
  lastRefresh?: string
  routingPrefix?: string
  fileName?: string
  isRefreshing?: boolean
  onDisable?: () => void
  onRemove?: () => void
  onRefresh?: () => void
}

export function AccountCard({
  email,
  projectName,
  description = "Managed through the runtime auth pool.",
  status,
  models,
  blocked,
  updated,
  modelTags,
  modelQuotas,
  project,
  expires,
  nextRetry,
  lastRefresh,
  routingPrefix = "Default",
  fileName,
  isRefreshing = false,
  onDisable,
  onRemove,
  onRefresh,
}: AccountCardProps) {
  const [isExpanded, setIsExpanded] = useState(false)

  const statusConfig = {
    ready: {
      label: "Ready",
      className: "bg-emerald-500/10 text-emerald-500 border-emerald-500/30",
      dotClassName: "bg-emerald-500",
    },
    cooling: {
      label: "Cooling",
      className: "bg-amber-500/10 text-amber-500 border-amber-500/30",
      dotClassName: "bg-amber-500",
    },
    limited: {
      label: "Limited",
      className: "bg-red-500/10 text-red-500 border-red-500/30",
      dotClassName: "bg-red-500",
    },
    disabled: {
      label: "Disabled",
      className: "bg-secondary text-muted-foreground border-border",
      dotClassName: "bg-muted-foreground",
    },
  }

  const currentStatus = statusConfig[status]

  return (
    <div className="group rounded-md border border-border bg-card transition-colors hover:border-primary/30 hover:bg-card/80">
      <div className="p-4">
        {/* Header row */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary">
                <Zap className="h-3.5 w-3.5" />
              </div>
              <div className="min-w-0">
                <h3 className="truncate text-sm font-medium text-foreground">
                  {email}
                </h3>
                <p className="truncate text-[11px] text-muted-foreground">
                  {projectName}
                </p>
              </div>
            </div>
          </div>
          <Badge
            variant="outline"
            className={cn("shrink-0 gap-1.5 border px-2 py-1 text-[10px] font-medium", currentStatus.className)}
          >
            <span className={cn("h-1.5 w-1.5 rounded-full status-dot", currentStatus.dotClassName)} />
            {currentStatus.label}
          </Badge>
        </div>

        <p className="mt-3 text-[11px] text-muted-foreground/70 leading-relaxed">{description}</p>

        {/* Stats row */}
        <div className="mt-4 grid grid-cols-3 gap-2">
          <div className="rounded-md bg-primary/5 p-2.5 border border-primary/10">
            <div className="flex items-center gap-1.5 mb-1">
              <Server className="h-3 w-3 text-primary/50" />
            </div>
            <p className="text-lg font-semibold text-primary tabular-nums">{models}</p>
            <p className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground">Models</p>
          </div>
          <div className="rounded-md bg-destructive/5 p-2.5 border border-destructive/10">
            <div className="flex items-center gap-1.5 mb-1">
              <Shield className="h-3 w-3 text-destructive/50" />
            </div>
            <p className="text-lg font-semibold text-foreground tabular-nums">{blocked}</p>
            <p className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground">Blocked</p>
          </div>
          <div className="rounded-md bg-secondary/50 p-2.5 border border-border">
            <div className="flex items-center gap-1.5 mb-1">
              <Clock className="h-3 w-3 text-muted-foreground/50" />
            </div>
            <p className="text-sm font-semibold text-foreground">{updated}</p>
            <p className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground">Updated</p>
          </div>
        </div>

        {/* Model tags */}
        <div className="mt-3 flex flex-wrap gap-1">
          {modelTags.slice(0, isExpanded ? modelTags.length : 3).map((tag) => (
            <Badge
              key={tag}
              variant="secondary"
              className="border border-primary/15 bg-primary/5 px-2 py-0.5 text-[9px] font-medium text-primary/70"
            >
              {tag}
            </Badge>
          ))}
          {!isExpanded && modelTags.length > 3 && (
            <Badge
              variant="secondary"
              className="border border-border bg-secondary/50 px-2 py-0.5 text-[9px] font-medium text-muted-foreground"
            >
              +{modelTags.length - 3}
            </Badge>
          )}
        </div>

        {/* Expandable details */}
        <div className={cn(
          "grid transition-all duration-300",
          isExpanded ? "grid-rows-[1fr] opacity-100 mt-4" : "grid-rows-[0fr] opacity-0"
        )}>
          <div className="overflow-hidden">
            <div className="border-t border-border pt-4 space-y-4">
              {/* Model Quota Section */}
              {modelQuotas && modelQuotas.length > 0 && (
                <div className="rounded-md border border-border bg-secondary/20">
                  <div className="px-3 py-2 border-b border-border/50">
                    <h4 className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                      Model Quota
                    </h4>
                  </div>
                  <div className="divide-y divide-border/30">
                    {modelQuotas.map((quota, index) => (
                      <div key={index} className="px-3 py-3 hover:bg-secondary/30 transition-colors">
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="text-xs font-medium text-foreground truncate">
                              {quota.name}
                              {quota.tier && (
                                <span className="text-muted-foreground"> ({quota.tier})</span>
                              )}
                            </span>
                            {quota.warning && (
                              <AlertTriangle className="h-3 w-3 text-amber-500 shrink-0" />
                            )}
                          </div>
                          <span className="text-[10px] text-muted-foreground whitespace-nowrap shrink-0">
                            {quota.refreshTime}
                          </span>
                        </div>
                        {typeof quota.usage === "number" ? (
                          <div className="mt-2 flex gap-1.5">
                            {(() => {
                              const usage = quota.usage ?? 0
                              return Array.from({ length: 5 }).map((_, i) => (
                                <div
                                  key={i}
                                  className={cn(
                                    "h-1 flex-1 rounded-full",
                                    i < usage
                                      ? quota.warning
                                        ? "bg-amber-200/30"
                                        : "bg-foreground/80"
                                      : "bg-border/70"
                                  )}
                                />
                              ))
                            })()}
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Details grid */}
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: "Project", value: project || "Not set" },
                  { label: "Expires", value: expires || "N/A" },
                  { label: "Next Retry", value: nextRetry || "Ready now" },
                  { label: "Last Refresh", value: lastRefresh || "Not available" },
                  { label: "Routing Prefix", value: routingPrefix },
                  { label: "File", value: fileName || "N/A", small: true },
                ].map((item) => (
                  <div key={item.label} className="rounded-md bg-secondary/30 p-2.5 border border-border/50">
                    <p className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground">
                      {item.label}
                    </p>
                    <p className={cn("mt-0.5 text-foreground truncate", item.small ? "text-[10px]" : "text-xs")}>
                      {item.value}
                    </p>
                  </div>
                ))}
              </div>

              {/* Action buttons */}
              <div className="flex gap-2 pt-1">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={onRefresh}
                  disabled={isRefreshing}
                  className="gap-1.5 text-[11px] h-7 bg-secondary/50 hover:bg-primary/10 hover:text-primary border border-border"
                >
                  <RefreshCw className={cn("h-3 w-3", isRefreshing && "animate-spin")} />
                  Refresh
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={onDisable}
                  className="gap-1.5 text-[11px] h-7 bg-secondary/50 hover:bg-amber-500/10 hover:text-amber-500 border border-border"
                >
                  <Power className="h-3 w-3" />
                  {status === "disabled" ? "Enable" : "Disable"}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={onRemove}
                  className="gap-1.5 text-[11px] h-7 bg-destructive/5 text-destructive hover:bg-destructive/10 border border-destructive/20"
                >
                  <Trash2 className="h-3 w-3" />
                  Remove
                </Button>
              </div>
            </div>
          </div>
        </div>

        {/* Expand/collapse toggle */}
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="mt-3 flex w-full items-center justify-center gap-1 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground rounded-md hover:bg-secondary/30"
        >
          {isExpanded ? (
            <>
              <ChevronUp className="h-3.5 w-3.5" />
              Collapse
            </>
          ) : (
            <>
              <ChevronDown className="h-3.5 w-3.5" />
              Expand
            </>
          )}
        </button>
      </div>
    </div>
  )
}
