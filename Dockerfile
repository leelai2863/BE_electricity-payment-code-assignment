# Build & runtime: Node 20 + tsx (khớp package.json "start").
FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
COPY packages ./packages
RUN npm ci

COPY tsconfig.json ./
COPY src ./src

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:3001/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["npx", "tsx", "src/index.ts"]
