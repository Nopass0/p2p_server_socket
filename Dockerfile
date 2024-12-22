# Dockerfile
FROM oven/bun:1.0

WORKDIR /app

# Copy package files
COPY package.json bun.lockb ./

# Install dependencies
RUN bun install

# Copy prisma schema and generate client
COPY prisma ./prisma/
RUN bunx prisma generate

# Copy source code
COPY . .

# Expose the port your app runs on
EXPOSE 3000

# Start the application
CMD ["bun", "run", "src/app.ts"]
