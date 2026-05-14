#!/usr/bin/env python3
"""connect_card.py — Print a connection card for the user."""
import argparse
import socket
import subprocess
from textwrap import wrap


def get_lan_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "unknown"


def get_tailscale_ip():
    try:
        r = subprocess.run(["tailscale", "ip", "-4"], capture_output=True, text=True, timeout=5)
        if r.returncode == 0:
            return r.stdout.strip()
    except Exception:
        pass
    return None


def box_line(text=""):
    width = 48
    clipped = text[:width]
    print("║  " + clipped.ljust(width) + "║")


def box_wrapped(label, value):
    text = f"{label}: {value}"
    for idx, part in enumerate(wrap(text, width=48) or [""]):
        box_line(part if idx == 0 else "  " + part)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--server-port", type=int, default=8795)
    p.add_argument("--pwa-port", type=int, default=5174)
    p.add_argument("--secret", default="")
    p.add_argument("--deployment", default="local")
    args = p.parse_args()

    lan_ip = get_lan_ip()
    ts_ip = get_tailscale_ip()

    print()
    print("╔══════════════════════════════════════════════════╗")
    print("║          CcCompanion · Connection Card          ║")
    print("╠══════════════════════════════════════════════════╣")

    if args.deployment == "local":
        box_wrapped("PWA", f"http://localhost:{args.pwa_port}")
        box_wrapped("Server", f"http://localhost:{args.server_port}")
        box_line("Auth: disabled (local dev)")
    elif args.deployment == "lan":
        box_wrapped("PWA", f"http://{lan_ip}:{args.pwa_port}")
        box_wrapped("Server", f"http://{lan_ip}:{args.server_port}")
        if args.secret:
            box_wrapped("Secret", args.secret)
    elif args.deployment == "tailscale":
        ip = ts_ip or lan_ip
        box_wrapped("PWA", f"http://{ip}:{args.pwa_port}")
        box_wrapped("Server", f"http://{ip}:{args.server_port}")
        if args.secret:
            box_wrapped("Secret", args.secret)
    else:
        box_line(f"Configure tunnel to forward :{args.server_port}")
        box_line(f"PWA runs on :{args.pwa_port}")
        if args.secret:
            box_wrapped("Secret", args.secret)

    print("╠══════════════════════════════════════════════════╣")
    print("║  1. 手机浏览器打开 PWA 地址                      ║")
    print("║  2. Settings -> 填 Server URL + Secret           ║")
    print('║  3. 点"一键连接本机"或"测试连接"                  ║')
    print("║  4. 回到 Chat 开始对话                           ║")
    print("╚══════════════════════════════════════════════════╝")
    print()


if __name__ == "__main__":
    main()
