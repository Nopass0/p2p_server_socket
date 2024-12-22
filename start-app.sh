#!/bin/bash

# Генерируем Prisma client
echo "Generating Prisma client..."
PRISMA_CLIENT_ENGINE_TYPE=binary bunx prisma generate

# Очищаем кэш node_modules
echo "Cleaning node_modules cache..."
rm -rf node_modules/.prisma

# Применяем миграции
echo "Pushing database changes..."
bunx prisma db push

# Запускаем приложение
echo "Starting application..."
NODE_ENV=production bun run src/app.ts
