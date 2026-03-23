import { readFile } from "node:fs/promises"
import path from "node:path"
import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

type RuntimeState = {
  ui_base?: string
  chat_ui_base?: string
  api_base?: string
  gemini_base?: string
  management_base?: string
  ui_tunnel_url?: string
  api_tunnel_url?: string
}

async function readRuntimeState() {
  const candidates: string[] = []
  const envPath = process.env.VOLTGATE_STATE_FILE?.trim()
  if (envPath) {
    candidates.push(envPath)
  }

  let currentDir = process.cwd()
  while (true) {
    candidates.push(path.resolve(currentDir, ".local-stack", "processes.json"))
    const parentDir = path.dirname(currentDir)
    if (parentDir === currentDir) {
      break
    }
    currentDir = parentDir
  }

  for (const candidate of candidates) {
    try {
      const raw = await readFile(candidate, "utf8")
      return JSON.parse(raw.replace(/^\uFEFF/, "")) as RuntimeState
    } catch {
      continue
    }
  }

  throw new Error("runtime state not found")
}

export async function GET() {
  try {
    const parsed = await readRuntimeState()

    return NextResponse.json(
      {
        ui_base: parsed.ui_base ?? "",
        chat_ui_base: parsed.chat_ui_base ?? `${parsed.ui_base ?? ""}/chat`,
        api_base: parsed.api_base ?? "",
        gemini_base: parsed.gemini_base ?? "",
        management_base: parsed.management_base ?? "",
        ui_tunnel_url: parsed.ui_tunnel_url ?? "",
        api_tunnel_url: parsed.api_tunnel_url ?? "",
      },
      {
        headers: {
          "Cache-Control": "no-store",
          Pragma: "no-cache",
        },
      }
    )
  } catch {
    return NextResponse.json(
      {
        ui_base: "",
        chat_ui_base: "",
        api_base: "",
        gemini_base: "",
        management_base: "",
        ui_tunnel_url: "",
        api_tunnel_url: "",
      },
      {
        headers: {
          "Cache-Control": "no-store",
          Pragma: "no-cache",
        },
      }
    )
  }
}
