"use client"

import type { ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { RefreshCw } from "lucide-react"
import { cn } from "@/lib/utils"

interface SectionCardProps {
  title: string
  icon: ReactNode
  description: string
  connected: number
  ready: number
  cooling: number
  autoSwitch: "Ready" | "Idle" | "Active"
  connectButton: {
    label: string
    icon: ReactNode
    onClick?: () => void
  }
  onRefresh?: () => void
  isRefreshing?: boolean
  children?: ReactNode
  accentColor?: "cyan" | "purple" | "green"
}

export function SectionCard({
  title,
  icon,
  description,
  connected,
  ready,
  cooling,
  autoSwitch,
  connectButton,
  onRefresh,
  isRefreshing = false,
  children,
  accentColor = "cyan",
}: SectionCardProps) {
  const accentStyles = {
    cyan: {
      border: "border-primary/20",
      iconBg: "bg-primary/10 text-primary",
      badge: "text-primary",
      buttonBg: "bg-primary hover:bg-primary/90",
    },
    purple: {
      border: "border-purple-500/20",
      iconBg: "bg-purple-500/10 text-purple-400",
      badge: "text-purple-400",
      buttonBg: "bg-purple-500 hover:bg-purple-500/90",
    },
    green: {
      border: "border-emerald-500/20",
      iconBg: "bg-emerald-500/10 text-emerald-400",
      badge: "text-emerald-400",
      buttonBg: "bg-emerald-500 hover:bg-emerald-500/90",
    },
  }

  const styles = accentStyles[accentColor]

  const autoSwitchStyles = {
    Ready: { text: "text-emerald-500", bg: "bg-emerald-500/10", border: "border-emerald-500/20" },
    Active: { text: "text-primary", bg: "bg-primary/10", border: "border-primary/20" },
    Idle: { text: "text-muted-foreground", bg: "bg-secondary/50", border: "border-border" },
  }

  const currentAutoSwitch = autoSwitchStyles[autoSwitch]

  return (
    <div className={cn("relative rounded-lg border bg-card", styles.border)}>
      {/* Subtle top gradient */}
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/20 to-transparent" />

      <div className="p-6">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className={cn("flex h-10 w-10 items-center justify-center rounded-md", styles.iconBg)}>
              {icon}
            </div>
            <div>
              <p className={cn("text-[10px] font-medium uppercase tracking-[0.15em]", styles.badge)}>
                {title}
              </p>
              <h2 className="text-lg font-semibold tracking-tight text-foreground">{title}</h2>
            </div>
          </div>
        </div>

        <p className="mt-3 text-sm text-muted-foreground leading-relaxed max-w-xl">
          {description}
        </p>

        {/* Action buttons */}
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            onClick={connectButton.onClick}
            size="sm"
            className={cn("gap-2 text-xs font-medium text-white", styles.buttonBg)}
          >
            {connectButton.icon}
            {connectButton.label}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={onRefresh}
            disabled={isRefreshing}
            className="gap-2 text-xs border border-border bg-secondary/50 hover:bg-secondary"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", isRefreshing && "animate-spin")} />
            Refresh
          </Button>
        </div>

        {/* Stats grid */}
        <div className="mt-6 grid grid-cols-4 gap-2">
          {[
            { value: connected, label: "Connected", color: styles.badge },
            { value: ready, label: "Ready", color: "text-emerald-500" },
            { value: cooling, label: "Cooling", color: "text-amber-500" },
          ].map((stat) => (
            <div
              key={stat.label}
              className="rounded-md border border-border bg-secondary/20 p-3"
            >
              <p className={cn("text-2xl font-semibold tabular-nums", stat.color)}>
                {stat.value}
              </p>
              <p className="mt-0.5 text-[10px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
                {stat.label}
              </p>
            </div>
          ))}
          
          {/* Auto-switch status */}
          <div className={cn("rounded-md border p-3", currentAutoSwitch.bg, currentAutoSwitch.border)}>
            <div className="flex items-center gap-1.5">
              <span className={cn(
                "h-1.5 w-1.5 rounded-full status-dot",
                autoSwitch === "Ready" && "bg-emerald-500",
                autoSwitch === "Active" && "bg-primary",
                autoSwitch === "Idle" && "bg-muted-foreground"
              )} />
              <p className={cn("text-sm font-semibold", currentAutoSwitch.text)}>
                {autoSwitch}
              </p>
            </div>
            <p className="mt-1 text-[10px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
              Auto-switch
            </p>
          </div>
        </div>

        {/* Children - account cards */}
        {children && <div className="mt-6">{children}</div>}

        {/* Empty state */}
        {!children && (
          <div className="mt-6 rounded-md border border-dashed border-border bg-secondary/10 p-8 text-center">
            <div className={cn("mx-auto w-12 h-12 rounded-md flex items-center justify-center mb-3", styles.iconBg)}>
              {icon}
            </div>
            <p className="font-medium text-foreground">
              No {title.toLowerCase()} accounts connected
            </p>
            <p className="mt-1 text-sm text-muted-foreground max-w-sm mx-auto">
              {description}
            </p>
            <Button
              onClick={connectButton.onClick}
              size="sm"
              className={cn("mt-4 gap-2 text-xs font-medium text-white", styles.buttonBg)}
            >
              {connectButton.icon}
              {connectButton.label}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
