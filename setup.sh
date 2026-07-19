#!/usr/bin/env bash
# Qtonix Site Analysis — server setup.
set -e

echo "==> Installing Node dependencies"
npm install --production=false

echo "==> Installing Plus Jakarta Sans"
mkdir -p ~/.fonts
BASE="https://raw.githubusercontent.com/tokotype/PlusJakartaSans/master/fonts/ttf"
for f in Regular Medium Bold ExtraBold; do
  curl -sfL -o ~/.fonts/PlusJakartaSans-$f.ttf "$BASE/PlusJakartaSans-$f.ttf"
done
fc-cache -f >/dev/null 2>&1 || true
echo "    fonts: $(fc-list | grep -ci jakarta) installed"

echo "==> Installing WeasyPrint (the engine the reference design was built for)"
# Chromium ignores CSS @page named-page rules, which this design needs for
# running footers and per-page margins. WeasyPrint honours them.
sudo apt-get install -y python3-pip libpango-1.0-0 libpangoft2-1.0-0 libcairo2 >/dev/null 2>&1 || \
  apt-get install -y python3-pip libpango-1.0-0 libpangoft2-1.0-0 libcairo2 >/dev/null 2>&1 || true
pip install weasyprint --break-system-packages -q 2>/dev/null || pip install weasyprint -q
weasyprint --version

echo "==> Checking MySQL"
mysql --version 2>/dev/null || echo "    MySQL client not found — install mysql-server, or set DB_DIALECT=sqlite in .env"

echo "==> Creating storage directories"
mkdir -p storage/reports storage/uploads

if [ ! -f .env ]; then
  cp .env.example .env
  JWT=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
  ENC=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
  sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$JWT|" .env
  sed -i "s|^ENCRYPTION_KEY=.*|ENCRYPTION_KEY=$ENC|" .env
  echo "==> .env created with generated secrets"
  echo "    Set ADMIN_PASSWORD in .env, then run: npm run seed"
else
  echo "==> .env already exists, leaving it alone"
fi

echo ""
echo "Done. Next:"
echo "  1. Set ADMIN_PASSWORD in .env"
echo "  2. npm run seed"
echo "  3. npm start"
echo "  4. Sign in and add your API keys in Admin -> Settings"
