#!/usr/bin/env bash
# ============================================================
#  学习通签到助手 · 服务器一键部署
#
#  用法（在解压后的目录里执行）：
#      sudo bash deploy.sh
#
#  常用参数：
#      --port=8686        换端口
#      --pin=abc12345     指定访问口令（不指定会自动生成）
#      --dry-run          只打印将要做什么，不实际执行
#      --uninstall        卸载服务（保留数据）
# ============================================================
set -euo pipefail

# 允许从任意目录调用：先切到脚本自己所在的目录，
# 否则下面的相对路径自检会失败
cd "$(dirname "$0")" || { echo "无法进入脚本所在目录"; exit 1; }

APP_NAME="cx-sign"
APP_DIR="/opt/cx-sign"
ENV_FILE="/etc/cx-sign.env"
SERVICE="/etc/systemd/system/cx-sign.service"
RUN_USER="cxsign"
NODE_MAJOR="20"
PORT="8686"
PIN=""
DRY=0
DO_UNINSTALL=0

BOLD=$'\033[1m'; DIM=$'\033[2m'; RED=$'\033[31m'; GRN=$'\033[32m'
YEL=$'\033[33m'; CYA=$'\033[36m'; RST=$'\033[0m'

say()  { printf '%s\n' "$*"; }
step() { printf '\n%s==> %s%s\n' "$BOLD" "$*" "$RST"; }
ok()   { printf '  %s✓%s %s\n' "$GRN" "$RST" "$*"; }
info() { printf '  %s·%s %s\n' "$DIM" "$RST" "$*"; }
warn() { printf '  %s!%s %s\n' "$YEL" "$RST" "$*"; }
die()  { printf '\n%s✗ %s%s\n' "$RED" "$*" "$RST"; exit 1; }

run() {
  if [ "$DRY" -eq 1 ]; then
    printf '  %s[dry]%s %s\n' "$CYA" "$RST" "$*"
  else
    eval "$@"
  fi
}

# ---------- 参数 ----------
for a in "$@"; do
  case "$a" in
    --port=*)      PORT="${a#*=}" ;;
    --pin=*)       PIN="${a#*=}" ;;
    --dry-run)     DRY=1 ;;
    --uninstall)   DO_UNINSTALL=1 ;;
    -h|--help)     sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *)             die "未知参数：$a（用 --help 看用法）" ;;
  esac
done

say ""
say "${CYA}============================================${RST}"
say "${BOLD}  学习通签到助手 · 服务器部署${RST}"
say "${CYA}============================================${RST}"

# ---------- 卸载 ----------
if [ "$DO_UNINSTALL" -eq 1 ]; then
  step "卸载"
  [ "$(id -u)" -eq 0 ] || die "请用 root 执行：sudo bash deploy.sh --uninstall"
  systemctl stop "$APP_NAME" 2>/dev/null || true
  systemctl disable "$APP_NAME" 2>/dev/null || true
  rm -f "$SERVICE"; systemctl daemon-reload 2>/dev/null || true
  ok "服务已移除"
  warn "数据保留在 $APP_DIR/data（要彻底删除：rm -rf $APP_DIR）"
  exit 0
fi

# ---------- 0. 自检 ----------
step "0/6 环境检查"
[ -f server.js ] && [ -d routes ] && [ -d lib ] && [ -d public ] \
  || die "当前目录不是程序目录（现在在 $(pwd)）。请在解压出来的文件夹里运行本脚本。

  正确做法：
    mkdir -p /opt/cx-sign
    tar xzf cx-sign-phone.tar.gz -C /opt/cx-sign
    cd /opt/cx-sign && sudo bash deploy.sh"
ok "程序文件完整"

case "$(uname -m)" in
  x86_64|aarch64|armv7l|arm64) ok "架构 $(uname -m)" ;;
  *) warn "未测试的架构 $(uname -m)，大概率也能跑" ;;
esac

if [ ! -f /etc/os-release ]; then
  warn "认不出发行版，后续自动安装可能失败"
  DISTRO="unknown"
else
  . /etc/os-release
  DISTRO="${ID:-unknown}"
  ok "系统 ${PRETTY_NAME:-$DISTRO}"
fi

if [ "$(id -u)" -eq 0 ]; then
  ok "root 权限"
  SUDO=""
elif [ "$DRY" -eq 1 ]; then
  SUDO="sudo"
  ok "非 root，dry-run 演示模式继续"
else
  command -v sudo >/dev/null 2>&1 || die "需要 root 或 sudo 权限"
  sudo -n true 2>/dev/null || die "sudo 需要密码。请直接以 root 运行：
    su - 然后重跑，或者用 sudo bash deploy.sh 并手动输入密码。"
  SUDO="sudo"
  ok "sudo 可用"
