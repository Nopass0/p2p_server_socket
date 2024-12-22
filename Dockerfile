FROM oven/bun:1.0

WORKDIR /app

# Copy package files first for better caching
COPY package.json bun.lockb ./

# Install dependencies
RUN bun install

# Copy the rest of the application
COPY . .

# Generate Prisma client
RUN bunx prisma generate

# Expose the port
EXPOSE 3000

# Create a script to wait for DB and start the app
COPY ./wait-for-it.sh /wait-for-it.sh
RUN chmod +x /wait-for-it.sh

CMD ["/wait-for-it.sh", "postgres:5432", "--", "bun", "run", "src/app.ts"]
