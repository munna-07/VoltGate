"use client"

import Link from "next/link"
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { DashboardHeader } from "@/components/dashboard-header"
import { SectionCard } from "@/components/section-card"
import { AccountCard, ModelQuota } from "@/components/account-card"
import { CyberBackground, HexGrid } from "@/components/cyber-background"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Zap, MessageSquare, Code2, Globe, Copy, KeyRound, Plus, Trash2 } from "lucide-react"
import { cn } from "@/lib/utils"

type ProviderKey = "antigravity" | "claude" | "codex"
type AutoSwitchState = "Ready" | "Idle" | "Active"
type FailoverStatus = "Ready" | "Limited" | "Down"

interface ApiQuotaState {
  exceeded?: boolean
  reason?: string
  next_recover_at?: string
  backoff_level?: number
}

interface ApiModelState {
  status?: string
  status_message?: string
  unavailable?: boolean
  next_retry_after?: string
  quota?: ApiQuotaState
  updated_at?: string
}

interface ApiCodexIDToken {
  plan_type?: string
  chatgpt_account_id?: string
  chatgpt_subscription_active_until?: string
}

interface ApiAuthFile {
  id?: string
  name?: string
  provider?: string
  label?: string
  status?: string
  status_message?: string
  disabled?: boolean
  unavailable?: boolean
  runtime_only?: boolean
  email?: string
  account?: string
  account_type?: string
  project_id?: string
  expires_at?: string
  created_at?: string
  updated_at?: string
  modtime?: string
  last_refresh?: string
  next_retry_after?: string
  prefix?: string
  quota?: ApiQuotaState
  model_states?: Record<string, ApiModelState>
  models_count?: number
  models_preview?: string[]
  id_token?: ApiCodexIDToken
}

interface AuthFilesResponse {
  files?: ApiAuthFile[]
}

interface AuthModelsResponse {
  models?: Array<{
    id?: string
    display_name?: string
  }>
}

interface ApiKeysResponse {
  "api-keys"?: string[]
}

interface RuntimeStateResponse {
  ui_base?: string
  chat_ui_base?: string
  api_base?: string
  gemini_base?: string
  management_base?: string
  ui_tunnel_url?: string
  api_tunnel_url?: string
}

interface AuthStatusResponse {
  status?: "ok" | "wait" | "error"
  error?: string
}

interface AuthUrlResponse {
  status?: string
  url?: string
  state?: string
}

interface NormalizedModelState extends ApiModelState {
  model: string
}

interface ProviderConfig {
  key: ProviderKey
  title: string
  description: string
  connectLabel: string
  authPath: string
  accentColor: "cyan" | "purple" | "green"
}

type ApiRequestInit = Omit<RequestInit, "body"> & {
  body?: BodyInit | Record<string, unknown> | undefined
}

class ManagementApiError extends Error {
  status?: number
}

const MANAGEMENT_BASE_URL = (process.env.NEXT_PUBLIC_MANAGEMENT_BASE_URL ?? "").replace(/\/+$/, "")

const PROVIDERS: ProviderConfig[] = [
  {
    key: "antigravity",
    title: "Antigravity",
    description:
      "Add multiple Antigravity Google accounts and let the router move requests to another ready account when a model cooldown or quota block hits.",
    connectLabel: "Continue with Google",
    authPath: "/v0/management/antigravity-auth-url?is_webui=true",
    accentColor: "cyan",
  },
  {
    key: "claude",
    title: "Claude",
    description:
      "Keep separate Claude subscriptions available in one clean pool and monitor which accounts are ready or cooling down.",
    connectLabel: "Connect Claude",
    authPath: "/v0/management/anthropic-auth-url?is_webui=true",
    accentColor: "purple",
  },
  {
    key: "codex",
    title: "Codex",
    description:
      "Track connected Codex accounts, plan metadata, expiry, and route onto another ready account when needed.",
    connectLabel: "Continue with ChatGPT",
    authPath: "/v0/management/codex-auth-url?is_webui=true",
    accentColor: "green",
  },
]

const PROVIDER_BY_KEY: Record<ProviderKey, ProviderConfig> = {
  antigravity: PROVIDERS[0],
  claude: PROVIDERS[1],
  codex: PROVIDERS[2],
}

function GoogleIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24">
      <path
        fill="currentColor"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="currentColor"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="currentColor"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="currentColor"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  )
}

function ChatGPTIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor">
      <path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z" />
    </svg>
  )
}

function normalizeProvider(provider?: string): ProviderKey | null {
  const value = provider?.trim().toLowerCase()
  if (value === "antigravity" || value === "claude" || value === "codex") {
    return value
  }
  return null
}

function resolveManagementUrl(path: string) {
  if (!MANAGEMENT_BASE_URL) {
    return `/api/local${path}`
  }
  return `${MANAGEMENT_BASE_URL}${path}`
}

function getAuthName(auth: ApiAuthFile) {
  return auth.name?.trim() || auth.id?.trim() || ""
}

function uniqueStrings(values: Array<string | undefined>) {
  const seen = new Set<string>()
  const normalized: string[] = []
  for (const value of values) {
    const trimmed = value?.trim()
    if (!trimmed || seen.has(trimmed)) {
      continue
    }
    seen.add(trimmed)
    normalized.push(trimmed)
  }
  return normalized
}

