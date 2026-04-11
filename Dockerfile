# Build stage: client
FROM node:20-alpine AS client-builder
WORKDIR /app/client
COPY client/package*.json ./
RUN npm install
COPY client/ ./
RUN npm run build

# Build stage: server
FROM node:20-alpine AS server-builder
WORKDIR /app/server
COPY server/package*.json ./
# node-pty requires node-gyp; install python/make for build
RUN apk add --no-cache python3 make g++
RUN npm install
COPY server/ ./
RUN npm run build

# Final stage
FROM node:20-alpine
WORKDIR /app

# Install node-pty runtime dependencies
RUN apk add --no-cache python3 make g++ git

# Copy server build
COPY --from=server-builder /app/server/node_modules ./server/node_modules
COPY --from=server-builder /app/server/dist ./server/dist
COPY server/package*.json ./server/

# Copy client build into server's static dir
COPY --from=client-builder /app/client/dist ./client/dist

WORKDIR /app/server

EXPOSE 3001

ENV NODE_ENV=production

CMD ["node", "dist/index.js"]
