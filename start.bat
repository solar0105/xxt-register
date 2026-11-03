@echo off
chcp 65001 >nul
title 学习通签到助手
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  [!] 没找到 Node.js，请先安装： https://nodejs.org/
  echo.
  pause
  exit /b 1
)

echo.
echo  启动中...  浏览器会自动打开，手机请用同网段访问下面显示的地址
echo  设置访问口令：  set PIN=你的口令 ^&^& start.bat
echo.

start "" http://127.0.0.1:8686
node server.js

pause