function parseDateValue(value?: string) {
  if (!value) {
    return null
  }
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function isFutureDate(value?: string) {
  const parsed = parseDateValue(value)
  return Boolean(parsed && parsed.getTime() > Date.now())
}

function formatAbsoluteDate(value?: string) {
  const parsed = parseDateValue(value)
  if (!parsed) {
    return "Not available"
  }
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed)
}

function formatShortRelative(value?: string) {
  const parsed = parseDateValue(value)
  if (!parsed) {
    return "Not available"
  }
  const diffMs = Date.now() - parsed.getTime()
  const diffSeconds = Math.max(0, Math.floor(diffMs / 1000))
  if (diffSeconds < 60) {
    return `${diffSeconds}s ago`
  }
  const diffMinutes = Math.floor(diffSeconds / 60)
  if (diffMinutes < 60) {
    return `${diffMinutes}m ago`
  }
  const diffHours = Math.floor(diffMinutes / 60)
  if (diffHours < 24) {
    return `${diffHours}h ago`
  }
  const diffDays = Math.floor(diffHours / 24)
  if (diffDays < 30) {
    return `${diffDays}d ago`
  }
  return formatAbsoluteDate(value)
}

function formatCountdown(value?: string) {
  const parsed = parseDateValue(value)
  if (!parsed) {
    return "Ready now"
  }
  const diffMs = parsed.getTime() - Date.now()
  if (diffMs <= 0) {
    return "Ready now"
  }
  const diffSeconds = Math.ceil(diffMs / 1000)
  if (diffSeconds < 60) {
    return `${diffSeconds}s`
  }
  const totalMinutes = Math.ceil(diffSeconds / 60)
  if (totalMinutes < 60) {
    return `${totalMinutes}m`
  }
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours < 24) {
    return minutes ? `${hours}h ${minutes}m` : `${hours}h`
  }
  const days = Math.floor(hours / 24)
  const remainingHours = hours % 24
  return remainingHours ? `${days}d ${remainingHours}h` : `${days}d`
}

function formatRetryLabel(value?: string) {
  return isFutureDate(value) ? `Retry in ${formatCountdown(value)}` : "Ready now"
}

function isVerificationRequiredMessage(value?: string) {
  const normalized = value?.trim().toLowerCase() ?? ""
  return normalized.includes("verify your account to continue") || normalized.includes("validation_required")
}

function isStreamValidationMessage(value?: string) {
  const normalized = value?.trim().toLowerCase() ?? ""
  return normalized.includes("stream options can only be set if stream is true")
}

function formatReason(value?: string) {
  const normalized = value?.trim()
  if (!normalized) {
    return "Cooling down"
  }

  if (isVerificationRequiredMessage(normalized)) {
    return "Verify your account to continue."
  }

  if (isStreamValidationMessage(normalized)) {
    return "The upstream rejected the last request because stream options were sent while stream was off."
  }

  const patterns = [
    /"message"\s*:\s*"([^"]+)"/i,
    /'message'\s*:\s*'([^']+)'/i,
    /'msg'\s*:\s*'([^']+)'/i,
    /ValueError\('([^']+)'\)/i,
  ]
  for (const pattern of patterns) {
    const match = normalized.match(pattern)
    const extracted = match?.[1]?.trim()
    if (!extracted) {
      continue
    }
    if (isVerificationRequiredMessage(extracted)) {
      return "Verify your account to continue."
    }
    if (isStreamValidationMessage(extracted)) {
      return "The upstream rejected the last request because stream options were sent while stream was off."
    }
    return extracted.replace(/_/g, " ")
  }

  const flattened = normalized.replace(/_/g, " ")
  if (flattened.length > 180) {
    return `${flattened.slice(0, 177)}...`
  }
  return flattened
}

function buildStatusTier(value: string | undefined, quotaExceeded: boolean | undefined) {
  if (isVerificationRequiredMessage(value)) {
    return "verification"
  }
  if (isStreamValidationMessage(value)) {
    return "request shape"
  }
  if (quotaExceeded) {
    return "quota block"
  }
  return "cooldown"
}

function getModelStates(auth: ApiAuthFile): NormalizedModelState[] {
  const entries = Object.entries(auth.model_states ?? {})
  return entries
    .map(([model, state]) => ({
      model,
      ...(state ?? {}),
      quota: state?.quota ?? {},
    }))
    .sort((left, right) => left.model.localeCompare(right.model))
}

function isBlockedModelState(state: NormalizedModelState) {
  return Boolean(
    state.unavailable ||
      state.quota?.exceeded ||
      isFutureDate(state.next_retry_after) ||
      isFutureDate(state.quota?.next_recover_at)
  )
}

function getBlockedModelStates(auth: ApiAuthFile) {
  return getModelStates(auth).filter(isBlockedModelState)
}

function hasFullAuthCooldown(auth: ApiAuthFile) {
  return Boolean(
    !auth.disabled &&
      (auth.unavailable ||
        auth.quota?.exceeded ||
        isFutureDate(auth.next_retry_after) ||
        isFutureDate(auth.quota?.next_recover_at))
  )
}