fi

if [ "$DRY" -eq 1 ]; then
  step "DRY-RUN 模式：只打印，不执行"
fi

# ---------- 1. Node ----------
step "1/6 Node.js"
NEED_INSTALL=0
if command -v node >/dev/null 2>&1; then
  CUR_MAJOR="$(node -v | sed 's/^v\([0-9]*\).*/\1/')"
  if [ "$CUR_MAJOR" -ge 18 ]; then
    ok "已安装 Node $(node -v)"
  else
    warn "Node $(node -v) 太旧，需要升到 $NODE_MAJOR"
    NEED_INSTALL=1
  fi
else
  info "未安装 Node.js，准备安装 $NODE_MAJOR.x"
  NEED_INSTALL=1
fi

if [ "$NEED_INSTALL" -eq 1 ]; then
  case "$DISTRO" in
    ubuntu|debian)
      info "使用 NodeSource 源安装 Node $NODE_MAJOR"
      run "curl -fsSL https://deb.nodesource.com/setup_${NODE_MAJOR}.x | $SUDO bash -"
      run "$SUDO apt-get install -y nodejs"
      ;;
    centos|rhel|fedora|rocky|almalinux|openeuler|anolis)
      info "使用 dnf 模块安装 Node $NODE_MAJOR"
      run "$SUDO dnf install -y curl"
      run "curl -fsSL https://rpm.nodesource.com/setup_${NODE_MAJOR}.x | $SUDO bash -"
      run "$SUDO dnf install -y nodejs"
      ;;
    alpine)
      run "$SUDO apk add --no-cache nodejs"
      ;;
    arch|manjaro)
      run "$SUDO pacman -Sy --noconfirm nodejs npm"
      ;;
    *)
      die "不认识的发行版（$DISTRO）。请手动装 Node 18+ 再重跑本脚本。
      任意系统都可以用官方二进制包：
        curl -fsSL https://nodejs.org/dist/v$NODE_MAJOR.11.0/node-v$NODE_MAJOR.11.0-linux-x64.tar.xz \\
          | sudo tar xJ -C /usr/local --strip-components=1"
      ;;
  esac
  if [ "$DRY" -eq 0 ]; then
    command -v node >/dev/null 2>&1 || die "安装后仍找不到 node，请重开终端再试"
    ok "已安装 Node $(node -v)"
  fi
fi

# ---------- 2. 口令 ----------
step "2/6 访问口令"
if [ -z "$PIN" ]; then
  if command -v openssl >/dev/null 2>&1; then
    PIN="$(openssl rand -hex 6)"
  else
    PIN="$(head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n' | cut -c1-12)"
  fi
  info "未指定口令，已随机生成"
