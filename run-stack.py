#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.request
import webbrowser
from pathlib import Path
from typing import Iterable


REPO_ROOT = Path(__file__).resolve().parent
UI_DIR = REPO_ROOT / "ui"
CONFIG_FILE = REPO_ROOT / "config.yaml"
CONFIG_EXAMPLE_FILE = REPO_ROOT / "config.example.yaml"
ENV_FILE = REPO_ROOT / ".env"
ENV_EXAMPLE_FILE = REPO_ROOT / ".env.example"
STATE_DIR = REPO_ROOT / ".local-stack"
PID_FILE = STATE_DIR / "processes.json"
DEFAULT_LOCAL_API_KEY = "voltgate-local-key"

WINDOWS = sys.platform.startswith("win")
MACOS = sys.platform == "darwin"
LINUX = sys.platform.startswith("linux")


def read_env_value(path: Path, key: str, default: str = "") -> str:
    if not path.exists():
        return default
    pattern = re.compile(rf"^\s*{re.escape(key)}\s*=\s*(.+?)\s*$")
    for line in path.read_text(encoding="utf-8", errors="ignore").splitlines():
        match = pattern.match(line)
        if not match:
            continue
        value = match.group(1).strip().strip("'").strip('"')
        return value or default
    return default


def read_yaml_scalar(path: Path, key: str, default: str = "") -> str:
    if not path.exists():
        return default
    pattern = re.compile(rf"^\s*{re.escape(key)}\s*:\s*(.*?)\s*$")
    for line in path.read_text(encoding="utf-8", errors="ignore").splitlines():
        match = pattern.match(line)
        if not match:
            continue
        value = match.group(1).split("#", 1)[0].strip().strip("'").strip('"')
        return value or default
    return default


def read_yaml_first_list_value(path: Path, key: str, default: str = "") -> str:
    if not path.exists():
        return default
    lines = path.read_text(encoding="utf-8", errors="ignore").splitlines()
    inside = False
    key_pattern = re.compile(rf"^\s*{re.escape(key)}\s*:\s*$")
    item_pattern = re.compile(r"^\s*-\s*(.+?)\s*$")
    for line in lines:
        if not inside:
            if key_pattern.match(line):
                inside = True
            continue
        match = item_pattern.match(line)
        if match:
            return match.group(1).split("#", 1)[0].strip().strip("'").strip('"') or default
        if line and not line[:1].isspace():
            break
    return default


def build_local_config_text() -> str:
    if CONFIG_EXAMPLE_FILE.exists():
        text = CONFIG_EXAMPLE_FILE.read_text(encoding="utf-8", errors="ignore")
    else:
        text = f"""host: "127.0.0.1"
port: 8317

remote-management:
  allow-remote: false
  secret-key: ""

auth-dir: "~/.voltgate"

api-keys:
  - "{DEFAULT_LOCAL_API_KEY}"

routing:
  strategy: "fill-first"
"""
    text = re.sub(r'(?m)^host:\s*.*$', 'host: "127.0.0.1"', text, count=1)
    text = re.sub(r'(?m)^(\s*allow-remote:\s*).*$', r'\1false', text, count=1)
    text = re.sub(r'(?m)^(\s*secret-key:\s*).*$', r'\1""', text, count=1)
    text = re.sub(
        r'(?ms)^api-keys:\s*\n(?:\s*-\s*.*\n)+',
        f'api-keys:\n  - "{DEFAULT_LOCAL_API_KEY}"\n',
        text,
        count=1,
    )
    text = re.sub(
        r'(?m)^(\s*strategy:\s*).*$',
        r'\1"fill-first" # round-robin (default), fill-first',
        text,
        count=1,
    )
    if not text.endswith("\n"):
        text += "\n"
    return text


def build_local_env_text() -> str:
    if ENV_EXAMPLE_FILE.exists():
        text = ENV_EXAMPLE_FILE.read_text(encoding="utf-8", errors="ignore")
    else:
        text = "# Local runtime environment for VoltGate.\n"
    if not text.endswith("\n"):
        text += "\n"
    return text


