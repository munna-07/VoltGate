import { NextRequest, NextResponse } from "next/server"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const DEFAULT_LOCAL_API_ORIGIN = "http://127.0.0.1:8317"
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"])

function getLocalApiOrigin() {
  const value = process.env.LOCAL_PROXY_API_ORIGIN?.trim()
  return value || DEFAULT_LOCAL_API_ORIGIN
}

function getRequestHost(request: NextRequest) {
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim()
  const host = forwardedHost || request.headers.get("host") || request.nextUrl.host || request.nextUrl.hostname || ""
  return host.toLowerCase()
}

function isLocalRequest(request: NextRequest) {
  const host = getRequestHost(request)
  const hostname = host.split(":")[0]
  return LOCAL_HOSTS.has(hostname)
}

function isRemoteManagementReadAllowed(method: string, segments: string[]) {
  const path = `/${segments.join("/")}`
  return method === "GET" && (path === "/v0/management/auth-files" || path === "/v0/management/auth-files/models")
}

function buildTargetUrl(request: NextRequest, segments: string[]) {
  const origin = getLocalApiOrigin().replace(/\/+$/, "")
  const target = new URL(origin)
  target.pathname = `/${segments.join("/")}`
  target.search = request.nextUrl.search
  return target
}

async function proxyRequest(request: NextRequest, segments: string[]) {
  const normalizedSegments = segments ?? []
  const method = request.method.toUpperCase()
  const isManagementRequest = normalizedSegments[0] === "v0" && normalizedSegments[1] === "management"

  if (!isLocalRequest(request) && isManagementRequest && !isRemoteManagementReadAllowed(method, normalizedSegments)) {
    return NextResponse.json(
      {
        error: "Remote account management is disabled. Use the local Voltgate UI on 127.0.0.1 for account setup.",
      },
      {
        status: 403,
        headers: {
          "Cache-Control": "no-store",
          Pragma: "no-cache",
        },
      }
    )
  }

  const target = buildTargetUrl(request, normalizedSegments)
  const headers = new Headers(request.headers)

  headers.delete("host")
  headers.delete("connection")
  headers.delete("content-length")

  const body =
    method === "GET" || method === "HEAD" || method === "OPTIONS"
      ? undefined
      : await request.arrayBuffer()

  const response = await fetch(target.toString(), {
    method,
    headers,
    body,
    cache: "no-store",
    redirect: "manual",
  })

  const responseHeaders = new Headers(response.headers)
  responseHeaders.set("Cache-Control", "no-store")
  responseHeaders.set("Pragma", "no-cache")

  return new NextResponse(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  })
}

type RouteContext = {
  params: Promise<{
    segments: string[]
  }>
}

async function handle(request: NextRequest, context: RouteContext) {
  const { segments } = await context.params
  return proxyRequest(request, segments ?? [])
}

export async function GET(request: NextRequest, context: RouteContext) {
  return handle(request, context)
}

export async function POST(request: NextRequest, context: RouteContext) {
  return handle(request, context)
}

export async function PUT(request: NextRequest, context: RouteContext) {
  return handle(request, context)
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  return handle(request, context)
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  return handle(request, context)
}

export async function OPTIONS(request: NextRequest, context: RouteContext) {
  return handle(request, context)
}

export async function HEAD(request: NextRequest, context: RouteContext) {
  return handle(request, context)
}
