FROM node:24.22.0-bookworm-slim
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
WORKDIR /tests
COPY package.json package-lock.json ./
RUN npm ci \
    && npx --no-install playwright install --with-deps --only-shell chromium \
    && rm -rf /var/lib/apt/lists/*
COPY playwright.config.js wait-ready.js ./
COPY tests/ ./tests/
CMD ["npm", "test"]
