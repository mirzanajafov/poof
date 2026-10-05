FROM node:24-bookworm-slim AS manifests
RUN npm install -g pnpm@11.21.0
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json .pnpmfile.cjs ./
COPY packages/db/package.json packages/db/
COPY packages/tracing/package.json packages/tracing/
COPY apps/api/package.json apps/api/

FROM manifests AS build
RUN pnpm install --frozen-lockfile --filter "@poof/api..."
COPY packages/db packages/db
COPY packages/tracing packages/tracing
COPY apps/api apps/api
RUN pnpm --filter "@poof/api..." build

FROM manifests AS runtime
RUN CI=true pnpm install --prod --frozen-lockfile --filter "@poof/api..." \
  && find node_modules/.pnpm -path "*/@prisma/client/runtime/*" \( -name "*.map" -o \( -name "query_compiler_*" ! -name "*postgresql*" \) \) -delete
COPY --from=build /app/packages/db/dist packages/db/dist
COPY --from=build /app/packages/tracing/dist packages/tracing/dist
COPY --from=build /app/apps/api/dist apps/api/dist

FROM node:24-bookworm-slim
ENV NODE_ENV=production
COPY --from=runtime /app /app
WORKDIR /app/apps/api
USER node
EXPOSE 3111
CMD ["node", "dist/main.js"]
