#!/usr/bin/env python3
"""
PULT Desktop Agent (experimental, local only)

Receives a JSON plan from an AI (Grok / GPT / Claude / Gemini) and executes
safe, limited actions on the local machine.

IMPORTANT:
- Runs only on YOUR computer.
- Does NOT give remote access to anyone, including the AI cloud.
- You must review and approve every plan before execution.
- Full desktop control is powerful and dangerous. Use at your own risk.
- Phone control is not supported from this agent (use Shortcuts / Tasker separately).

Supported actions (very limited by design):
  - open_url          : open a URL in default browser
  - open_app          : open an application by name (macOS/Linux/Windows limited)
  - type_text         : type text (requires focus on target)
  - hotkey            : press a hotkey combination
  - notify            : show a desktop notification
  - wait              : pause

Install deps:
  pip install pyautogui requests

Usage:
  python agent.py --plan plan.json
  or pipe JSON to stdin
"""

import argparse
import json
import sys
import time
import webbrowser
import subprocess
import platform
from pathlib import Path

try:
    import pyautogui
    pyautogui.FAILSAFE = True  # move mouse to corner to abort
except ImportError:
    pyautogui = None
    print("Warning: pyautogui not installed. Typing and hotkeys disabled.")


def notify(title: str, message: str):
    system = platform.system()
    if system == "Darwin":
        subprocess.run(["osascript", "-e", f'display notification "{message}" with title "{title}"'], check=False)
    elif system == "Linux":
        subprocess.run(["notify-send", title, message], check=False)
    else:
        print(f"[NOTIFY] {title}: {message}")


def open_app(name: str):
    system = platform.system()
    if system == "Darwin":
        subprocess.Popen(["open", "-a", name])
    elif system == "Linux":
        subprocess.Popen([name])
    elif system == "Windows":
        subprocess.Popen(["start", name], shell=True)
    else:
        raise RuntimeError(f"open_app not supported on {system}")


def execute_step(step: dict):
    action = step.get("action")
    if action == "open_url":
        url = step["url"]
        webbrowser.open(url)
        return {"ok": True, "url": url}

    if action == "open_app":
        open_app(step["name"])
        return {"ok": True, "app": step["name"]}

    if action == "type_text":
        if not pyautogui:
            return {"error": "pyautogui not available"}
        text = step.get("text", "")
        interval = step.get("interval", 0.03)
        pyautogui.write(text, interval=interval)
        return {"ok": True, "typed_len": len(text)}

    if action == "hotkey":
        if not pyautogui:
            return {"error": "pyautogui not available"}
        keys = step.get("keys", [])
        pyautogui.hotkey(*keys)
        return {"ok": True, "keys": keys}

    if action == "notify":
        notify(step.get("title", "PULT"), step.get("message", ""))
        return {"ok": True}

    if action == "wait":
        ms = step.get("ms", 1000)
        time.sleep(ms / 1000)
        return {"ok": True, "waited_ms": ms}

    return {"error": f"Unknown or unsupported action: {action}"}


def main():
    parser = argparse.ArgumentParser(description="PULT Desktop Agent")
    parser.add_argument("--plan", type=str, help="Path to JSON plan file")
    parser.add_argument("--dry-run", action="store_true", help="Only print what would be done")
    args = parser.parse_args()

    if args.plan:
        plan = json.loads(Path(args.plan).read_text(encoding="utf-8"))
    else:
        plan = json.load(sys.stdin)

    steps = plan.get("steps", [])
    print(f"Plan has {len(steps)} steps. Review carefully.")
    if not args.dry_run:
        input("Press Enter to execute (Ctrl+C to cancel)...")

    results = []
    for i, step in enumerate(steps, 1):
        print(f"[{i}/{len(steps)}] {step.get('action')} ...")
        if args.dry_run:
            results.append({"dry_run": True, "step": step})
            continue
        try:
            res = execute_step(step)
            results.append(res)
            if "error" in res:
                print("  ERROR:", res["error"])
                break
            print("  OK")
        except Exception as e:
            results.append({"error": str(e)})
            print("  EXCEPTION:", e)
            break

    print(json.dumps(results, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
