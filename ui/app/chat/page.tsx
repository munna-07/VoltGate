"use client"

import Link from "next/link"
import { useEffect, useMemo, useRef, useState, type ComponentType } from "react"
import { toast } from "sonner"
import {
  ArrowLeft,
  Bot,
  Code2,
  KeyRound,
  MessageSquare,
  RefreshCw,
  SendHorizonal,
  Shield,
  Sparkles,
  Trash2,
  Zap,
} from "lucide-react"
import { CyberBackground, HexGrid } from "@/components/cyber-background"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

type ProviderKey = "antigravity" | "claude" | "codex"

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

interface ApiAuthFile {
  id?: string
  name?: string
  provider?: string
  label?: string
  email?: string
  account?: string
  disabled?: boolean
  unavailable?: boolean
  next_retry_after?: string
  quota?: ApiQuotaState
  model_states?: Record<string, ApiModelState>
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

interface ModelsResponse {
  data?: Array<{
    id?: string
  }>
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string | { value?: string } }>
    }
  }>
  error?: {
    message?: string
  }
}

interface ChatMessage {
  id: string
  role: "user" | "assistant"
  content: string
  meta?: string
  error?: boolean
}

class ApiError extends Error {
  status?: number
  code?: string
  selectedAuthId?: string
}

const CLIENT_API_STORAGE_KEY = "voltgate.client.key"
const SELECTED_MODEL_STORAGE_KEY = "voltgate.chat.selected-model"
const SELECTED_AUTH_HEADER = "X-CPA-Selected-Auth-ID"
const PINNED_AUTH_HEADER = "X-CPA-Pinned-Auth-ID"
const BASE_URL = (process.env.NEXT_PUBLIC_MANAGEMENT_BASE_URL ?? "").replace(/\/+$/, "")

const PROVIDER_META: Array<{
  key: ProviderKey
  label: string
  icon: ComponentType<{ className?: string }>
  accentClass: string
  chipClass: string
}> = [
  {
    key: "antigravity",
    label: "Antigravity",
    icon: Zap,
    accentClass: "text-primary",
    chipClass: "border-primary/20 bg-primary/10 text-primary",
  },
  {
    key: "claude",
    label: "Claude",
    icon: MessageSquare,
    accentClass: "text-purple-400",
    chipClass: "border-purple-500/20 bg-purple-500/10 text-purple-300",
  },
  {
    key: "codex",
    label: "Codex",
    icon: Code2,
    accentClass: "text-emerald-400",
    chipClass: "border-emerald-500/20 bg-emerald-500/10 text-emerald-300",
  },
]

function getProviderKey(value?: string): ProviderKey | null {
  const normalized = value?.trim().toLowerCase()
  if (normalized === "antigravity" || normalized === "claude" || normalized === "codex") {
    return normalized
  }
  return null
}

function uniqueSorted(values: Array<string | undefined>) {
  return [...new Set(values.map((value) => value?.trim()).filter(Boolean) as string[])].sort((left, right) =>
    left.localeCompare(right)
  )
}

function resolveManagementUrl(path: string) {
  if (!BASE_URL) {
    return `/api/local${path}`
  }
  return `${BASE_URL}${path}`
}

function resolveApiUrl(path: string) {
  if (!BASE_URL) {
    return `/api/local${path}`
  }
  return `${BASE_URL}${path}`
}

