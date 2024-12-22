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

# Make scripts executable
RUN chmod +x /app/wait-for-it.sh && chmod +x /app/start-app.sh

# Expose port
EXPOSE 3000

# Start command
CMD ["bash", "/app/wait-for-it.sh"]
