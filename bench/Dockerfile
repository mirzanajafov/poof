FROM node:24-bookworm-slim
RUN npm install -g pnpm@11.21.0
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/imaging/package.json packages/imaging/
COPY bench/package.json bench/
RUN pnpm install --frozen-lockfile --filter "@poof/bench..."
COPY packages/imaging packages/imaging
COPY bench bench
RUN pnpm --filter "@poof/bench..." build
