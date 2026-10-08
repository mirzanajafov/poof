FROM node:24-bookworm-slim AS build
RUN npm install -g pnpm@11.21.0
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json .pnpmfile.cjs ./
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter "@poof/web..."
COPY apps/web apps/web
COPY packages/sim/results/server packages/sim/results/server
ARG NEXT_PUBLIC_LIVE_URL=
ENV API_URL=http://poof-api:3111 NEXT_PUBLIC_LIVE_URL=${NEXT_PUBLIC_LIVE_URL}
RUN pnpm --filter @poof/web build

FROM node:24-bookworm-slim
ENV NODE_ENV=production PORT=3112 HOSTNAME=0.0.0.0 API_URL=http://poof-api:3111
WORKDIR /app
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /app/apps/web/public ./apps/web/public
USER node
EXPOSE 3112
CMD ["node", "apps/web/server.js"]