def ensure_local_bootstrap_files() -> list[str]:
    created: list[str] = []
    if not CONFIG_FILE.exists():
        CONFIG_FILE.write_text(build_local_config_text(), encoding="utf-8")
        created.append(CONFIG_FILE.name)
    if not ENV_FILE.exists():
        ENV_FILE.write_text(build_local_env_text(), encoding="utf-8")
        created.append(ENV_FILE.name)
    return created


def common_windows_paths(names: Iterable[str]) -> list[Path]:
    candidates: list[Path] = []
    program_files = os.environ.get("ProgramFiles", r"C:\Program Files")
    program_files_x86 = os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)")
    local_app_data = os.environ.get("LOCALAPPDATA", "")
    user_profile = os.environ.get("USERPROFILE", "")
    for name in names:
        lower = name.lower()
        if lower in {"go", "go.exe"}:
            candidates.append(Path(program_files) / "Go" / "bin" / "go.exe")
            candidates.append(Path(program_files_x86) / "Go" / "bin" / "go.exe")
        if lower in {"node", "node.exe"}:
            candidates.append(Path(program_files) / "nodejs" / "node.exe")
            candidates.append(Path(program_files_x86) / "nodejs" / "node.exe")
        if lower in {"npm", "npm.cmd"}:
            candidates.append(Path(program_files) / "nodejs" / "npm.cmd")
            candidates.append(Path(program_files_x86) / "nodejs" / "npm.cmd")
        if lower in {"cloudflared", "cloudflared.exe"}:
            candidates.append(Path(program_files) / "cloudflared" / "cloudflared.exe")
            candidates.append(Path(program_files_x86) / "cloudflared" / "cloudflared.exe")
            if local_app_data:
                candidates.append(Path(local_app_data) / "Microsoft" / "WinGet" / "Links" / "cloudflared.exe")
            if user_profile:
                candidates.append(Path(user_profile) / ".cloudflared" / "cloudflared.exe")
                candidates.append(Path(user_profile) / "scoop" / "shims" / "cloudflared.exe")
    return candidates


def which_any(names: Iterable[str]) -> str | None:
    for name in names:
        resolved = shutil.which(name)
        if resolved:
            return resolved
    if WINDOWS:
        for candidate in common_windows_paths(names):
            if candidate.exists():
                return str(candidate)
    return None


def run_command(command: list[str], *, cwd: Path | None = None, env: dict[str, str] | None = None) -> None:
    subprocess.run(command, cwd=str(cwd) if cwd else None, env=env, check=True)


def open_browser(url: str) -> None:
    if not url:
        return
    try:
        webbrowser.open(url, new=2)
    except Exception:
        pass


def install_with_winget(package_id: str) -> None:
    run_command(
        [
            "winget",
            "install",
            "--exact",
            "--id",
            package_id,
            "--accept-package-agreements",
            "--accept-source-agreements",
        ]
    )


def install_with_choco(package_name: str) -> None:
    run_command(["choco", "install", "-y", package_name])


APT_UPDATED = False


def apt_prefix() -> list[str]:
    if hasattr(os, "geteuid") and os.geteuid() != 0:
        sudo = shutil.which("sudo")
        if sudo:
            return [sudo]
    return []


def apt_install(packages: list[str]) -> None:
    global APT_UPDATED
    prefix = apt_prefix()
    if not APT_UPDATED:
        run_command(prefix + ["apt-get", "update"])
        APT_UPDATED = True
    run_command(prefix + ["apt-get", "install", "-y"] + packages)


