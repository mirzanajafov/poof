FROM node:24-bookworm-slim
RUN npm install -g pnpm@11.21.0
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile && pnpm -r build
CMD ["pnpm", "-r", "test"]
