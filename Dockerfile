FROM oven/bun:1.0
WORKDIR /app

# Install required tools
RUN apt-get update && \
    apt-get install -y \
    netcat-openbsd \
    dnsutils \
    && rm -rf /var/lib/apt/lists/*

# Copy all files
COPY . .

# Install dependencies
RUN bun install

# Generate Prisma client
RUN bunx prisma generate

# Make wait script executable
RUN chmod +x /app/wait-for-it.sh

# Expose port
EXPOSE 3000

# Start command
CMD ["/app/wait-for-it.sh", "postgres:5432", "--", "sh", "-c", "cd /app && bunx prisma generate && bunx prisma db push && bun run src/app.ts"]
