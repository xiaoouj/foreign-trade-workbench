# 外贸人工作台消息接入端镜像
# 国内构建如拉取 node 基础镜像超时，可把 FROM 改为 docker.1ms.run/library/node:22-slim
FROM node:22-slim

WORKDIR /app
COPY package.json ./
# 不生成 lock 文件，降低对构建网络的要求
RUN npm install --omit=dev --no-package-lock
COPY whatsapp-connector.mjs email-connector.mjs ./

# CONNECTOR=whatsapp | email，由 docker-compose 按服务指定
ENV CONNECTOR=whatsapp
CMD ["sh", "-c", "node ${CONNECTOR}-connector.mjs"]