fi
[ ${#PIN} -ge 6 ] || die "口令太短（至少 6 位）"
ok "口令：${BOLD}${PIN}${RST}  ${DIM}(记得存下来)${RST}"

# ---------- 3. 部署文件 ----------
step "3/6 安装程序到 $APP_DIR"
if [ "$DRY" -eq 0 ] && ! id "$RUN_USER" >/dev/null 2>&1; then
  run "$SUDO useradd --system --no-create-home --shell /usr/sbin/nologin $RUN_USER || true"
  ok "已创建运行用户 $RUN_USER"
fi

run "$SUDO mkdir -p $APP_DIR"
# 保留已有 data 目录
if [ -d "$APP_DIR/data" ]; then
  info "检测到已有数据，保留 $APP_DIR/data"
  KEEP_DATA=1
else
  KEEP_DATA=0
fi

# 如果脚本本身就跑在 $APP_DIR 里（比如 git clone 到 /opt/cx-sign 后直接执行），
# 绝不能 rm -rf 再 cp —— 那会先把源文件删掉，然后无文件可拷。
SRC_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR_REAL="$(readlink -f "$APP_DIR" 2>/dev/null || printf '%s' "$APP_DIR")"
if [ "$SRC_DIR" = "$APP_DIR_REAL" ]; then
  info "脚本已在 $APP_DIR 内运行，原地安装，跳过复制"
else
  for item in server.js routes lib public test; do
    run "$SUDO rm -rf $APP_DIR/$item"
    run "$SUDO cp -a ./$item $APP_DIR/"
  done
  run "$SUDO cp -a ./README.md $APP_DIR/ 2>/dev/null || true"
fi
# data 目录必须无条件存在：systemd 单元里的 ReadWritePaths 指向不存在的路径，
# 会导致 ProtectSystem=strict 建不了命名空间，服务起不来（日志里连 node 的报错都没有）
run "$SUDO mkdir -p $APP_DIR/data"
ok "文件已就位"

run "$SUDO chown -R $RUN_USER:$RUN_USER $APP_DIR"
run "$SUDO chmod 700 $APP_DIR/data 2>/dev/null || true"

# ---------- 4. 环境变量 ----------
step "4/6 写入配置"
run "printf 'PORT=%s\nPIN=%s\nHOST=0.0.0.0\n' '$PORT' '$PIN' | $SUDO tee $ENV_FILE >/dev/null"
run "$SUDO chmod 600 $ENV_FILE"
ok "配置 $ENV_FILE（权限 600，只有 root 可读）"

# ---------- 5. systemd ----------
step "5/6 注册开机自启服务"
UNIT_CONTENT="[Unit]
Description=Chaoxing Sign Assistant
Documentation=file://$APP_DIR/README.md
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$RUN_USER
Group=$RUN_USER
WorkingDirectory=$APP_DIR
EnvironmentFile=$ENV_FILE
ExecStart=$(command -v node || echo /usr/bin/node) $APP_DIR/server.js
Restart=always
RestartSec=3
StandardOutput=journal
StandardError=journal

# 基础加固
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$APP_DIR/data
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true

[Install]
WantedBy=multi-user.target"

if [ "$DRY" -eq 1 ]; then
  printf '  %s[dry]%s 写入 %s 内容：\n' "$CYA" "$RST" "$SERVICE"
  printf '%s\n' "$UNIT_CONTENT" | sed 's/^/      /'
else
  printf '%s\n' "$UNIT_CONTENT" | $SUDO tee "$SERVICE" >/dev/null
fi

run "$SUDO systemctl daemon-reload"
run "$SUDO systemctl enable $APP_NAME >/dev/null 2>&1 || true"
run "$SUDO systemctl restart $APP_NAME"
ok "服务已启动并设为开机自启"

# ---------- 6. 防火墙 ----------
step "6/6 放行端口 $PORT"
if command -v ufw >/dev/null 2>&1 && $SUDO ufw status 2>/dev/null | grep -q "Status: active"; then
  run "$SUDO ufw allow $PORT/tcp >/dev/null"
  ok "ufw 已放行 $PORT/tcp"
elif command -v firewall-cmd >/dev/null 2>&1 && $SUDO firewall-cmd --state 2>/dev/null | grep -q running; then
  run "$SUDO firewall-cmd --permanent --add-port=$PORT/tcp >/dev/null"
  run "$SUDO firewall-cmd --reload >/dev/null"
  ok "firewalld 已放行 $PORT/tcp"
else
  info "未检测到启用的本机防火墙，跳过"
fi

# ---------- 收尾 ----------
if [ "$DRY" -eq 0 ]; then
  sleep 2
  if $SUDO systemctl is-active --quiet "$APP_NAME"; then
    ok "服务运行中"
  else
    warn "服务没起来，看日志：sudo journalctl -u $APP_NAME -n 50 --no-pager"
  fi
  # 本机自测
  if command -v curl >/dev/null 2>&1; then
    if [ "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/ping" || true)" = "200" ]; then
      ok "本机探针通过（/ping = pong）"
    else
      warn "本机探针失败，可能端口被占用"
    fi
  fi
fi

IP=""
if [ "$DRY" -eq 0 ]; then
  IP="$(curl -s --max-time 3 https://api.ipify.org 2>/dev/null || true)"
fi
[ -n "$IP" ] || IP="<你的服务器公网IP>"

say ""
say "${GRN}============================================${RST}"
say "${BOLD}  部署完成${RST}"
say "${GRN}============================================${RST}"
say ""
say "  打开： ${BOLD}http://${IP}:${PORT}${RST}"
say "  口令： ${BOLD}${PIN}${RST}"
say ""
say "  ${DIM}第一次打开会让你输口令，输完就是这个工具的主界面。${RST}"
say ""
say "  ${BOLD}常用命令${RST}"
say "    看日志   sudo journalctl -u $APP_NAME -f"
say "    重启     sudo systemctl restart $APP_NAME"
say "    停止     sudo systemctl stop $APP_NAME"
say "    改口令   编辑 $ENV_FILE 后  sudo systemctl restart $APP_NAME"
say "    更新代码 重新上传后重跑本脚本（数据不丢）"
say ""
say "  ${YEL}如果外网还是打不开${RST}：云厂商的安全组要单独放行 ${PORT} 端口"
say "  （阿里云/腾讯云/华为云控制台 → 安全组 → 入方向 → 添加 ${PORT}）"
say ""
