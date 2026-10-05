FROM node:24-bookworm-slim AS manifests
RUN npm install -g pnpm@11.21.0
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json .pnpmfile.cjs ./
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/imaging/package.json packages/imaging/
COPY packages/worker/package.json packages/worker/
COPY apps/supervisor/package.json apps/supervisor/

FROM manifests AS migrate-deps
RUN pnpm install --frozen-lockfile --filter "@poof/db"
COPY packages/db packages/db

FROM node:24-bookworm-slim AS migrate
COPY --from=migrate-deps /app /app
WORKDIR /app/packages/db
CMD ["node_modules/.bin/prisma", "migrate", "deploy"]

FROM manifests AS build
RUN pnpm install --frozen-lockfile --filter "@poof/supervisor..."
COPY packages/core packages/core
COPY packages/db packages/db
COPY packages/imaging packages/imaging
COPY packages/worker packages/worker
COPY apps/supervisor apps/supervisor
RUN pnpm --filter "@poof/supervisor..." build

FROM manifests AS runtime
RUN CI=true pnpm install --prod --frozen-lockfile --filter "@poof/supervisor..." \
  && find node_modules/.pnpm -path "*/@prisma/client/runtime/*" \( -name "*.map" -o \( -name "query_compiler_*" ! -name "*postgresql*" \) \) -delete
COPY --from=build /app/packages/core/dist packages/core/dist
COPY --from=build /app/packages/db/dist packages/db/dist
COPY --from=build /app/packages/imaging/dist packages/imaging/dist
COPY --from=build /app/packages/worker/dist packages/worker/dist
COPY --from=build /app/apps/supervisor/dist apps/supervisor/dist

FROM node:24-bookworm-slim
ENV NODE_ENV=production
COPY --from=runtime /app /app
WORKDIR /app/apps/supervisor
USER node
EXPOSE 3110
CMD ["node", "dist/main.js"]