def ensure_dependency(kind: str, *, skip_install: bool) -> str:
    command_names: dict[str, list[str]] = {
        "go": ["go.exe", "go"] if WINDOWS else ["go"],
        "npm": ["npm.cmd", "npm"] if WINDOWS else ["npm"],
        "node": ["node.exe", "node"] if WINDOWS else ["node"],
        "cloudflared": ["cloudflared.exe", "cloudflared"] if WINDOWS else ["cloudflared"],
    }

    path = which_any(command_names[kind])
    if path:
        return path

    if skip_install:
        raise RuntimeError(f"{kind} is not installed and --skip-install was used.")

    if WINDOWS:
        winget = shutil.which("winget")
        choco = shutil.which("choco")
        package_ids = {
            "go": ("GoLang.Go", "golang"),
            "node": ("OpenJS.NodeJS.LTS", "nodejs-lts"),
            "npm": ("OpenJS.NodeJS.LTS", "nodejs-lts"),
            "cloudflared": ("Cloudflare.cloudflared", "cloudflared"),
        }
        winget_id, choco_name = package_ids[kind]
        if winget:
            install_with_winget(winget_id)
        elif choco:
            install_with_choco(choco_name)
        else:
            raise RuntimeError("Neither winget nor choco is available on Windows for automatic installs.")
    elif MACOS:
        brew = shutil.which("brew")
        if not brew:
            raise RuntimeError("Homebrew is required for automatic installs on macOS. Install brew once, then rerun this script.")
        package_names = {
            "go": "go",
            "node": "node",
            "npm": "node",
            "cloudflared": "cloudflared",
        }
        run_command([brew, "install", package_names[kind]])
    elif LINUX:
        package_names = {
            "go": ["golang-go"],
            "node": ["nodejs", "npm"],
            "npm": ["nodejs", "npm"],
            "cloudflared": ["cloudflared"],
        }
        apt_install(package_names[kind])
    else:
        raise RuntimeError(f"Automatic installs are not supported on this platform: {sys.platform}")

    path = which_any(command_names[kind])
    if path:
        return path

    raise RuntimeError(f"{kind} installation finished but the command is still not available in PATH.")


def request_ok(url: str, *, headers: dict[str, str] | None = None, timeout: int = 8) -> bool:
    request = urllib.request.Request(url, headers=headers or {}, method="GET")
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return 200 <= response.status < 400
    except urllib.error.HTTPError as exc:
        return 200 <= exc.code < 400
    except Exception:
        return False


def wait_for_url(url: str, *, headers: dict[str, str] | None = None, timeout_seconds: int = 180) -> bool:
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        if request_ok(url, headers=headers):
            return True
        time.sleep(2)
    return False


def tail_log(path: Path, lines: int = 20) -> str:
    if not path.exists():
        return "(log file not found)"
    content = path.read_text(encoding="utf-8", errors="ignore").splitlines()
    if not content:
        return "(no log output yet)"
    return "\n".join(content[-lines:])


def wait_for_pattern(path: Path, pattern: str, timeout_seconds: int = 60) -> str | None:
    compiled = re.compile(pattern)
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        if path.exists():
            content = path.read_text(encoding="utf-8", errors="ignore")
            match = compiled.search(content)
            if match:
                return match.group(0)
        time.sleep(1)
    return None


def terminate_pid(pid: int) -> bool:
    if pid <= 0:
        return False
    try:
        if WINDOWS:
            subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        else:
            try:
                os.killpg(pid, signal.SIGTERM)
            except ProcessLookupError:
                return False
            except Exception:
                os.kill(pid, signal.SIGTERM)
        return True
    except Exception:
        return False


def stop_tracked_processes() -> bool:
    if not PID_FILE.exists():
        return False
    try:
        state = json.loads(PID_FILE.read_text(encoding="utf-8"))
    except Exception:
        state = {}
    stopped = False
    for key in ("api_pid", "ui_pid", "ui_tunnel_pid", "api_tunnel_pid"):
        value = int(state.get(key) or 0)
        if value and terminate_pid(value):
            stopped = True
    try:
        PID_FILE.unlink()
    except FileNotFoundError:
        pass
    return stopped


