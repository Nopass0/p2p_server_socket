FROM oven/bun:1.0
WORKDIR /app

# Install dependencies
COPY package.json bun.lockb ./
RUN bun install
RUN bunx prisma db pull

# Generate Prisma client
COPY prisma ./prisma/
RUN bunx prisma generate

# Copy source code - добавляем эту строку
COPY . .

# Expose the port your app runs on
EXPOSE 3000

# Start the application
CMD ["bun", "run", "src/app.ts"]