function hasAnyLimitState(auth: ApiAuthFile) {
  return hasFullAuthCooldown(auth) || getBlockedModelStates(auth).length > 0
}

function isReadyForRouting(auth: ApiAuthFile) {
  return !auth.disabled && !hasFullAuthCooldown(auth)
}

function getAccountStatus(auth: ApiAuthFile): "ready" | "cooling" | "limited" | "disabled" {
  if (auth.disabled) {
    return "disabled"
  }
  if (hasFullAuthCooldown(auth)) {
    return auth.quota?.exceeded ? "limited" : "cooling"
  }
  return "ready"
}

function getEarliestRetryAt(auth: ApiAuthFile) {
  const candidates = uniqueStrings([
    auth.next_retry_after,
    auth.quota?.next_recover_at,
    ...getBlockedModelStates(auth).flatMap((state) => [state.next_retry_after, state.quota?.next_recover_at]),
  ])

  let earliest: Date | null = null
  for (const candidate of candidates) {
    const parsed = parseDateValue(candidate)
    if (!parsed || parsed.getTime() <= Date.now()) {
      continue
    }
    if (!earliest || parsed.getTime() < earliest.getTime()) {
      earliest = parsed
    }
  }

  return earliest?.toISOString()
}

function getDisplayName(auth: ApiAuthFile, providerKey: ProviderKey) {
  return (
    auth.email?.trim() ||
    auth.account?.trim() ||
    auth.label?.trim() ||
    getAuthName(auth) ||
    `${PROVIDER_BY_KEY[providerKey].title} account`
  )
}

function getSubtitle(auth: ApiAuthFile, providerKey: ProviderKey) {
  if (auth.project_id?.trim()) {
    return auth.project_id.trim()
  }
  if (providerKey === "codex") {
    if (auth.id_token?.plan_type?.trim()) {
      return auth.id_token.plan_type.trim()
    }
    if (auth.id_token?.chatgpt_account_id?.trim()) {
      return auth.id_token.chatgpt_account_id.trim()
    }
  }
  if (auth.account?.trim() && auth.account !== auth.email) {
    return auth.account.trim()
  }
  if (auth.label?.trim() && auth.label !== auth.email) {
    return auth.label.trim()
  }
  return `OAuth account connected through ${PROVIDER_BY_KEY[providerKey].title}.`
}

function getProjectValue(auth: ApiAuthFile) {
  return (
    auth.project_id?.trim() ||
    auth.id_token?.plan_type?.trim() ||
    auth.id_token?.chatgpt_account_id?.trim() ||
    "Not set"
  )
}

function getExpiresValue(auth: ApiAuthFile) {
  return auth.expires_at || auth.id_token?.chatgpt_subscription_active_until
}

function buildDescription(auth: ApiAuthFile) {
  if (auth.disabled) {
    return "Disabled in the runtime auth pool."
  }
  if (auth.quota?.exceeded) {
    return "This account is cooling down after a live quota or rate-limit block. The router can shift requests to another ready account."
  }
  const blockedStates = getBlockedModelStates(auth)
  if (blockedStates.some((state) => isVerificationRequiredMessage(state.status_message))) {
    return "Some models on this account require Google verification, but other models are still available."
  }
  if (blockedStates.length > 0) {
    return "Some models are temporarily cooling down, but this account can still serve other ready models."
  }
  const message = auth.status_message?.trim()
  if (message && message.toLowerCase() !== "ready") {
    return formatReason(message)
  }
  return "Managed through the runtime auth pool."
}

function formatModelQuotaName(model: string) {
  const labels: Record<string, string> = {
    "claude-opus-4-6-thinking": "Claude Opus 4.6 (Thinking)",
    "claude-sonnet-4-6": "Claude Sonnet 4.6",
    "gemini-2.5-flash": "Gemini 2.5 Flash",
    "gemini-2.5-flash-lite": "Gemini 2.5 Flash Lite",
    "gemini-3-flash": "Gemini 3 Flash",
    "gemini-3-pro-high": "Gemini 3 Pro (High)",
    "gemini-3-pro-low": "Gemini 3 Pro (Low)",
    "gemini-3.1-flash-image": "Gemini 3.1 Flash Image",
    "gemini-3.1-pro-high": "Gemini 3.1 Pro (High)",
    "gemini-3.1-pro-low": "Gemini 3.1 Pro (Low)",
    "gpt-oss-120b-medium": "GPT-OSS 120B (Medium)",
  }
  return labels[model] ?? model
}

function buildQuotaRefreshLabel(auth: ApiAuthFile, state?: ApiModelState, blocked?: boolean) {
  if (auth.disabled) {
    return "Disabled"
  }
  if (!blocked) {
    return "Ready now"
  }
  if (isFutureDate(state?.next_retry_after)) {
    return `Refreshes in ${formatCountdown(state?.next_retry_after)}`
  }
  if (isFutureDate(state?.quota?.next_recover_at)) {
    return `Refreshes in ${formatCountdown(state?.quota?.next_recover_at)}`
  }
  if (isFutureDate(auth.next_retry_after)) {
    return `Refreshes in ${formatCountdown(auth.next_retry_after)}`
  }
  if (isFutureDate(auth.quota?.next_recover_at)) {
    return `Refreshes in ${formatCountdown(auth.quota?.next_recover_at)}`
  }

  const reason = formatReason(state?.quota?.reason || state?.status_message || auth.quota?.reason || auth.status_message)
  if (reason === "Verify your account to continue.") {
    return "Verification required"
  }
  return reason
}

