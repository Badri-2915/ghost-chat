# =============================================================================
# Multi-Stage Dockerfile for Ghost Chat
# =============================================================================
# Stage 1: Build the React frontend with Vite
# Stage 2: Set up the Node.js backend and copy the frontend build output
# =============================================================================

# --------------- STAGE 1: Build React Frontend ---------------
FROM node:20-slim AS frontend-build
WORKDIR /frontend

# Vite embeds environment variables at BUILD TIME
# VITE_API_URL is empty because frontend and backend are on the same domain
ENV VITE_API_URL=""

# Install npm dependencies
COPY frontend/package*.json ./
RUN npm ci

# Copy frontend source code and build
COPY frontend/ .
RUN npm run build
# Output: /frontend/dist/

# --------------- STAGE 2: Node.js Backend + Static Frontend ---------------
FROM node:20-slim
WORKDIR /app

# Install backend dependencies
COPY backend/package*.json ./
RUN npm ci --omit=dev

# Copy backend application code
COPY backend/ .

# Copy the built frontend from Stage 1 into backend's static directory
COPY --from=frontend-build /frontend/dist ./static

# Expose the application port (Render sets PORT dynamically)
EXPOSE 10000

# Run the server
CMD ["node", "src/index.js"]
