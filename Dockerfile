FROM node:22-slim

# Install Python 3 + venv support
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-venv \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy full repo (backend calls scripts/ from repo root)
COPY . .

# Set up Python venv + install PyMuPDF
RUN python3 -m venv scripts/.venv && \
    scripts/.venv/bin/pip install --no-cache-dir -r scripts/requirements.txt

# Install backend Node deps
WORKDIR /app/backend
RUN npm ci --omit=dev

EXPOSE 3001

CMD ["node", "server.js"]