function buildModelQuotaRows(auth: ApiAuthFile, models: string[]): ModelQuota[] {
  const trackedModels = uniqueStrings([...models, ...Object.keys(auth.model_states ?? {})])
  if (trackedModels.length === 0) {
    if (!hasFullAuthCooldown(auth)) {
      return []
    }
    return [
      {
        name: "Account pool",
        usage: 0,
        refreshTime: buildQuotaRefreshLabel(auth, undefined, true),
        warning: !auth.disabled,
      },
    ]
  }

  const authCooling = hasFullAuthCooldown(auth)
  return trackedModels.map((model) => {
    const state = auth.model_states?.[model]
    const normalizedState = state ? ({ model, ...(state ?? {}) } as NormalizedModelState) : undefined
    const blocked = auth.disabled || authCooling || (normalizedState ? isBlockedModelState(normalizedState) : false)
    const warning = blocked || isVerificationRequiredMessage(state?.status_message || state?.quota?.reason)

    return {
      name: formatModelQuotaName(model),
      usage: blocked ? 0 : 5,
      refreshTime: buildQuotaRefreshLabel(auth, state, blocked),
      warning,
    }
  })
}

function getAccountModels(auth: ApiAuthFile, modelCatalog: Record<string, string[]>) {
  const authName = getAuthName(auth)
  const knownModels = modelCatalog[authName]
  if (knownModels && knownModels.length > 0) {
    return knownModels
  }
  return uniqueStrings(auth.models_preview ?? [])
}

function sortAccounts(left: ApiAuthFile, right: ApiAuthFile) {
  const rank = (auth: ApiAuthFile) => {
    if (auth.disabled) {
      return 3
    }
    if (hasFullAuthCooldown(auth)) {
      return 2
    }
    if (getBlockedModelStates(auth).length > 0) {
      return 1
    }
    return 0
  }

  const rankDiff = rank(left) - rank(right)
  if (rankDiff !== 0) {
    return rankDiff
  }

  const leftUpdated = parseDateValue(left.updated_at || left.modtime || left.created_at)?.getTime() ?? 0
  const rightUpdated = parseDateValue(right.updated_at || right.modtime || right.created_at)?.getTime() ?? 0
  if (leftUpdated !== rightUpdated) {
    return rightUpdated - leftUpdated
  }

  return getDisplayName(left, normalizeProvider(left.provider) ?? "antigravity").localeCompare(
    getDisplayName(right, normalizeProvider(right.provider) ?? "antigravity")
  )
}

function buildPopupFeatures() {
  const width = 820
  const height = 760
  const left = window.screenX + Math.max(0, Math.floor((window.outerWidth - width) / 2))
  const top = window.screenY + Math.max(0, Math.floor((window.outerHeight - height) / 2))
  return `popup=yes,width=${width},height=${height},left=${left},top=${top}`
}

function getProviderConnectIcon(providerKey: ProviderKey) {
  if (providerKey === "antigravity") {
    return <GoogleIcon />
  }
  if (providerKey === "codex") {
    return <ChatGPTIcon />
  }
  return <MessageSquare className="h-3.5 w-3.5" />
}

function generateClientAPIKey() {
  const buffer = new Uint8Array(18)
  window.crypto.getRandomValues(buffer)
  const token = Array.from(buffer, (value) => value.toString(16).padStart(2, "0")).join("")
  return `voltgate_local_${token}`
}

