@echo off
chcp 65001 >nul
title 学习通签到助手 · USB 通道
cd /d "%~dp0"

echo.
echo  用数据线连手机（绕过校园网隔离）
echo  ============================================
echo.

where adb >nul 2>nul
if errorlevel 1 (
  echo  [!] 没找到 adb。两条路：
  echo.
  echo      1^) 装 Android Platform Tools:
  echo         https://developer.android.com/tools/releases/platform-tools
  echo         解压后把这个文件夹加进 PATH，再重新运行本脚本
  echo.
  echo      2^) 不用 adb，改用手机会点或 Termux，见 README
  echo.
  pause
  exit /b 1
)

echo  手机需要先打开：设置 ^> 关于手机 ^> 连点版本号7次
echo                     ^> 开发者选项 ^> USB 调试
echo.

adb devices
echo.

echo  正在建立反向隧道 127.0.0.1:8686 -^> 本机:8686 ...
adb reverse tcp:8686 tcp:8686
if errorlevel 1 (
  echo.
  echo  [!] 建立失败。检查：手机是否已授权本电脑的 USB 调试弹窗。
  echo.
  pause
  exit /b 1
)

echo.
echo  ============================================
echo    OK。现在用手机浏览器打开：
echo.
echo      http://127.0.0.1:8686
echo.
echo  ============================================
echo.
echo  隧道在拔线或重启 adb 后会失效，失效就重跑本脚本。
echo.

echo  正在启动服务（关掉这个窗口 = 停止服务）...
echo.
node server.js

pause
