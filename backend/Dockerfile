# backend: Node + Fastify รันด้วย tsx (ไม่ต้องมีขั้น build)
FROM node:22-alpine
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile
COPY . .
# backend รันด้วย user node จึงต้องเตรียมโฟลเดอร์ runtime ให้เขียนได้ก่อนลดสิทธิ์
# ownership นี้จะถูกนำไปใช้ตอน Docker สร้าง named volume ครั้งแรกด้วย
RUN mkdir -p /app/uploads && chown -R node:node /app/uploads
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4802 \
    TZ=Asia/Bangkok
USER node
EXPOSE 4802
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:4802/api/health || exit 1
# ตอนเริ่มจะรัน migration ใน ./drizzle ให้อัตโนมัติ
CMD ["node", "--import", "tsx", "src/server.ts"]