function parseChatContent(response: ChatCompletionResponse) {
  const content = response.choices?.[0]?.message?.content
  if (typeof content === "string") {
    return content.trim()
  }
  if (Array.isArray(content)) {
    const text = content
      .map((item) => {
        if (!item) {
          return ""
        }
        if (typeof item.text === "string") {
          return item.text
        }
        if (item.text && typeof item.text === "object" && typeof item.text.value === "string") {
          return item.text.value
        }
        return ""
      })
      .join("\n")
      .trim()
    if (text) {
      return text
    }
  }
  return ""
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

function getAuthIdentity(auth?: ApiAuthFile | null) {
  if (!auth) {
    return ""
  }
  return auth.email?.trim() || auth.account?.trim() || auth.label?.trim() || auth.name?.trim() || auth.id?.trim() || ""
}

function getModelState(auth: ApiAuthFile | undefined, model: string) {
  const exact = auth?.model_states?.[model]
  if (exact) {
    return exact
  }
  return auth?.model_states?.[model.trim()]
}

function isModelUnavailable(auth: ApiAuthFile | undefined, model: string) {
  const state = getModelState(auth, model)
  if (!state) {
    return false
  }
  if (state.quota?.exceeded) {
    return true
  }
  if (state.unavailable && isFutureDate(state.next_retry_after)) {
    return true
  }
  if (isFutureDate(state.quota?.next_recover_at)) {
    return true
  }
  return false
}

function hasFullAuthCooldown(auth: ApiAuthFile | undefined) {
  if (!auth) {
    return false
  }
  if (auth.quota?.exceeded || auth.unavailable) {
    return true
  }
  if (isFutureDate(auth.next_retry_after) || isFutureDate(auth.quota?.next_recover_at)) {
    return true
  }
  return false
}

function authHasReadyModel(auth: ApiAuthFile | undefined, models: string[]) {
  if (!auth || auth.disabled) {
    return false
  }
  if (models.length === 0) {
    return !hasFullAuthCooldown(auth)
  }
  for (const model of models) {
    if (!isModelUnavailable(auth, model)) {
      return true
    }
  }
  return false
}

function simplifyPinnedAuthError(message: string, selectedModel: string) {
  const normalized = message.trim().toLowerCase()
  if (normalized.includes("all credentials for model") && normalized.includes("cooling down")) {
    return `Model limit is over on this account for ${selectedModel}. Switch to another ready model on the same account, or wait for cooldown.`
  }
  if (normalized.includes("verify your account to continue")) {
    return `This pinned account needs Google verification for ${selectedModel}. Try another model on this account or verify the account first.`
  }
  return message
}

export default function ChatWorkspacePage() {
  const [apiKey, setApiKey] = useState("")
  const [availableModels, setAvailableModels] = useState<string[]>([])
  const [selectedModel, setSelectedModel] = useState("")
  const [draft, setDraft] = useState("")
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [authFiles, setAuthFiles] = useState<ApiAuthFile[]>([])
  const [authModels, setAuthModels] = useState<Record<string, string[]>>({})
  const [activeAuthId, setActiveAuthId] = useState("")
  const [providerModels, setProviderModels] = useState<Record<ProviderKey, string[]>>({
    antigravity: [],
    claude: [],
    codex: [],
  })
  const [modelProviders, setModelProviders] = useState<Record<string, ProviderKey[]>>({})
  const [connectedAccounts, setConnectedAccounts] = useState(0)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isSending, setIsSending] = useState(false)

  const apiKeyRef = useRef("")
  const authFilesRef = useRef<ApiAuthFile[]>([])
  const authModelsRef = useRef<Record<string, string[]>>({})
  const activeAuthIdRef = useRef("")
  const transcriptBottomRef = useRef<HTMLDivElement | null>(null)
  const initializedRef = useRef(false)

  useEffect(() => {
    apiKeyRef.current = apiKey
  }, [apiKey])

  useEffect(() => {
    authFilesRef.current = authFiles
  }, [authFiles])

  useEffect(() => {
    authModelsRef.current = authModels
  }, [authModels])

  useEffect(() => {
    activeAuthIdRef.current = activeAuthId
  }, [activeAuthId])

  useEffect(() => {
    transcriptBottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" })
  }, [messages])

  const persistApiKey = (value: string) => {
    const normalized = value.trim()
    setApiKey(normalized)
    apiKeyRef.current = normalized
    if (typeof window !== "undefined") {
      if (normalized) {
        window.localStorage.setItem(CLIENT_API_STORAGE_KEY, normalized)
      } else {
        window.localStorage.removeItem(CLIENT_API_STORAGE_KEY)
      }
    }
    return normalized
  }

  const persistSelectedModel = (value: string) => {
    setSelectedModel(value)
    if (typeof window !== "undefined") {
      if (value) {
        window.localStorage.setItem(SELECTED_MODEL_STORAGE_KEY, value)
      } else {
        window.localStorage.removeItem(SELECTED_MODEL_STORAGE_KEY)
      }
    }
  }

  const jsonFetch = async <T,>(url: string, init?: RequestInit): Promise<T> => {
    const response = await fetch(url, init)
    const contentType = response.headers.get("content-type") ?? ""
    const payload = contentType.includes("application/json")
      ? await response.json()
      : { error: { message: await response.text() } }

    if (!response.ok) {
      const error = new ApiError(
        (payload as { error?: { message?: string } }).error?.message ||
          (payload as { error?: string }).error ||
          `Request failed with status ${response.status}`
      )
      error.status = response.status
      throw error
    }

    return payload as T
  }

  const refreshRuntime = async (options?: { silent?: boolean; apiOverride?: string }) => {
    let activeApiKey = (options?.apiOverride ?? apiKeyRef.current).trim()

    setIsRefreshing(true)
    try {
      const nextProviderModels: Record<ProviderKey, string[]> = {
        antigravity: [],
        claude: [],
        codex: [],
      }
      const nextAuthModels: Record<string, string[]> = {}
      const nextModelProvidersMap = new Map<string, Set<ProviderKey>>()
      let enabledAuthFiles: ApiAuthFile[] = []

      const authFilesResponse = await jsonFetch<AuthFilesResponse>(resolveManagementUrl("/v0/management/auth-files")).catch(
        () => ({ files: [] })
      )

      enabledAuthFiles = (authFilesResponse.files ?? []).filter((auth) => {
        const providerKey = getProviderKey(auth.provider)
        return providerKey !== null && !auth.disabled
      })
      setConnectedAccounts(enabledAuthFiles.length)
      setAuthFiles(enabledAuthFiles)

      const modelResponses = await Promise.all(
        enabledAuthFiles.map(async (auth) => {
          const providerKey = getProviderKey(auth.provider)
          const authName = auth.name?.trim()
          if (!providerKey || !authName) {
            return null
          }
          const response = await jsonFetch<AuthModelsResponse>(
            resolveManagementUrl(`/v0/management/auth-files/models?name=${encodeURIComponent(authName)}`)
          ).catch(() => ({ models: [] }))

          return {
            authID: auth.id?.trim() || authName,
            providerKey,
            models: uniqueSorted((response.models ?? []).map((model) => model.id || model.display_name)),
          }
        })
      )

      for (const result of modelResponses) {
        if (!result) {
          continue
        }
        nextAuthModels[result.authID] = result.models
        nextProviderModels[result.providerKey] = uniqueSorted([
          ...nextProviderModels[result.providerKey],
          ...result.models,
        ])
        for (const model of result.models) {
          if (!nextModelProvidersMap.has(model)) {
            nextModelProvidersMap.set(model, new Set<ProviderKey>())
          }
          nextModelProvidersMap.get(model)!.add(result.providerKey)
        }
      }

      const nextModelProviders: Record<string, ProviderKey[]> = {}
      for (const [model, providers] of nextModelProvidersMap.entries()) {
        nextModelProviders[model] = [...providers].sort((left, right) => left.localeCompare(right))
      }

      setAuthModels(nextAuthModels)
      setProviderModels(nextProviderModels)
      setModelProviders(nextModelProviders)

      if (activeAuthIdRef.current) {
        const activeAuthStillPresent = enabledAuthFiles.some((auth) => (auth.id?.trim() || auth.name?.trim()) === activeAuthIdRef.current)
        if (!activeAuthStillPresent) {
          setActiveAuthId("")
          activeAuthIdRef.current = ""
        }
      }

      if (!activeApiKey) {
        setAvailableModels([])
        if (!options?.silent) {
          toast.error("Enter a client API key from the accounts page to load models.")
        }
        return
      }

      const modelsResponse = await jsonFetch<ModelsResponse>(resolveApiUrl("/v1/models"), {
        headers: { Authorization: `Bearer ${activeApiKey}` },
      })
      const nextModels = uniqueSorted((modelsResponse.data ?? []).map((model) => model.id))
      setAvailableModels(nextModels)

      const savedModel = typeof window !== "undefined" ? window.localStorage.getItem(SELECTED_MODEL_STORAGE_KEY)?.trim() ?? "" : ""
      const selectedCandidate = nextModels.find((model) => model === selectedModel) ?? nextModels.find((model) => model === savedModel) ?? nextModels[0] ?? ""
      persistSelectedModel(selectedCandidate)

      if (!options?.silent) {
        toast.success("Voltgate chat synced.")
      }
    } catch (error) {
      if (!options?.silent) {
        toast.error(error instanceof Error ? error.message : "Failed to load Voltgate chat.")
      }
    } finally {
      setIsRefreshing(false)
    }
  }

  useEffect(() => {
    if (initializedRef.current) {
      return
    }
    initializedRef.current = true

    const savedApiKey = window.localStorage.getItem(CLIENT_API_STORAGE_KEY)?.trim() ?? ""
    const savedModel = window.localStorage.getItem(SELECTED_MODEL_STORAGE_KEY)?.trim() ?? ""

    if (savedApiKey) {
      setApiKey(savedApiKey)
      apiKeyRef.current = savedApiKey
    }
    if (savedModel) {
      setSelectedModel(savedModel)
    }

    void refreshRuntime({
      silent: true,
      apiOverride: savedApiKey,
    })
  }, [])

  const selectedProviders = useMemo(() => modelProviders[selectedModel] ?? [], [modelProviders, selectedModel])
  const availableCount = availableModels.length
  const activeAuth = useMemo(
    () => authFiles.find((auth) => (auth.id?.trim() || auth.name?.trim()) === activeAuthId) ?? null,
    [activeAuthId, authFiles]
  )

  const requestChatCompletion = async (
    outgoingMessages: Array<{ role: "user" | "assistant"; content: string }>,
    pinnedAuthId?: string
  ) => {
    const headers = new Headers({
      Authorization: `Bearer ${apiKeyRef.current.trim()}`,
      "Content-Type": "application/json",
    })
    const normalizedPinnedAuthId = pinnedAuthId?.trim()
    if (normalizedPinnedAuthId) {
      headers.set(PINNED_AUTH_HEADER, normalizedPinnedAuthId)
    }

    const response = await fetch(resolveApiUrl("/v1/chat/completions"), {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: selectedModel,
        messages: outgoingMessages,
      }),
    })

    const selectedAuthId = response.headers.get(SELECTED_AUTH_HEADER)?.trim() ?? ""
    const contentType = response.headers.get("content-type") ?? ""
    const payload = contentType.includes("application/json")
      ? await response.json()
      : { error: { message: await response.text() } }

    if (!response.ok) {
      const error = new ApiError(
        (payload as { error?: { message?: string } }).error?.message ||
          (payload as { error?: string }).error ||
          `Request failed with status ${response.status}`
      )
      error.status = response.status
      error.code = (payload as { error?: { code?: string } }).error?.code
      error.selectedAuthId = selectedAuthId || undefined
      throw error
    }

    return {
      payload: payload as ChatCompletionResponse,
      selectedAuthId,
    }
  }

  const handleSend = async () => {
    const trimmed = draft.trim()
    if (!trimmed || !selectedModel || !apiKeyRef.current.trim()) {
      return
    }

    const outgoingMessages = messages.map((message) => ({
      role: message.role,
      content: message.content,
    }))

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: trimmed,
      meta: selectedModel,
    }

    setMessages((current) => [...current, userMessage])
    setDraft("")
    setIsSending(true)
    const startedAt = Date.now()
    const requestMessages = [...outgoingMessages, { role: "user" as const, content: trimmed }]

    try {
      let response: { payload: ChatCompletionResponse; selectedAuthId: string }
      const pinnedAuthId = activeAuthIdRef.current.trim()

      try {
        response = await requestChatCompletion(requestMessages, pinnedAuthId || undefined)
      } catch (error) {
        const apiError = error instanceof ApiError ? error : null
        if (apiError?.selectedAuthId && !activeAuthIdRef.current) {
          setActiveAuthId(apiError.selectedAuthId)
          activeAuthIdRef.current = apiError.selectedAuthId
        }

        if (!apiError || !pinnedAuthId) {
          throw error
        }

        const pinnedAuth = authFilesRef.current.find(
          (auth) => (auth.id?.trim() || auth.name?.trim()) === pinnedAuthId
        )
        const pinnedAuthModels = uniqueSorted([
          ...(authModelsRef.current[pinnedAuthId] ?? []),
          ...Object.keys(pinnedAuth?.model_states ?? {}),
        ])

        if (authHasReadyModel(pinnedAuth, pinnedAuthModels)) {
          throw new Error(simplifyPinnedAuthError(apiError.message, selectedModel))
        }

        setActiveAuthId("")
        activeAuthIdRef.current = ""
        toast.info("Pinned account is fully exhausted. Switching to another ready account.")
        response = await requestChatCompletion(requestMessages)
      }

      if (response.selectedAuthId) {
        setActiveAuthId(response.selectedAuthId)
        activeAuthIdRef.current = response.selectedAuthId
      }

      const content = parseChatContent(response.payload)
      if (!content) {
        throw new Error("The model returned an empty response.")
      }

      setMessages((current) => [
        ...current,
        {
          id: `assistant-${Date.now()}`,
          role: "assistant",
          content,
          meta: `${selectedModel} · ${Date.now() - startedAt} ms`,
        },
      ])
    } catch (error) {
      if (error instanceof ApiError && error.selectedAuthId && !activeAuthIdRef.current) {
        setActiveAuthId(error.selectedAuthId)
        activeAuthIdRef.current = error.selectedAuthId
      }
      const message = error instanceof Error ? error.message : "The request failed."
      setMessages((current) => [
        ...current,
        {
          id: `assistant-error-${Date.now()}`,
          role: "assistant",
          content: message,
          meta: selectedModel,
          error: true,
        },
      ])
      toast.error(message)
    } finally {
      setIsSending(false)
    }
  }

  return (
    <div className="mesh-gradient min-h-screen relative">
      <CyberBackground />
      <HexGrid />

      <div className="relative z-10 mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="rounded-lg border border-border bg-card/90 p-6 md:p-8">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <Sparkles className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-[0.15em] text-muted-foreground">
                    Live Chat
                  </p>
                  <h1 className="text-xl font-semibold tracking-tight text-foreground">Voltgate Chat</h1>
                </div>
              </div>
              <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
                Choose any model currently present in your Antigravity, Claude, or Codex pool and send a live test message through Voltgate.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button asChild variant="secondary" className="border border-border bg-secondary/40">
                <Link href="/">
                  <ArrowLeft className="h-4 w-4" />
                  Back to Accounts
                </Link>
              </Button>
              <Button
                variant="secondary"
                className="border border-border bg-secondary/40"
                onClick={() => void refreshRuntime()}
                disabled={isRefreshing}
              >
                <RefreshCw className={cn("h-4 w-4", isRefreshing && "animate-spin")} />
                Refresh
              </Button>
            </div>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-3">
            <div className="rounded-md border border-border bg-secondary/20 p-4">
              <p className="text-[10px] font-medium uppercase tracking-[0.1em] text-muted-foreground">Connected</p>
              <p className="mt-2 text-2xl font-semibold text-primary">{connectedAccounts}</p>
              <p className="mt-1 text-xs text-muted-foreground">Enabled OAuth accounts visible to the chat tester.</p>
            </div>
            <div className="rounded-md border border-emerald-500/20 bg-emerald-500/5 p-4">
              <p className="text-[10px] font-medium uppercase tracking-[0.1em] text-muted-foreground">Models</p>
              <p className="mt-2 text-2xl font-semibold text-emerald-400">{availableCount}</p>
              <p className="mt-1 text-xs text-muted-foreground">Live models returned by your local Voltgate `/v1/models` endpoint.</p>
            </div>
            <div className="rounded-md border border-border bg-secondary/20 p-4">
              <p className="text-[10px] font-medium uppercase tracking-[0.1em] text-muted-foreground">Selected</p>
              <p className="mt-2 text-sm font-semibold text-foreground">{selectedModel || "Choose a model"}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {selectedProviders.length > 0 ? (
                  selectedProviders.map((provider) => {
                    const meta = PROVIDER_META.find((entry) => entry.key === provider)!
                    return (
                      <Badge key={provider} variant="secondary" className={meta.chipClass}>
                        {meta.label}
                      </Badge>
                    )
                  })
                ) : (
                  <span className="text-xs text-muted-foreground">Provider mapping will appear here.</span>
                )}
              </div>
              <div className="mt-3">
                {activeAuth ? (
                  <Badge variant="secondary" className="border-primary/20 bg-primary/10 text-primary">
                    Pinned account: {getAuthIdentity(activeAuth)}
                  </Badge>
                ) : (
                  <span className="text-xs text-muted-foreground">
                    The first routed account will stay pinned here until that account is fully exhausted.
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="mt-6 grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
          <div className="space-y-6">
            <section className="rounded-lg border border-border bg-card/90 p-5">
              <div className="flex items-center gap-2">
                <Shield className="h-4 w-4 text-primary" />
                <h2 className="text-sm font-semibold text-foreground">Client Access</h2>
              </div>
              <div className="mt-4 space-y-4">
                <div>
                  <label className="mb-2 block text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                    Client API Key
                  </label>
                  <div className="relative">
                    <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={apiKey}
                      onChange={(event) => persistApiKey(event.target.value)}
                      placeholder="voltgate-local-key"
                      className="border-border bg-secondary/30 pl-10"
                    />
                  </div>
                  <p className="mt-2 text-[11px] text-muted-foreground/70">
                    Create a key in the accounts page, paste it here, then click sync to load live models.
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button onClick={() => void refreshRuntime()} className="flex-1">
                    <RefreshCw className={cn("h-4 w-4", isRefreshing && "animate-spin")} />
                    Sync Models
                  </Button>
                  <Button
                    variant="secondary"
                    className="border border-border bg-secondary/40"
                    onClick={() => {
                      setMessages([])
                      setActiveAuthId("")
                      activeAuthIdRef.current = ""
                      toast.success("Chat cleared.")
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </section>

            <section className="rounded-lg border border-border bg-card/90 p-5">
              <div className="flex items-center gap-2">
                <Bot className="h-4 w-4 text-primary" />
                <h2 className="text-sm font-semibold text-foreground">Model Picker</h2>
              </div>
              <div className="mt-4 space-y-4">
                <div>
                  <label className="mb-2 block text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                    Active Model
                  </label>
                  <Select value={selectedModel} onValueChange={persistSelectedModel}>
                    <SelectTrigger className="w-full border-border bg-secondary/30">
                      <SelectValue placeholder="Select a live model" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableModels.map((model) => (
                        <SelectItem key={model} value={model}>
                          {model}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="rounded-md border border-border bg-secondary/20 p-3">
                  <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">Available Through</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {selectedProviders.length > 0 ? (
                      selectedProviders.map((provider) => {
                        const meta = PROVIDER_META.find((entry) => entry.key === provider)!
                        return (
                          <Badge key={provider} variant="secondary" className={meta.chipClass}>
                            {meta.label}
                          </Badge>
                        )
                      })
                    ) : (
                      <span className="text-xs text-muted-foreground">No provider mapping for the selected model yet.</span>
                    )}
                  </div>
                </div>
              </div>
            </section>

            <section className="rounded-lg border border-border bg-card/90 p-5">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                <h2 className="text-sm font-semibold text-foreground">Connected Provider Models</h2>
              </div>
              <div className="mt-4 space-y-4">
                {PROVIDER_META.map((provider) => {
                  const Icon = provider.icon
                  const models = providerModels[provider.key]
                  return (
                    <div key={provider.key} className="rounded-md border border-border bg-secondary/20 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <Icon className={cn("h-4 w-4", provider.accentClass)} />
                          <span className="text-sm font-medium text-foreground">{provider.label}</span>
                        </div>
                        <Badge variant="secondary" className="border-border bg-secondary/60 text-muted-foreground">
                          {models.length}
                        </Badge>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {models.length > 0 ? (
                          models.map((model) => (
                            <button
                              key={`${provider.key}-${model}`}
                              type="button"
                              onClick={() => persistSelectedModel(model)}
                              className={cn(
                                "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                                selectedModel === model
                                  ? provider.chipClass
                                  : "border-border bg-secondary/40 text-muted-foreground hover:border-primary/30 hover:text-foreground"
                              )}
                            >
                              {model}
                            </button>
                          ))
                        ) : (
                          <span className="text-xs text-muted-foreground">No enabled {provider.label} models detected.</span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>
          </div>

          <section className="rounded-lg border border-border bg-card/90">
            <div className="border-b border-border px-5 py-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">Proxy Chat</p>
                  <h2 className="mt-1 text-lg font-semibold text-foreground">Live response test</h2>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="secondary" className="border-border bg-secondary/60 text-muted-foreground">
                    Endpoint: /v1/chat/completions
                  </Badge>
                  {selectedModel ? (
                    <Badge variant="secondary" className="border-primary/20 bg-primary/10 text-primary">
                      {selectedModel}
                    </Badge>
                  ) : null}
                </div>
              </div>
            </div>

            <ScrollArea className="h-[520px]">
              <div className="space-y-4 p-5">
                {messages.length > 0 ? (
                  messages.map((message) => (
                    <div
                      key={message.id}
                      className={cn(
                        "max-w-[90%] rounded-lg border px-4 py-3",
                        message.role === "user"
                          ? "ml-auto border-primary/20 bg-primary/10 text-foreground"
                          : message.error
                            ? "border-destructive/30 bg-destructive/10 text-foreground"
                            : "border-border bg-secondary/20 text-foreground"
                      )}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                          {message.role === "user" ? "You" : "Assistant"}
                        </span>
                        {message.meta ? (
                          <span className="text-[10px] text-muted-foreground">{message.meta}</span>
                        ) : null}
                      </div>
                      <p className="mt-2 whitespace-pre-wrap text-sm leading-6">{message.content}</p>
                    </div>
                  ))
                ) : (
                  <div className="rounded-lg border border-dashed border-border bg-secondary/10 p-8 text-center">
                    <p className="text-sm font-medium text-foreground">No messages yet.</p>
                    <p className="mt-2 text-sm text-muted-foreground">
                      Pick a live model, send a prompt, and this page will call your local Voltgate API directly.
                    </p>
                  </div>
                )}
                <div ref={transcriptBottomRef} />
              </div>
            </ScrollArea>

            <div className="border-t border-border p-5">
              <Textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault()
                    void handleSend()
                  }
                }}
                placeholder="Send a live test message. Example: Reply with exactly 'API is working'."
                className="min-h-32 border-border bg-secondary/20"
              />
              <div className="mt-3 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <p className="text-xs text-muted-foreground">
                  Press <span className="text-foreground">Enter</span> to send and <span className="text-foreground">Shift+Enter</span> for a new line.
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    className="border border-border bg-secondary/40"
                    onClick={() => setDraft("Reply with exactly: API is working")}
                  >
                    Quick API Test
                  </Button>
                  <Button onClick={() => void handleSend()} disabled={isSending || !selectedModel || !apiKey.trim() || !draft.trim()}>
                    <SendHorizonal className={cn("h-4 w-4", isSending && "animate-pulse")} />
                    {isSending ? "Sending..." : "Send Message"}
                  </Button>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