def get_listening_pids(ports: Iterable[int]) -> list[int]:
    wanted = {int(port) for port in ports if int(port) > 0}
    if not wanted:
        return []

    pids: set[int] = set()
    if WINDOWS:
        result = subprocess.run(["netstat", "-ano", "-p", "tcp"], check=False, capture_output=True, text=True)
        for line in result.stdout.splitlines():
            if "LISTENING" not in line.upper():
                continue
            parts = [part for part in line.split() if part]
            if len(parts) < 5:
                continue
            local_address = parts[1]
            pid_text = parts[4]
            try:
                port = int(local_address.rsplit(":", 1)[1])
                pid = int(pid_text)
            except Exception:
                continue
            if port in wanted and pid != os.getpid():
                pids.add(pid)
    else:
        lsof = shutil.which("lsof")
        if lsof:
            for port in wanted:
                result = subprocess.run(
                    [lsof, "-t", f"-iTCP:{port}", "-sTCP:LISTEN"],
                    check=False,
                    capture_output=True,
                    text=True,
                )
                for line in result.stdout.splitlines():
                    try:
                        pid = int(line.strip())
                    except Exception:
                        continue
                    if pid != os.getpid():
                        pids.add(pid)
    return sorted(pids)


def stop_port_listeners(ports: Iterable[int]) -> bool:
    stopped = False
    for pid in get_listening_pids(ports):
        if terminate_pid(pid):
            stopped = True
    if stopped:
        time.sleep(1)
    return stopped


def start_process(
    command: list[str],
    *,
    cwd: Path,
    stdout_path: Path,
    stderr_path: Path,
    env: dict[str, str] | None = None,
) -> subprocess.Popen[bytes]:
    stdout_handle = stdout_path.open("wb")
    stderr_handle = stderr_path.open("wb")
    kwargs: dict[str, object] = {
        "cwd": str(cwd),
        "stdout": stdout_handle,
        "stderr": stderr_handle,
        "env": env,
    }
    if WINDOWS:
        kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP  # type: ignore[attr-defined]
    else:
        kwargs["start_new_session"] = True
    return subprocess.Popen(command, **kwargs)


def print_ready_banner(
    *,
    ui_base: str,
    chat_ui_base: str,
    api_base: str,
    gemini_base: str,
    management_base: str,
    api_key: str,
    default_model: str,
    ui_tunnel_url: str,
    api_tunnel_url: str,
    tunnel_enabled: bool,
) -> None:
    print()
    print("===================== VOLTGATE READY =====================")
    print(f"Voltgate UI          : {ui_base}")
    print(f"Voltgate Chat        : {chat_ui_base}")
    print(f"Voltgate API         : {api_base}")
    print(f"Gemini Protocol      : {gemini_base}")
    print(f"Management API       : {management_base}")
    if tunnel_enabled:
        remote_chat = f"{ui_tunnel_url.rstrip('/')}/chat" if ui_tunnel_url else ""
        public_api_base = f"{api_tunnel_url.rstrip('/')}/v1" if api_tunnel_url else ""
        public_gemini_base = f"{api_tunnel_url.rstrip('/')}/v1beta" if api_tunnel_url else ""
        print(f"Remote Chat          : {remote_chat}")
        print(f"Remote API Base      : {public_api_base}")
        print(f"Remote Gemini Base   : {public_gemini_base}")
        print("Remote management    : Account connect/remove stays local on 127.0.0.1")
    print(f"Sample Voltgate Key  : {api_key}")
    print(f"Detected Test Model  : {default_model}")
    print()
    print("How to check your API is working")
    print("1. Open the accounts UI and create or copy a client API key.")
    print(f"   {ui_base}")
    print()
    print("2. Open the chat page, paste the client key, and click Sync Models.")
    print(f"   {chat_ui_base}")
    print()
    print("3. Test the model list:")
    print(f"   curl -H \"Authorization: Bearer {api_key}\" {api_base}/models")
    print()
    print("4. Test chat completions:")
    print(
        f"   curl -X POST {api_base}/chat/completions -H \"Authorization: Bearer {api_key}\" "
        f"-H \"Content-Type: application/json\" -d '{{\"model\":\"{default_model}\",\"messages\":[{{\"role\":\"user\",\"content\":\"Reply with: API is working\"}}]}}'"
    )
    print()
    print("5. Test Responses API:")
    print(
        f"   curl -X POST {api_base}/responses -H \"Authorization: Bearer {api_key}\" "
        f"-H \"Content-Type: application/json\" -d '{{\"model\":\"{default_model}\",\"input\":\"Say hello in one short line.\"}}'"
    )
    print()
    print("How to stop Voltgate later")
    print(f"   {Path(__file__).name} --stop")
    print("========================================================")


