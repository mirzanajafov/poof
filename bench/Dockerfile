FROM node:24-bookworm-slim
RUN npm install -g pnpm@11.21.0
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json .pnpmfile.cjs ./
COPY packages/contracts/package.json packages/contracts/
COPY packages/core/package.json packages/core/
COPY packages/imaging/package.json packages/imaging/
COPY bench/package.json bench/
RUN pnpm install --frozen-lockfile --filter "@poof/bench..."
COPY packages/contracts packages/contracts
COPY packages/core packages/core
COPY packages/imaging packages/imaging
COPY bench bench
RUN pnpm --filter "@poof/bench..." build
