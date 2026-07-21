# Qtonix Site Analysis — single-image build for Railway.
#
# Why a Dockerfile: Railway's auto-detector kept guessing "static site" and
# running only the frontend. A Dockerfile is explicit and always respected, so
# this builds the WHOLE app the right way: install the backend, build the React
# frontend, install WeasyPrint + the Plus Jakarta Sans fonts (needed for the
# PDF), then start the Node server (which also serves the built frontend).

FROM node:20-bookworm-slim

# 1. System libraries WeasyPrint needs, plus Python, curl, fontconfig, MySQL client.
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 python3-pip python3-venv \
      libpango-1.0-0 libpangoft2-1.0-0 libcairo2 libgdk-pixbuf-2.0-0 libffi-dev \
      fontconfig curl default-mysql-client \
    && rm -rf /var/lib/apt/lists/*

# 2. WeasyPrint (the PDF engine the report renderer calls).
RUN pip3 install --no-cache-dir --break-system-packages weasyprint

# 3. Plus Jakarta Sans fonts, so the PDF matches the brand design.
RUN mkdir -p /usr/share/fonts/truetype/jakarta \
    && BASE="https://raw.githubusercontent.com/tokotype/PlusJakartaSans/master/fonts/ttf" \
    && for f in Regular Medium Bold ExtraBold; do \
         curl -sfL -o /usr/share/fonts/truetype/jakarta/PlusJakartaSans-$f.ttf \
           "$BASE/PlusJakartaSans-$f.ttf"; \
       done \
    && fc-cache -f

WORKDIR /app

# 4. Install BACKEND dependencies (root package.json).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev || npm install --omit=dev

# 5. Install + build the FRONTEND (client/), producing client/dist.
COPY client/package.json client/package-lock.json* ./client/
RUN cd client && (npm ci || npm install)
COPY client ./client
RUN cd client && npm run build

# 6. Copy the rest of the backend source.
COPY . .

# 7. Railway provides PORT at runtime; the server reads process.env.PORT.
ENV NODE_ENV=production
EXPOSE 8080

# 8. Start the server. The app ensures its own tables + admin at boot (with DB
# retry), so a transient seed failure must never block startup — run seed
# best-effort and always start the server.
CMD ["sh", "-c", "npm run seed || echo 'seed skipped'; npm start"]
