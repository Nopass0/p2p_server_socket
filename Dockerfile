FROM oven/bun:1.0
WORKDIR /app

# Install required tools
RUN apt-get update && \
    apt-get install -y \
    netcat-openbsd \
    dnsutils \
    && rm -rf /var/lib/apt/lists/*

# Copy package files first for better caching
COPY package.json bun.lockb ./

# Install dependencies
RUN bun install

# Copy prisma schema
COPY prisma ./prisma/

# Generate Prisma client
RUN bunx prisma generate

# Copy the rest of the application
COPY . .

# Expose the port
EXPOSE 3000

# Create a script to wait for DB and start the app
COPY ./wait-for-it.sh /wait-for-it.sh
RUN chmod +x /wait-for-it.sh

CMD ["/wait-for-it.sh", "postgres:5432", "--", "sh", "-c", "bunx prisma generate && bunx prisma db push && bun run src/app.ts"]
