FROM ghcr.io/puppeteer/puppeteer:22.10.0

# Configure Puppeteer to use the pre-installed stable Chrome binary inside the container
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable \
    PORT=7860

WORKDIR /usr/src/app

# Copy dependency mappings
COPY package*.json ./

# Install packages smoothly inside the container
RUN npm ci

# Copy the remaining application source files
COPY . .

# Hugging Face Security Rule: Force the container to drop root execution 
# and use the safe, non-privileged 'node' user account pre-configured in the image
USER node

EXPOSE 7860

CMD [ "node", "server.js" ]
