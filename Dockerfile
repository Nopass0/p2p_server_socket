FROM oven/bun:1.0
WORKDIR /app

# Копируем все файлы проекта
COPY . .

# Устанавливаем зависимости
RUN bun install

# Генерируем Prisma клиент
RUN bunx prisma init
RUN bunx prisma db pull
RUN bunx prisma generate

# Expose the port your app runs on
EXPOSE 3000

# Start the application
CMD ["bun", "run", "src/app.ts"]
