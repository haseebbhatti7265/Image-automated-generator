FROM node:18-slim

# System dependencies required by headless Chrome on Debian/Ubuntu.
# These resolve the "Screenshot generation failed" runtime error caused by
# missing shared libraries (libX11, libnss3, libXcomposite, etc.).
RUN apt-get update && apt-get install -y --no-install-recommends \
    libnss3 \
    libnspr4 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    libatspi2.0-0 \
    libxshmfence1 \
    fonts-liberation \
    libx11-6 \
    libxcb1 \
    libxext6 \
    libxss1 \
    ca-certificates \
    wget \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install && npx puppeteer browsers install chrome

COPY . .

ENV PUPPETEER_CACHE_DIR=/root/.cache/puppeteer
EXPOSE 3000

CMD ["node", "server.js"]
