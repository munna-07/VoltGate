"use client"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { RefreshCw, Activity, Zap, Users, Clock, Shield } from "lucide-react"
import { cn } from "@/lib/utils"

interface DashboardHeaderProps {
  connectedAccounts: number
  readyPool: number
  coolingOrLimited: number
  failoverStatus: "Ready" | "Limited" | "Down"
  lastSynced?: string
  isRefreshing?: boolean
  onRefresh?: () => void
}

export function DashboardHeader({
  connectedAccounts,
  readyPool,
  coolingOrLimited,
  failoverStatus,
  lastSynced,
  isRefreshing = false,
  onRefresh,
}: DashboardHeaderProps) {
  const failoverStyles = {
    Ready: {
      className: "bg-emerald-500/10 text-emerald-500 border-emerald-500/30",
      dotClassName: "bg-emerald-500",
    },
    Limited: {
      className: "bg-amber-500/10 text-amber-500 border-amber-500/30",
      dotClassName: "bg-amber-500",
    },
    Down: {
      className: "bg-red-500/10 text-red-500 border-red-500/30",
      dotClassName: "bg-red-500",
    },
  }

  const currentFailover = failoverStyles[failoverStatus]

  return (
    <div className="relative overflow-hidden rounded-lg border border-border bg-card">
      {/* Subtle gradient */}
      <div className="absolute inset-0 bg-gradient-to-br from-primary/[0.02] via-transparent to-transparent" />

      <div className="relative p-6 md:p-8">
        {/* Title section */}
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary">
                <Activity className="h-5 w-5" />
              </div>
              <div>
                <p className="text-[10px] font-medium uppercase tracking-[0.15em] text-muted-foreground">
                  Voltgate
                </p>
                <h1 className="text-xl font-semibold tracking-tight text-foreground">
                  Voltgate Console
                </h1>
              </div>
            </div>
            <p className="mt-3 text-sm text-muted-foreground">
              Structured multi-account routing for Claude, Antigravity, and Codex
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant="outline"
              className={cn(
                "gap-2 border px-3 py-1.5 text-xs font-medium",
                currentFailover.className
              )}
            >
              <span className={cn("h-1.5 w-1.5 rounded-full status-dot", currentFailover.dotClassName)} />
              Failover: {failoverStatus}
            </Badge>
            <Button
              variant="secondary"
              size="sm"
              onClick={onRefresh}
              disabled={isRefreshing}
              className="gap-1.5 h-9 border border-border bg-secondary/50 hover:bg-secondary"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", isRefreshing && "animate-spin")} />
              Refresh
            </Button>
          </div>
        </div>

        <div className="mt-6 rounded-md border border-primary/15 bg-primary/5 p-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary">
              <Shield className="h-4 w-4" />
            </div>
            <div>
              <p className="text-xs font-medium text-foreground">Local management is unlocked on localhost.</p>
              <p className="mt-1 text-[11px] text-muted-foreground/70">
                No management password is required in Voltgate on localhost. Create a client API key below, then paste that key into the chat page to send requests.
              </p>
            </div>
          </div>
        </div>

        {/* Stats grid */}
        <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {/* Connected Accounts */}
          <div className="group rounded-md border border-border bg-secondary/20 p-4 transition-colors hover:bg-secondary/30">
            <div className="flex items-center gap-2 mb-2">
              <Users className="h-4 w-4 text-primary/60" />
              <span className="text-[10px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
                Connected
              </span>
            </div>
            <p className="text-2xl font-semibold text-primary tabular-nums">{connectedAccounts}</p>
            <p className="mt-1 text-[11px] text-muted-foreground/60">
              Total OAuth records
            </p>
          </div>

          {/* Ready Pool */}
          <div className="group rounded-md border border-emerald-500/20 bg-emerald-500/5 p-4 transition-colors hover:bg-emerald-500/10">
            <div className="flex items-center gap-2 mb-2">
              <Zap className="h-4 w-4 text-emerald-500/60" />
              <span className="text-[10px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
                Ready
              </span>
            </div>
            <p className="text-2xl font-semibold text-emerald-500 tabular-nums">{readyPool}</p>
            <p className="mt-1 text-[11px] text-muted-foreground/60">
              Available for routing
            </p>
          </div>

          {/* Cooling / Limited */}
          <div className="group rounded-md border border-amber-500/20 bg-amber-500/5 p-4 transition-colors hover:bg-amber-500/10">
            <div className="flex items-center gap-2 mb-2">
              <Clock className="h-4 w-4 text-amber-500/60" />
              <span className="text-[10px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
                Cooling
              </span>
            </div>
            <p className="text-2xl font-semibold text-amber-500 tabular-nums">{coolingOrLimited}</p>
            <p className="mt-1 text-[11px] text-muted-foreground/60">
              Quota cooldown
            </p>
          </div>

          {/* Failover Status */}
          <div className={cn(
            "group rounded-md border p-4 transition-colors",
            failoverStatus === "Ready" && "border-emerald-500/20 bg-emerald-500/5 hover:bg-emerald-500/10",
            failoverStatus === "Limited" && "border-amber-500/20 bg-amber-500/5 hover:bg-amber-500/10",
            failoverStatus === "Down" && "border-red-500/20 bg-red-500/5 hover:bg-red-500/10"
          )}>
            <div className="flex items-center gap-2 mb-2">
              <Shield className={cn(
                "h-4 w-4",
                failoverStatus === "Ready" && "text-emerald-500/60",
                failoverStatus === "Limited" && "text-amber-500/60",
                failoverStatus === "Down" && "text-red-500/60"
              )} />
              <span className="text-[10px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
                Failover
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className={cn(
                "h-2 w-2 rounded-full status-dot",
                failoverStatus === "Ready" && "bg-emerald-500",
                failoverStatus === "Limited" && "bg-amber-500",
                failoverStatus === "Down" && "bg-red-500"
              )} />
              <p className={cn(
                "text-lg font-semibold",
                failoverStatus === "Ready" && "text-emerald-500",
                failoverStatus === "Limited" && "text-amber-500",
                failoverStatus === "Down" && "text-red-500"
              )}>
                {failoverStatus}
              </p>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground/60">
              Routing status
            </p>
          </div>
        </div>

        {/* Sync status */}
        {lastSynced && (
          <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 status-dot" />
            <span>Synced {lastSynced}</span>
          </div>
        )}
      </div>
    </div>
  )
}
