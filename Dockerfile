FROM oven/bun:1.0
WORKDIR /app

# Install required tools
RUN apt-get update && \
    apt-get install -y \
    netcat-openbsd \
    dnsutils \
    && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package.json bun.lockb ./
RUN bun install

# Copy prisma schema
COPY prisma ./prisma/

# Copy all other files
COPY . .

# Generate Prisma client
RUN bunx prisma generate

# Make scripts executable
RUN chmod +x /app/wait-for-it.sh /app/start-app.sh

EXPOSE 3000

# Start command
CMD ["bash", "/app/wait-for-it.sh"]
