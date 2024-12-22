#!/bin/bash

# Цвета для вывода
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🔄 Pulling latest changes from git...${NC}"
git pull

echo -e "${BLUE}🧹 Cleaning up old containers and cache...${NC}"
# Остановка всех контейнеров проекта
docker-compose down

# Удаление всех неиспользуемых контейнеров, сетей, образов и volumes
docker system prune -af --volumes

echo -e "${BLUE}🏗️  Building new containers...${NC}"
# Builds the images with no cache
docker-compose build --no-cache

echo -e "${BLUE}🚀 Starting containers in background...${NC}"
# Запуск контейнеров в фоновом режиме
docker-compose up -d

# Ждем готовности базы данных
echo -e "${BLUE}⏳ Waiting for database to be ready...${NC}"
sleep 10

# Проверяем статус контейнеров
echo -e "${BLUE}📊 Container status:${NC}"
docker-compose ps

# Показываем логи для проверки
echo -e "${BLUE}📜 Recent logs:${NC}"
docker-compose logs --tail=50

echo -e "${GREEN}✅ Deployment complete!${NC}"
echo -e "${GREEN}🌐 Application should be available at http://localhost:3000${NC}"
