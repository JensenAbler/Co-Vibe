# Co Vibe — unified server Docker image
# Builds frontend + runs Express server with Agent SDK

FROM node:22-slim

WORKDIR /app

# Install frontend dependencies and build
COPY frontend/package.json frontend/package-lock.json* ./frontend/
RUN cd frontend && npm ci

COPY frontend/ ./frontend/
RUN cd frontend && npm run build

# Install server dependencies
COPY server/package.json server/package-lock.json* ./server/
RUN cd server && npm ci

COPY server/ ./server/

# Expose port (Railway sets PORT env var)
EXPOSE 3001

# Start the server from the server directory so tsx is resolvable
WORKDIR /app/server
CMD ["node", "--import", "tsx", "index.ts"]
