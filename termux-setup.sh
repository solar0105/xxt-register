#!/data/data/com.termux/files/usr/bin/bash
# ============================================================
#  学习通签到助手 · 在安卓手机上直接运行（Termux）
#  用法：  bash termux-setup.sh
# ============================================================
set -u
cd "$(dirname "$0")" || exit 1

BOLD=$'\033[1m'; DIM=$'\033[2m'; RED=$'\033[31m'; GRN=$'\033[32m'
YEL=$'\033[33m'; CYA=$'\033[36m'; RST=$'\033[0m'

say()  { printf '%s\n' "$*"; }
ok()   { printf '%s✓%s %s\n' "$GRN" "$RST" "$*"; }
warn() { printf '%s!%s %s\n' "$YEL" "$RST" "$*"; }
die()  { printf '%s✗ %s%s\n' "$RED" "$*" "$RST"; exit 1; }

PORT="${PORT:-8686}"

say ""
say "${CYA}============================================${RST}"
say "${BOLD} 学习通签到助手 · 手机本地部署${RST}"
say "${CYA}============================================${RST}"
say ""

# ---------- 0. 环境检查 ----------
case "${PREFIX:-}" in
  *com.termux*) ;;
  *) warn "看起来不是 Termux 环境（PREFIX=${PREFIX:-空}）。"
     warn "如果你是在别的 Linux 上跑，这脚本也能用，忽略即可。";;
esac

if [ ! -f server.js ] || [ ! -d lib ]; then
  die "当前目录没有 server.js / lib，请在解压出来的目录里运行本脚本。
     正确做法：
       tar xzf cx-sign-phone.tar.gz -C ~/cx-sign
       cd ~/cx-sign && bash termux-setup.sh"
fi
ok "文件完整（$(ls lib | wc -l) 个模块）"

# ---------- 1. Node.js ----------
say ""
say "${BOLD}[1/4] 检查 Node.js${RST}"
if command -v node >/dev/null 2>&1; then
  ok "已安装 Node $(node -v)"
else
  say "  没装，开始安装（需要联网，约 1~3 分钟）…"
  pkg install -y nodejs || die "安装失败。先跑一次  pkg update  再重试"
  command -v node >/dev/null 2>&1 || die "装完了也找不到 node，试试重开一个 Termux 窗口"
  ok "已安装 Node $(node -v)"
fi

NODE_MAJOR=$(node -v | sed 's/^v\([0-9]*\).*/\1/')
if [ "$NODE_MAJOR" -lt 18 ]; then
  die "Node 版本太低（$NODE_MAJOR），需要 18 以上。跑  pkg upgrade  或重装 Termux。"
fi

# ---------- 2. 自检 ----------
say ""
say "${BOLD}[2/4] 加密链路自检${RST}"
if node test/selftest.js >/tmp/cx-selftest.log 2>&1; then
  ok "7 项全部通过（AES / RSA / 签名 / 坐标）"
else
  warn "自检有失败项，把下面内容发我："
  cat /tmp/cx-selftest.log
fi

# ---------- 3. 防休眠 ----------
say ""
say "${BOLD}[3/4] 防止后台被杀${RST}"
if command -v termux-wake-lock >/dev/null 2>&1; then
  termux-wake-lock && ok "已获取唤醒锁"
else
  warn "没有 termux-wake-lock，跳过"
fi

warn "还必须手动做一次（否则跑几小时会被系统杀掉）："
say "     设置 → 应用 → Termux → 电池 → 选「无限制」"
say "     设置 → 应用 → Termux → 电池 → 允许后台活动（部分机型有）"

# ---------- 4. 启动 ----------
say ""
say "${BOLD}[4/4] 启动服务${RST}"
say ""
say "${CYA}============================================${RST}"
say "  服务地址： ${BOLD}http://127.0.0.1:${PORT}${RST}"
say "  在手机浏览器里打开它"
say ""
say "  想加到桌面：浏览器菜单 → 添加到主屏幕"
say "  停止服务：  Ctrl + C   （或直接划掉 Termux）"
say "${CYA}============================================${RST}"
say ""

if command -v termux-open-url >/dev/null 2>&1; then
  ( sleep 2; termux-open-url "http://127.0.0.1:${PORT}" >/dev/null 2>&1 ) &
fi

export PORT
exec node server.js
