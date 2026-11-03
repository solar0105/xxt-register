#!/data/data/com.termux/files/usr/bin/bash
# ============================================================
#  开机自启（可选）
#
#  需要装 Termux:Boot 这个插件（同样是 F-Droid 版）：
#    https://f-droid.org/packages/com.termux.boot/
#
#  装好后在 Termux 里执行：
#    mkdir -p ~/.termux/boot
#    cp termux-boot.sh ~/.termux/boot/10-cx-sign.sh
#    chmod +x ~/.termux/boot/10-cx-sign.sh
#
#  之后手机重启会自动把签到服务拉起来。
# ============================================================

# 改成你实际的安装路径
APP_DIR="$HOME/cx-sign"
PORT=8686

termux-wake-lock 2>/dev/null || true

cd "$APP_DIR" 2>/dev/null || exit 1

# 已经在跑就不重复启动
if command -v pgrep >/dev/null 2>&1 && pgrep -f "node server.js" >/dev/null 2>&1; then
  exit 0
fi

PORT="$PORT" nohup node server.js >> "$APP_DIR/nohup.log" 2>&1 &
