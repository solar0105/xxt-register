# 云服务器部署（24 小时在线，手机随时随地打开）
#
# docker build -t cx-sign .
# docker run -d --name cx-sign --restart=always \
#   -p 8686:8686 -e PIN=改成你的口令 \
#   -v "$PWD/data:/app/data" cx-sign
#
# 手机浏览器访问 http://你的服务器IP:8686 ，输入口令即可。

FROM node:20-alpine

WORKDIR /app

COPY package.json* ./
COPY server.js ./
COPY lib ./lib
COPY public ./public

ENV PORT=8686
ENV HOST=0.0.0.0

# 数据目录挂卷，容器重建也不丢账号和计划
VOLUME ["/app/data"]

EXPOSE 8686

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:8686/manifest.webmanifest >/dev/null || exit 1

CMD ["node", "server.js"]