def main() -> int:
    parser = argparse.ArgumentParser(description="Start Voltgate locally and expose it through Cloudflare quick tunnels.")
    parser.add_argument("--stop", action="store_true", help="Stop tracked backend, UI, and tunnel processes.")
    parser.add_argument("--tunnel", dest="tunnel", action="store_true", help="Start Cloudflare quick tunnels for the UI and API.")
    parser.add_argument("--no-tunnel", dest="tunnel", action="store_false", help="Run Voltgate on localhost only.")
    parser.add_argument("--ui-port", type=int, default=3000, help="Port for the custom Next.js UI.")
    parser.add_argument("--skip-install", action="store_true", help="Do not attempt automatic dependency installation.")
    parser.set_defaults(tunnel=True)
    args = parser.parse_args()

    if not UI_DIR.exists():
        raise RuntimeError(f"Custom UI folder not found: {UI_DIR}")

    api_port = int(read_yaml_scalar(CONFIG_FILE, "port", "8317") or "8317") if CONFIG_FILE.exists() else 8317
    if args.stop:
        stopped_tracked = stop_tracked_processes()
        stopped_ports = stop_port_listeners([api_port, args.ui_port])
        if stopped_tracked or stopped_ports:
            print("Voltgate UI + API stopped.")
        else:
            print("No tracked Voltgate processes were running.")
        return 0

    created_files = ensure_local_bootstrap_files()
    if created_files:
        print(f"Created local bootstrap files: {', '.join(created_files)}")

    STATE_DIR.mkdir(parents=True, exist_ok=True)
    stop_tracked_processes()
    stop_port_listeners([api_port, args.ui_port])

    raw_host = read_yaml_scalar(CONFIG_FILE, "host", "127.0.0.1") or "127.0.0.1"
    api_key = read_yaml_first_list_value(CONFIG_FILE, "api-keys", "voltgate-local-key") or "voltgate-local-key"
    call_host = raw_host if raw_host not in {"", "0.0.0.0", "::"} else "127.0.0.1"

    api_root = f"http://{call_host}:{api_port}"
    api_base = f"{api_root}/v1"
    gemini_base = f"{api_root}/v1beta"
    management_base = f"{api_root}/v0/management"
    ui_base = f"http://127.0.0.1:{args.ui_port}"
    chat_ui_base = f"{ui_base}/chat"

    go_path = None
    api_executable_candidates = [
        REPO_ROOT / ("voltgate.exe" if WINDOWS else "voltgate"),
        REPO_ROOT / ("voltgate.exe" if WINDOWS else "voltgate"),
    ]
    api_executable = next((candidate for candidate in api_executable_candidates if candidate.exists()), None)
    if api_executable:
        api_runner = [str(api_executable), "-config=./config.yaml"]
    else:
        go_path = ensure_dependency("go", skip_install=args.skip_install)
        api_runner = [go_path, "run", "./cmd/server", "-config=./config.yaml"]

    ensure_dependency("node", skip_install=args.skip_install)
    npm_path = ensure_dependency("npm", skip_install=args.skip_install)
    cloudflared_path = ensure_dependency("cloudflared", skip_install=args.skip_install) if args.tunnel else None

    env = os.environ.copy()
    env["LOCAL_PROXY_API_ORIGIN"] = api_root
    env["VOLTGATE_STATE_FILE"] = str(PID_FILE)
    env.pop("NEXT_PUBLIC_MANAGEMENT_BASE_URL", None)

    node_modules = UI_DIR / "node_modules"
    ui_install_log = STATE_DIR / "ui.install.log"
    ui_build_log = STATE_DIR / "ui.build.log"
    if not node_modules.exists():
        print("Installing UI dependencies (first run only)...")
        with ui_install_log.open("wb") as install_output:
            subprocess.run(
                [npm_path, "install", "--no-fund", "--no-audit"],
                cwd=str(UI_DIR),
                env=env,
                check=True,
                stdout=install_output,
                stderr=subprocess.STDOUT,
            )

    api_out_log = STATE_DIR / "api.out.log"
    api_err_log = STATE_DIR / "api.err.log"
    ui_out_log = STATE_DIR / "ui.out.log"
    ui_err_log = STATE_DIR / "ui.err.log"
    ui_tunnel_out_log = STATE_DIR / "ui-tunnel.out.log"
    ui_tunnel_err_log = STATE_DIR / "ui-tunnel.err.log"
    api_tunnel_out_log = STATE_DIR / "api-tunnel.out.log"
    api_tunnel_err_log = STATE_DIR / "api-tunnel.err.log"

    for path in (
        api_out_log,
        api_err_log,
        ui_out_log,
        ui_err_log,
        ui_build_log,
        ui_tunnel_out_log,
        ui_tunnel_err_log,
        api_tunnel_out_log,
        api_tunnel_err_log,
    ):
        try:
            path.unlink()
        except FileNotFoundError:
            pass

    print("Starting Voltgate backend...")
    api_process = start_process(api_runner, cwd=REPO_ROOT, stdout_path=api_out_log, stderr_path=api_err_log, env=env)

    if not wait_for_url(f"{api_root}/"):
        raise RuntimeError(
            f"Backend did not start in time. Check {api_out_log} and {api_err_log}\n\n"
            f"Recent stdout:\n{tail_log(api_out_log)}\n\nRecent stderr:\n{tail_log(api_err_log)}"
        )

    if not wait_for_url(f"{management_base}/auth-files"):
        raise RuntimeError(
            f"Management API did not come up correctly. Check {api_out_log} and {api_err_log}\n\n"
            f"Recent stdout:\n{tail_log(api_out_log)}\n\nRecent stderr:\n{tail_log(api_err_log)}"
        )

    if not wait_for_url(f"{api_base}/models", headers={"Authorization": f"Bearer {api_key}"}):
        raise RuntimeError(
            f"Main API did not come up correctly. Check {api_out_log} and {api_err_log}\n\n"
            f"Recent stdout:\n{tail_log(api_out_log)}\n\nRecent stderr:\n{tail_log(api_err_log)}"
        )

    print("Building Voltgate UI for production...")
    with ui_build_log.open("wb") as build_output:
        subprocess.run(
            [npm_path, "run", "build"],
            cwd=str(UI_DIR),
            env=env,
            check=True,
            stdout=build_output,
            stderr=subprocess.STDOUT,
        )

    print("Starting Voltgate UI...")
    ui_process = start_process(
        [npm_path, "run", "start", "--", "--hostname", "127.0.0.1", "--port", str(args.ui_port)],
        cwd=UI_DIR,
        stdout_path=ui_out_log,
        stderr_path=ui_err_log,
        env=env,
    )

    if not wait_for_url(ui_base):
        raise RuntimeError(f"UI did not start in time. Check {ui_out_log} and {ui_err_log}")

    ui_tunnel_process = None
    api_tunnel_process = None
    ui_tunnel_url = ""
    api_tunnel_url = ""

    if args.tunnel:
        print("Starting Cloudflare quick tunnels for Voltgate...")
        ui_tunnel_process = start_process(
            [cloudflared_path, "tunnel", "--url", ui_base, "--no-autoupdate"],
            cwd=REPO_ROOT,
            stdout_path=ui_tunnel_out_log,
            stderr_path=ui_tunnel_err_log,
            env=env,
        )
        api_tunnel_process = start_process(
            [cloudflared_path, "tunnel", "--url", api_root, "--no-autoupdate"],
            cwd=REPO_ROOT,
            stdout_path=api_tunnel_out_log,
            stderr_path=api_tunnel_err_log,
            env=env,
        )

        tunnel_pattern = r"https://[-a-z0-9]+\.trycloudflare\.com"
        ui_tunnel_url = wait_for_pattern(ui_tunnel_out_log, tunnel_pattern, timeout_seconds=60) or wait_for_pattern(
            ui_tunnel_err_log, tunnel_pattern, timeout_seconds=20
        ) or ""
        api_tunnel_url = wait_for_pattern(api_tunnel_out_log, tunnel_pattern, timeout_seconds=60) or wait_for_pattern(
            api_tunnel_err_log, tunnel_pattern, timeout_seconds=20
        ) or ""

        if not ui_tunnel_url:
            raise RuntimeError(
                f"UI quick tunnel did not start correctly. Check {ui_tunnel_out_log} and {ui_tunnel_err_log}\n\n"
                f"Recent stdout:\n{tail_log(ui_tunnel_out_log)}\n\nRecent stderr:\n{tail_log(ui_tunnel_err_log)}"
            )
        if not api_tunnel_url:
            raise RuntimeError(
                f"API quick tunnel did not start correctly. Check {api_tunnel_out_log} and {api_tunnel_err_log}\n\n"
                f"Recent stdout:\n{tail_log(api_tunnel_out_log)}\n\nRecent stderr:\n{tail_log(api_tunnel_err_log)}"
            )

    default_model = "MODEL_NAME_HERE"
    try:
        request = urllib.request.Request(f"{api_base}/models", headers={"Authorization": f"Bearer {api_key}"}, method="GET")
        with urllib.request.urlopen(request, timeout=8) as response:
            payload = json.loads(response.read().decode("utf-8"))
        data = payload.get("data") or []
        if data and data[0].get("id"):
            default_model = str(data[0]["id"])
    except Exception:
        pass

    state = {
        "started_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "api_pid": api_process.pid,
        "ui_pid": ui_process.pid,
        "ui_tunnel_pid": ui_tunnel_process.pid if ui_tunnel_process else None,
        "api_tunnel_pid": api_tunnel_process.pid if api_tunnel_process else None,
        "api_root": api_root,
        "api_base": api_base,
        "gemini_base": gemini_base,
        "management_base": management_base,
        "ui_base": ui_base,
        "ui_tunnel_url": ui_tunnel_url,
        "api_tunnel_url": api_tunnel_url,
        "api_key": api_key,
    }
    PID_FILE.write_text(json.dumps(state, indent=2), encoding="utf-8")

    print_ready_banner(
        ui_base=ui_base,
        chat_ui_base=chat_ui_base,
        api_base=api_base,
        gemini_base=gemini_base,
        management_base=management_base,
        api_key=api_key,
        default_model=default_model,
        ui_tunnel_url=ui_tunnel_url,
        api_tunnel_url=api_tunnel_url,
        tunnel_enabled=args.tunnel,
    )

    open_browser(ui_base)
    print(f"Opened Voltgate UI   : {ui_base}")
    print("Logs")
    print(f"API stdout           : {api_out_log}")
    print(f"API stderr           : {api_err_log}")
    print(f"UI build log         : {ui_build_log}")
    print(f"UI stdout            : {ui_out_log}")
    print(f"UI stderr            : {ui_err_log}")
    if args.tunnel:
        print(f"UI tunnel stdout     : {ui_tunnel_out_log}")
        print(f"UI tunnel stderr     : {ui_tunnel_err_log}")
        print(f"API tunnel stdout    : {api_tunnel_out_log}")
        print(f"API tunnel stderr    : {api_tunnel_err_log}")

    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except subprocess.CalledProcessError as exc:
        raise SystemExit(exc.returncode)
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        raise SystemExit(1)
