# -------------------------------------------------
# 1. Build stage – install deps, compile assets
# -------------------------------------------------
FROM node:22-alpine AS builder

WORKDIR /app

# Install only production deps (add dev deps if you need a build step)
COPY package*.json ./
RUN npm ci --only=production

# Copy the rest of the source code
COPY . .

# -------------------------------------------------
# 2. Runtime stage – smaller image for execution
# -------------------------------------------------
FROM node:22-alpine

WORKDIR /app

# Pull only the compiled output from the builder
COPY --from=builder /app .

# Expose the port your API listens on (adjust if needed)
EXPOSE 3000

# Default command – you can replace with pm2‑runtime if you still want pm2 inside
CMD ["node", "index.js"]