export default function AccountCenterPage() {
  const [activeTab, setActiveTab] = useState("all")
  const [authFiles, setAuthFiles] = useState<ApiAuthFile[]>([])
  const [apiKeys, setApiKeys] = useState<string[]>([])
  const [modelCatalog, setModelCatalog] = useState<Record<string, string[]>>({})
  const [lastSyncedAt, setLastSyncedAt] = useState("")
  const [runtimeState, setRuntimeState] = useState<RuntimeStateResponse>({})
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [busyProviders, setBusyProviders] = useState<Partial<Record<ProviderKey, boolean>>>({})

  const didInitializeRef = useRef(false)
  const refreshInFlightRef = useRef(false)

  const apiFetch = async <T,>(path: string, init?: ApiRequestInit): Promise<T> => {
    const headers = new Headers(init?.headers)
    const method = (init?.method ?? "GET").toUpperCase()
    const resolvedUrl = resolveManagementUrl(path)
    const url = /^https?:\/\//i.test(resolvedUrl)
      ? new URL(resolvedUrl)
      : new URL(resolvedUrl, window.location.origin)

    let body = init?.body
    if (body && typeof body === "object" && !(body instanceof FormData) && !(body instanceof URLSearchParams) && !(body instanceof Blob)) {
      headers.set("Content-Type", "application/json")
      body = JSON.stringify(body)
    }

    if (method === "GET" || method === "HEAD") {
      url.searchParams.set("_ts", Date.now().toString())
      headers.set("Cache-Control", "no-store")
      headers.set("Pragma", "no-cache")
    }

    const response = await fetch(url.toString(), {
      ...init,
      cache: "no-store",
      headers,
      body: body as BodyInit | undefined,
    })

    const contentType = response.headers.get("content-type") ?? ""
    const payload = contentType.includes("application/json")
      ? await response.json()
      : { error: (await response.text()) || `Request failed with status ${response.status}` }

    if (!response.ok) {
      const error = new ManagementApiError(
        (payload as { error?: string }).error || `Request failed with status ${response.status}`
      )
      error.status = response.status
      throw error
    }

    return payload as T
  }

  const fetchModelsForAuth = async (auth: ApiAuthFile) => {
    const authName = getAuthName(auth)
    if (!authName) {
      return getAccountModels(auth, {})
    }

    try {
      const response = await apiFetch<AuthModelsResponse>(`/v0/management/auth-files/models?name=${encodeURIComponent(authName)}`)
      const models = uniqueStrings((response.models ?? []).map((model) => model.id || model.display_name))
      if (models.length > 0) {
        return models.sort((left, right) => left.localeCompare(right))
      }
    } catch {
      // Fall back to preview models below.
    }

    return getAccountModels(auth, {})
  }

  const clearLoadedData = () => {
    setAuthFiles([])
    setApiKeys([])
    setModelCatalog({})
    setLastSyncedAt("")
  }

  const loadRuntimeState = async () => {
    try {
      const response = await fetch(`/api/runtime?_ts=${Date.now()}`, {
        cache: "no-store",
      })
      if (!response.ok) {
        throw new Error("Failed to load runtime state.")
      }
      const payload = (await response.json()) as RuntimeStateResponse
      setRuntimeState(payload)
    } catch {
      setRuntimeState({})
    }
  }

  const loadDashboard = async (options?: { silent?: boolean }) => {
    if (refreshInFlightRef.current) {
      return false
    }

    refreshInFlightRef.current = true
    setIsRefreshing(true)

    try {
      const [authFilesResponse, apiKeysResponse] = await Promise.all([
        apiFetch<AuthFilesResponse>("/v0/management/auth-files"),
        apiFetch<ApiKeysResponse>("/v0/management/api-keys").catch(() => ({ "api-keys": [] })),
      ])

      const files = (authFilesResponse.files ?? [])
        .filter((auth) => normalizeProvider(auth.provider) !== null)
        .sort(sortAccounts)

      const modelEntries = await Promise.all(
        files.map(async (auth) => {
          const authName = getAuthName(auth)
          if (!authName) {
            return null
          }
          const models = await fetchModelsForAuth(auth)
          return [authName, models] as const
        })
      )

      const nextModelCatalog: Record<string, string[]> = {}
      for (const entry of modelEntries) {
        if (!entry) {
          continue
        }
        nextModelCatalog[entry[0]] = entry[1]
      }

      setAuthFiles(files)
      setApiKeys(uniqueStrings(apiKeysResponse["api-keys"] ?? []))
      setModelCatalog(nextModelCatalog)
      setLastSyncedAt(new Date().toISOString())
      await loadRuntimeState()
      return true
    } catch (error) {
      const apiError = error as ManagementApiError
      if (apiError.status === 401 || apiError.status === 404) {
        clearLoadedData()
      }
      if (!options?.silent) {
        toast.error(apiError.message || "Failed to load account data.")
      }
      return false
    } finally {
      refreshInFlightRef.current = false
      setIsRefreshing(false)
    }
  }

  const withBusyProvider = async (providerKey: ProviderKey, run: () => Promise<void>) => {
    if (busyProviders[providerKey]) {
      return
    }

    setBusyProviders((current) => ({ ...current, [providerKey]: true }))
    try {
      await run()
    } finally {
      setBusyProviders((current) => ({ ...current, [providerKey]: false }))
    }
  }

  const handleRefresh = async (silent?: boolean) => {
    const loaded = await loadDashboard({ silent })
    if (loaded && !silent) {
      toast.success("Account data refreshed.")
    }
  }

  const pollOAuthStatus = async (stateId: string) => {
    const deadline = Date.now() + 5 * 60 * 1000
    while (Date.now() < deadline) {
      const response = await apiFetch<AuthStatusResponse>(
        `/v0/management/get-auth-status?state=${encodeURIComponent(stateId)}`
      )
      if (response.status === "wait") {
        await new Promise((resolve) => window.setTimeout(resolve, 1500))
        continue
      }
      if (response.status === "ok") {
        return
      }
      throw new Error(response.error || "Authentication failed.")
    }

    throw new Error("Authentication timed out.")
  }

  const waitForProviderSync = async (providerKey: ProviderKey, existingNames: Set<string>) => {
    for (let attempt = 0; attempt < 14; attempt += 1) {
      const response = await apiFetch<AuthFilesResponse>("/v0/management/auth-files")
      const latestNames = new Set(
        (response.files ?? [])
          .filter((auth) => normalizeProvider(auth.provider) === providerKey)
          .map((auth) => getAuthName(auth))
      )
      for (const authName of latestNames) {
        if (!existingNames.has(authName)) {
          return
        }
      }
      await new Promise((resolve) => window.setTimeout(resolve, 1000))
    }
  }

  const handleConnect = async (providerKey: ProviderKey) => {
    const provider = PROVIDER_BY_KEY[providerKey]

    await withBusyProvider(providerKey, async () => {
      const existingNames = new Set(
        authFiles
          .filter((auth) => normalizeProvider(auth.provider) === providerKey)
          .map((auth) => getAuthName(auth))
      )

      const popup = window.open("", `voltgate-${providerKey}-oauth`, buildPopupFeatures())
      if (!popup) {
        toast.error("Allow popups for this page, then try again.")
        return
      }

      try {
        const response = await apiFetch<AuthUrlResponse>(provider.authPath)
        if (!response.url || !response.state) {
          throw new Error("OAuth endpoint returned an incomplete response.")
        }

        popup.location.href = response.url
        toast.message(`${provider.title} sign-in opened.`)

        await pollOAuthStatus(response.state)
        await loadDashboard({ silent: true })
        await waitForProviderSync(providerKey, existingNames)
        await loadDashboard({ silent: true })
        popup.close()
        toast.success(`${provider.title} account connected.`)
      } catch (error) {
        popup.close()
        toast.error(error instanceof Error ? error.message : `Failed to connect ${provider.title}.`)
      }
    })
  }

  const handleGenerateAPIKey = async () => {
    try {
      const nextKey = generateClientAPIKey()
      const nextKeys = uniqueStrings([...apiKeys, nextKey])
      await apiFetch("/v0/management/api-keys", {
        method: "PUT",
        body: { items: nextKeys },
      })
      setApiKeys(nextKeys)
      toast.success("Client API key created.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create client API key.")
    }
  }

  const handleCopyAPIKey = async (key: string) => {
    try {
      await navigator.clipboard.writeText(key)
      toast.success("Client API key copied.")
    } catch {
      toast.error("Failed to copy the client API key.")
    }
  }

  const handleRemoveAPIKey = async (key: string) => {
    try {
      await apiFetch(`/v0/management/api-keys?value=${encodeURIComponent(key)}`, {
        method: "DELETE",
      })
      setApiKeys((current) => current.filter((item) => item !== key))
      toast.success("Client API key removed.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to remove client API key.")
    }
  }

  const handleToggleDisabled = async (auth: ApiAuthFile) => {
    const authName = getAuthName(auth)
    if (!authName) {
      toast.error("This auth record is missing a name.")
      return
    }

    try {
      await apiFetch("/v0/management/auth-files/status", {
        method: "PATCH",
        body: {
          name: authName,
          disabled: !auth.disabled,
        },
      })
      await loadDashboard({ silent: true })
      toast.success(auth.disabled ? `Enabled ${authName}.` : `Disabled ${authName}.`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update account status.")
    }
  }

  const handleRemove = async (auth: ApiAuthFile) => {
    const authName = getAuthName(auth)
    if (!authName) {
      toast.error("This auth record is missing a name.")
      return
    }

    if (!window.confirm(`Remove ${authName} from this runtime?`)) {
      return
    }

    try {
      await apiFetch(`/v0/management/auth-files?name=${encodeURIComponent(authName)}`, {
        method: "DELETE",
      })
      await loadDashboard({ silent: true })
      toast.success(`${authName} removed.`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to remove account.")
    }
  }

  useEffect(() => {
    if (didInitializeRef.current) {
      return
    }
    didInitializeRef.current = true

    void loadDashboard({ silent: true })
  }, [])

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      if (document.hidden) {
        return
      }
      void loadDashboard({ silent: true })
    }, 20000)

    return () => window.clearInterval(intervalId)
  }, [])

  const accountsByProvider = PROVIDERS.reduce<Record<ProviderKey, ApiAuthFile[]>>(
    (groups, provider) => {
      groups[provider.key] = authFiles
        .filter((auth) => normalizeProvider(auth.provider) === provider.key)
        .sort(sortAccounts)
      return groups
    },
    {
      antigravity: [],
      claude: [],
      codex: [],
    }
  )

  const providerCounts = PROVIDERS.reduce<
    Record<
      ProviderKey,
      {
        connected: number
        ready: number
        cooling: number
      }
    >
  >(
    (counts, provider) => {
      const accounts = accountsByProvider[provider.key]
      counts[provider.key] = {
        connected: accounts.length,
        ready: accounts.filter(isReadyForRouting).length,
        cooling: accounts.filter(hasAnyLimitState).length,
      }
      return counts
    },
    {
      antigravity: { connected: 0, ready: 0, cooling: 0 },
      claude: { connected: 0, ready: 0, cooling: 0 },
      codex: { connected: 0, ready: 0, cooling: 0 },
    }
  )

  const connectedAccounts = authFiles.length
  const readyPool = authFiles.filter(isReadyForRouting).length
  const coolingOrLimited = authFiles.filter(hasAnyLimitState).length

  const antigravityReady = providerCounts.antigravity.ready
  const antigravityConnected = providerCounts.antigravity.connected

  const failoverStatus: FailoverStatus =
    antigravityReady >= 2 ? "Ready" : antigravityConnected > 0 ? "Limited" : "Down"

  const lastSyncedLabel = lastSyncedAt ? formatAbsoluteDate(lastSyncedAt) : undefined
  const publicUiBase = runtimeState.ui_tunnel_url?.trim() || ""
  const publicApiRoot = runtimeState.api_tunnel_url?.trim() || ""
  const runtimeLinks = [
    { label: "Local UI", value: runtimeState.ui_base?.trim() || "" },
    { label: "Local Chat", value: runtimeState.chat_ui_base?.trim() || "" },
    { label: "Local API", value: runtimeState.api_base?.trim() || "" },
    { label: "Remote Chat", value: publicUiBase ? `${publicUiBase.replace(/\/+$/, "")}/chat` : "" },
    { label: "Remote API", value: publicApiRoot ? `${publicApiRoot.replace(/\/+$/, "")}/v1` : "" },
    { label: "Remote Gemini", value: publicApiRoot ? `${publicApiRoot.replace(/\/+$/, "")}/v1beta` : "" },
  ]

  const getAutoSwitchState = (providerKey: ProviderKey): AutoSwitchState => {
    const stats = providerCounts[providerKey]
    if (providerKey === "antigravity") {
      if (stats.ready >= 2) {
        return "Ready"
      }
      if (stats.connected > 0) {
        return "Active"
      }
      return "Idle"
    }

    if (stats.connected > 0) {
      return "Active"
    }
    return "Idle"
  }

  const renderProviderSection = (provider: ProviderConfig) => {
    const accounts = accountsByProvider[provider.key]
    const stats = providerCounts[provider.key]

    return (
      <SectionCard
        title={provider.title}
        icon={
          provider.key === "antigravity" ? (
            <Zap className="h-5 w-5" />
          ) : provider.key === "claude" ? (
            <MessageSquare className="h-5 w-5" />
          ) : (
            <Code2 className="h-5 w-5" />
          )
        }
        description={provider.description}
        connected={stats.connected}
        ready={stats.ready}
        cooling={stats.cooling}
        autoSwitch={getAutoSwitchState(provider.key)}
        connectButton={{
          label: provider.connectLabel,
          icon: getProviderConnectIcon(provider.key),
          onClick: () => void handleConnect(provider.key),
        }}
        onRefresh={() => void handleRefresh()}
        isRefreshing={isRefreshing}
        accentColor={provider.accentColor}
      >
        {accounts.length > 0 ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {accounts.map((auth) => {
              const providerKey = normalizeProvider(auth.provider) ?? provider.key
              const models = getAccountModels(auth, modelCatalog)
              const nextRetryAt = getEarliestRetryAt(auth)
              const modelQuotaRows = buildModelQuotaRows(auth, models)
              const blockedModelCount = modelQuotaRows.filter((row) => (row.usage ?? 0) <= 0).length

              return (
                <AccountCard
                  key={getAuthName(auth)}
                  email={getDisplayName(auth, providerKey)}
                  projectName={getSubtitle(auth, providerKey)}
                  description={buildDescription(auth)}
                  status={getAccountStatus(auth)}
                  models={Math.max(Number(auth.models_count || 0), models.length)}
                  blocked={blockedModelCount}
                  updated={formatShortRelative(auth.updated_at || auth.modtime || auth.created_at)}
                  modelTags={models}
                  modelQuotas={modelQuotaRows}
                  project={getProjectValue(auth)}
                  expires={formatAbsoluteDate(getExpiresValue(auth))}
                  nextRetry={formatRetryLabel(nextRetryAt)}
                  lastRefresh={formatAbsoluteDate(auth.last_refresh)}
                  routingPrefix={auth.prefix?.trim() || "Default"}
                  fileName={getAuthName(auth)}
                  isRefreshing={isRefreshing}
                  onRefresh={() => void handleRefresh()}
                  onDisable={() => void handleToggleDisabled(auth)}
                  onRemove={() => void handleRemove(auth)}
                />
              )
            })}
          </div>
        ) : undefined}
      </SectionCard>
    )
  }

  return (
    <div className="mesh-gradient min-h-screen relative">
      <CyberBackground />
      <HexGrid />

      <div className="relative z-10 mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
        <DashboardHeader
          connectedAccounts={connectedAccounts}
          readyPool={readyPool}
          coolingOrLimited={coolingOrLimited}
          failoverStatus={failoverStatus}
          lastSynced={lastSyncedLabel}
          isRefreshing={isRefreshing}
          onRefresh={() => void handleRefresh()}
        />

        <section className="mt-6 rounded-lg border border-border bg-card/90 p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <KeyRound className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">Client Access</p>
                  <h2 className="text-lg font-semibold tracking-tight text-foreground">API Keys</h2>
                </div>
              </div>
              <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
                Create a Voltgate client API key here, then paste it into the chat page. Voltgate Chat will only send requests after a valid key is entered.
              </p>
            </div>
            <Button onClick={() => void handleGenerateAPIKey()} className="gap-2">
              <Plus className="h-4 w-4" />
              Create API Key
            </Button>
          </div>

          <div className="mt-5 space-y-3">
            {apiKeys.length > 0 ? (
              apiKeys.map((key) => (
                <div
                  key={key}
                  className="flex flex-col gap-3 rounded-md border border-border bg-secondary/20 p-4 md:flex-row md:items-center md:justify-between"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">Voltgate API Key</p>
                    <p className="mt-1 truncate font-mono text-sm text-foreground">{key}</p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      className="gap-1.5 border border-border bg-secondary/50"
                      onClick={() => void handleCopyAPIKey(key)}
                    >
                      <Copy className="h-3.5 w-3.5" />
                      Copy
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      className="gap-1.5 border border-destructive/20 bg-destructive/5 text-destructive hover:bg-destructive/10"
                      onClick={() => void handleRemoveAPIKey(key)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Remove
                    </Button>
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-md border border-dashed border-border bg-secondary/10 p-6 text-center">
                <p className="font-medium text-foreground">No Voltgate API keys created yet.</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Create one here, then open the chat page and paste it into the API key field.
                </p>
              </div>
            )}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="border-primary/20 bg-primary/10 text-primary">
              Localhost only
            </Badge>
            <Link
              href="/chat"
              className="text-xs font-medium text-primary/80 transition-colors hover:text-primary"
            >
              Open Voltgate Chat
            </Link>
          </div>

          <div className="mt-4 rounded-md border border-border bg-secondary/15 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">Runtime Access</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Local Voltgate UI stays on `127.0.0.1`. If Cloudflare quick tunnels are active, remote chat and API links appear here, while account management should still be done locally.
                </p>
              </div>
              <Button variant="secondary" size="sm" className="border border-border bg-secondary/40" onClick={() => void loadRuntimeState()}>
                <Globe className="h-3.5 w-3.5" />
                Refresh Links
              </Button>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {runtimeLinks.map((item) => (
                <div key={item.label} className="rounded-md border border-border bg-card/70 p-3">
                  <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">{item.label}</p>
                  {item.value ? (
                    <a
                      href={item.value}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 block break-all text-sm font-medium text-primary transition-colors hover:text-primary/80"
                    >
                      {item.value}
                    </a>
                  ) : (
                    <p className="mt-2 text-sm text-muted-foreground">Not active</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-6">
          <TabsList className="h-auto w-full justify-start gap-1 rounded-md border border-border bg-card/50 p-1">
            <TabsTrigger
              value="all"
              className={cn(
                "gap-2 rounded-sm px-3 py-2 text-xs font-medium transition-all",
                "data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
              )}
            >
              <Globe className="h-3.5 w-3.5" />
              All
              <span className="ml-1 text-[10px] opacity-70">{connectedAccounts}</span>
            </TabsTrigger>
            <TabsTrigger
              value="antigravity"
              className={cn(
                "gap-2 rounded-sm px-3 py-2 text-xs font-medium transition-all",
                "data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
              )}
            >
              <Zap className="h-3.5 w-3.5" />
              Antigravity
              <span className="ml-1 text-[10px] opacity-70">{providerCounts.antigravity.connected}</span>
            </TabsTrigger>
            <TabsTrigger
              value="claude"
              className={cn(
                "gap-2 rounded-sm px-3 py-2 text-xs font-medium transition-all",
                "data-[state=active]:bg-purple-500 data-[state=active]:text-white"
              )}
            >
              <MessageSquare className="h-3.5 w-3.5" />
              Claude
              <span className="ml-1 text-[10px] opacity-70">{providerCounts.claude.connected}</span>
            </TabsTrigger>
            <TabsTrigger
              value="codex"
              className={cn(
                "gap-2 rounded-sm px-3 py-2 text-xs font-medium transition-all",
                "data-[state=active]:bg-emerald-500 data-[state=active]:text-white"
              )}
            >
              <Code2 className="h-3.5 w-3.5" />
              Codex
              <span className="ml-1 text-[10px] opacity-70">{providerCounts.codex.connected}</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="all" className="mt-6 space-y-6">
            {PROVIDERS.map((provider) => (
              <div key={provider.key}>{renderProviderSection(provider)}</div>
            ))}
          </TabsContent>

          <TabsContent value="antigravity" className="mt-6">
            {renderProviderSection(PROVIDER_BY_KEY.antigravity)}
          </TabsContent>

          <TabsContent value="claude" className="mt-6">
            {renderProviderSection(PROVIDER_BY_KEY.claude)}
          </TabsContent>

          <TabsContent value="codex" className="mt-6">
            {renderProviderSection(PROVIDER_BY_KEY.codex)}
          </TabsContent>
        </Tabs>

        <footer className="mt-10 text-center">
          <p className="text-[11px] text-muted-foreground/60">
            Voltgate | Multi-account routing and failover management
          </p>
          <div className="mt-3 flex justify-center">
            <Link
              href="/chat"
              className="text-xs font-medium text-primary/80 transition-colors hover:text-primary"
            >
              Open Voltgate Chat
            </Link>
          </div>
        </footer>
      </div>
    </div>
  )
}
