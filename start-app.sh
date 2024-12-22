#!/bin/bash

# Генерируем Prisma клиент
echo "Generating Prisma client..."
bunx prisma generate

# Применяем миграции
echo "Pushing database changes..."
bunx prisma db push

# Запускаем приложение
echo "Starting application..."
bun run src/app.ts
