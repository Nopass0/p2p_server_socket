FROM oven/bun:1.0

# Устанавливаем git
RUN apt-get update && apt-get install -y git

WORKDIR /app

# Клонируем или обновляем репозиторий
# Предполагается, что репозиторий публичный. Если приватный, нужно добавить креды
COPY . .
RUN git pull

# Install dependencies
COPY package.json bun.lockb ./
RUN bun install

# Generate Prisma client
COPY prisma ./prisma/
RUN bunx prisma generate

# Expose the port your app runs on
EXPOSE 3000

# Start the application
CMD ["bun", "run", "src/app.ts"]
