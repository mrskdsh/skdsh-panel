#!/bin/bash

set -e

IMAGE="vernette/amneziawg:v1.0.20260223"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/lib/provision-awg.sh"

echo "=== Skdsh Panel — установка ==="
echo

if [ "$EUID" -ne 0 ]; then
  echo "Запустите с sudo: sudo ./install.sh"
  exit 1
fi

read -p "Публичный IP этого сервера: " SERVER_IP
if [ -z "$SERVER_IP" ]; then
  echo "IP обязателен, прерываю."
  exit 1
fi

read -p "Порт WireGuard [39001]: " WG_PORT
WG_PORT=${WG_PORT:-39001}

read -p "Имя Docker-контейнера AmneziaWG [skdsh-awg]: " CONTAINER_NAME
CONTAINER_NAME=${CONTAINER_NAME:-skdsh-awg}

if docker ps -a --format '{{.Names}}' 2>/dev/null | grep -qx "$CONTAINER_NAME"; then
  echo "✗ Контейнер \"$CONTAINER_NAME\" уже существует на этом сервере."
  echo "  Если это повторная установка ЭТОЙ ЖЕ панели — можно продолжать (контейнер"
  echo "  будет пересоздан с теми же данными). Если это НОВАЯ, отдельная установка —"
  echo "  выберите другое имя, иначе удалите чужой контейнер молча."
  read -p "Продолжить и пересоздать \"$CONTAINER_NAME\"? [y/N]: " CONFIRM_OVERWRITE
  if [[ ! "$CONFIRM_OVERWRITE" =~ ^[Yy]$ ]]; then
    echo "Прервано. Запустите установку заново с другим именем контейнера."
    exit 1
  fi
fi

read -p "Порт веб-панели [3001]: " WEB_PORT
WEB_PORT=${WEB_PORT:-3001}

read -p "Есть домен для HTTPS? Если да — впишите (например panel.example.com), иначе Enter: " DOMAIN

read -p "Название сервера в приложении AmneziaVPN [Skdsh Panel]: " DISPLAY_NAME
DISPLAY_NAME=${DISPLAY_NAME:-"Skdsh Panel"}

read -p "Настроить Telegram-уведомления о заявках? [y/N]: " SETUP_TG
TELEGRAM_BOT_TOKEN=""
TELEGRAM_ADMIN_CHAT_ID=""
if [[ "$SETUP_TG" =~ ^[Yy]$ ]]; then
  echo "Создайте бота через @BotFather в Telegram (команда /newbot), затем вставьте токен сюда."
  read -p "Токен бота: " TELEGRAM_BOT_TOKEN
  if [ -n "$TELEGRAM_BOT_TOKEN" ]; then
    echo "Теперь напишите вашему боту любое сообщение в Telegram (например 'привет'), затем нажмите Enter здесь."
    read -p "Нажмите Enter, когда напишете боту… "

    for attempt in 1 2 3; do
      UPDATES=$(curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates" || echo "")
      TELEGRAM_ADMIN_CHAT_ID=$(echo "$UPDATES" | grep -o '"chat":{"id":[0-9-]*' | tail -1 | grep -o '[0-9-]*$' || echo "")
      [ -n "$TELEGRAM_ADMIN_CHAT_ID" ] && break
      sleep 2
    done

    if [ -n "$TELEGRAM_ADMIN_CHAT_ID" ]; then
      echo "✓ chat_id определён автоматически: $TELEGRAM_ADMIN_CHAT_ID"
    else
      echo "⚠ Не удалось определить chat_id автоматически — впишите его в .env вручную позже (узнать можно через @userinfobot)"
    fi
  fi
fi

if ! command -v docker &> /dev/null; then
  echo "→ Устанавливаю Docker…"
  curl -fsSL https://get.docker.com | sh
else
  echo "→ Docker уже установлен, пропускаю"
fi

if ! command -v node &> /dev/null; then
  echo "→ Устанавливаю Node.js…"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - > /dev/null 2>&1
  apt install -y nodejs > /dev/null
else
  echo "→ Node.js уже установлен, пропускаю"
fi

SUBNET_BASE="10.9.1"
echo "→ Разворачиваю AmneziaWG…"
IS_REMOTE=false
provision_awg_server
if [ -z "$PROV_PUBLIC_KEY" ]; then
  echo "✗ Не удалось развернуть AmneziaWG-сервер"
  exit 1
fi
echo "✓ AmneziaWG-сервер поднят и работает (интерфейс: $PROV_IFACE_NAME)"

echo "→ Настраиваю форвардинг трафика…"
sysctl -w net.ipv4.ip_forward=1 > /dev/null
grep -q "^net.ipv4.ip_forward" /etc/sysctl.conf 2>/dev/null || \
  echo "net.ipv4.ip_forward=1" >> /etc/sysctl.conf
DEBIAN_FRONTEND=noninteractive apt install -y iptables-persistent > /dev/null 2>&1
echo "✓ NAT и форвардинг настроены"

echo "→ Настраиваю backend…"
JWT_SECRET=$(openssl rand -hex 32)
COOKIE_SECURE="false"
[ -n "$DOMAIN" ] && COOKIE_SECURE="true"

cat > "$SCRIPT_DIR/.env" << EOF
PORT=$WEB_PORT
JWT_SECRET=$JWT_SECRET
COOKIE_SECURE=$COOKIE_SECURE
AWG_CONTAINER=$CONTAINER_NAME
AWG_INTERFACE=$PROV_IFACE_NAME
AWG_CONFIG_PATH=/etc/amnezia/amneziawg/$PROV_IFACE_NAME.conf
SERVER_ENDPOINT=$SERVER_IP:$WG_PORT
SERVER_DISPLAY_NAME=$DISPLAY_NAME
SERVER_PUBLIC_KEY=$PROV_PUBLIC_KEY
SERVER_PRESHARED_KEY=$PROV_PRESHARED_KEY
AWG_JC=$PROV_JC
AWG_JMIN=$PROV_JMIN
AWG_JMAX=$PROV_JMAX
AWG_S1=$PROV_S1
AWG_S2=$PROV_S2
AWG_S3=$PROV_S3
AWG_S4=$PROV_S4
AWG_H1=$PROV_H1
AWG_H2=$PROV_H2
AWG_H3=$PROV_H3
AWG_H4=$PROV_H4
PEER_ADDRESS_START=2
PEER_SUBNET_PREFIX=$SUBNET_BASE.
PEER_SUBNET_MASK=/32
CLIENT_DNS=1.1.1.1
TELEGRAM_BOT_TOKEN=$TELEGRAM_BOT_TOKEN
TELEGRAM_ADMIN_CHAT_ID=$TELEGRAM_ADMIN_CHAT_ID
EOF

echo "→ Ставлю зависимости backend (npm install)…"
cd "$SCRIPT_DIR"
npm install > /dev/null

if [ -d "$SCRIPT_DIR/frontend" ]; then
  echo "→ Собираю фронтенд (npm install && npm run build)…"
  cd "$SCRIPT_DIR/frontend"
  npm install > /dev/null
  npm run build > /dev/null
  cd "$SCRIPT_DIR"
  echo "✓ Фронтенд собран"
else
  echo "⚠ Папка frontend не найдена рядом — веб-интерфейс не будет доступен, только API"
fi

echo
echo "=== Создание администратора ==="
node src/create-admin.js

SERVICE_NAME="skdsh-panel-$(basename "$SCRIPT_DIR")"
echo "→ Настраиваю systemd-сервис ($SERVICE_NAME)…"

if [ -f "/etc/systemd/system/${SERVICE_NAME}.service" ]; then
  EXISTING_DIR=$(grep "^WorkingDirectory=" "/etc/systemd/system/${SERVICE_NAME}.service" | cut -d= -f2)
  if [ -n "$EXISTING_DIR" ] && [ "$EXISTING_DIR" != "$SCRIPT_DIR" ]; then
    echo "✗ Сервис $SERVICE_NAME уже существует и указывает на другую папку ($EXISTING_DIR)."
    echo "  Переименуйте папку установки или удалите старый сервис вручную, прежде чем продолжать."
    exit 1
  fi
fi

cat > "/etc/systemd/system/${SERVICE_NAME}.service" << EOF
[Unit]
Description=Skdsh Panel ($SCRIPT_DIR)
After=network.target docker.service

[Service]
WorkingDirectory=$SCRIPT_DIR
ExecStart=/usr/bin/node src/server.js
Restart=always
EnvironmentFile=$SCRIPT_DIR/.env
User=root

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now "$SERVICE_NAME" > /dev/null

sleep 1
if curl -sf http://localhost:$WEB_PORT/api/health > /dev/null; then
  echo "✓ Панель запущена и отвечает"
else
  echo "✗ Панель не отвечает, проверьте: systemctl status $SERVICE_NAME"
  exit 1
fi

if [ -n "$DOMAIN" ]; then
  echo "→ Настраиваю HTTPS через Caddy для $DOMAIN…"
  if ! command -v caddy &> /dev/null; then
    apt install -y debian-keyring debian-archive-keyring apt-transport-https curl > /dev/null
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg 2>/dev/null
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
    apt update > /dev/null && apt install -y caddy > /dev/null
  fi

  cat > /etc/caddy/Caddyfile << EOF
$DOMAIN {
  reverse_proxy localhost:$WEB_PORT
}
EOF
  systemctl restart caddy
  echo "✓ Caddy настроен — убедитесь, что A-запись $DOMAIN указывает на $SERVER_IP"
fi

echo
echo "=== Готово ==="
if [ -n "$DOMAIN" ]; then
  echo "Панель: https://$DOMAIN"
else
  echo "Панель: http://$SERVER_IP:$WEB_PORT (без HTTPS — рекомендуется SSH-туннель для доступа)"
  echo "  ssh -L $WEB_PORT:localhost:$WEB_PORT root@$SERVER_IP"
  echo "  затем откройте http://localhost:$WEB_PORT"
fi
echo
echo "Не забудьте открыть порты в firewall, если он активен:"
echo "  ufw allow $WG_PORT/udp"
[ -n "$DOMAIN" ] && echo "  ufw allow 80" && echo "  ufw allow 443"
[ -z "$DOMAIN" ] && echo "  (порт $WEB_PORT наружу открывать не обязательно — только для SSH-туннеля)"

if [ -n "$TELEGRAM_BOT_TOKEN" ] && [ -n "$TELEGRAM_ADMIN_CHAT_ID" ]; then
  curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    -H "Content-Type: application/json" \
    -d "{\"chat_id\": \"$TELEGRAM_ADMIN_CHAT_ID\", \"text\": \"✅ Skdsh Panel: Telegram-уведомления настроены и работают\"}" \
    > /dev/null
  echo
  echo "Проверьте Telegram — должно прийти тестовое сообщение от бота."
fi

echo
read -p "Развернуть ещё один AmneziaWG-сервер прямо сейчас? [y/N]: " ADD_MORE
EXTRA_SUBNET_COUNTER=20
while [[ "$ADD_MORE" =~ ^[Yy]$ ]]; do
  echo
  SUBNET_BASE="10.$EXTRA_SUBNET_COUNTER.1"
  EXTRA_SUBNET_COUNTER=$((EXTRA_SUBNET_COUNTER + 1))

  read -p "Разворачивать здесь или на другом сервере по SSH? [здесь/ssh]: " WHERE
  IS_REMOTE=false
  if [[ "$WHERE" =~ ^[Ss][Ss][Hh]$ ]]; then
    IS_REMOTE=true
    read -p "IP удалённого сервера: " SSH_HOST
    read -p "SSH-пользователь [root]: " SSH_USER
    SSH_USER=${SSH_USER:-root}
    read -p "Путь к приватному SSH-ключу (на ЭТОЙ машине): " SSH_KEY
    if ! ssh -o StrictHostKeyChecking=no -o ConnectTimeout=8 -i "$SSH_KEY" "$SSH_USER@$SSH_HOST" "echo ok" > /dev/null 2>&1; then
      echo "✗ Не удалось подключиться по SSH, пропускаю этот сервер."
      read -p "Развернуть ещё один? [y/N]: " ADD_MORE
      continue
    fi
  fi

  read -p "Название для панели: " NAME
  read -p "Публичный IP сервера, который увидят клиенты: " SERVER_IP
  read -p "Порт WireGuard (не должен совпадать с уже занятыми): " WG_PORT
  read -p "Имя для Docker-контейнера: " CONTAINER_NAME

  echo "→ Разворачиваю…"
  if provision_awg_server; then
    echo "✓ Поднят, интерфейс: $PROV_IFACE_NAME"

    REGISTERED=false
    read -p "Зарегистрировать в панели прямо сейчас через API? [Y/n]: " AUTO_REG
    if [[ ! "$AUTO_REG" =~ ^[Nn]$ ]]; then
      PANEL_URL="http://localhost:$WEB_PORT"
      read -p "Логин администратора панели: " ADMIN_USERNAME
      read -sp "Пароль администратора: " ADMIN_PASSWORD
      echo
      if register_server_via_api; then
        REGISTERED=true
      fi
    fi

    if [ "$REGISTERED" = false ]; then
      echo
      echo "Добавьте сервер вручную через раздел 'Серверы' → '+ Добавить сервер':"
      echo
      echo "Название:        $NAME"
      echo "Адрес:порт:      $SERVER_IP:$WG_PORT"
      echo "Контейнер:       $CONTAINER_NAME"
      echo "Имя интерфейса:  $PROV_IFACE_NAME"
      echo "Путь к конфигу:  /etc/amnezia/amneziawg/$PROV_IFACE_NAME.conf"
      echo "Публичный ключ:  $PROV_PUBLIC_KEY"
      echo "Preshared key:   $PROV_PRESHARED_KEY"
      echo "Префикс подсети: $SUBNET_BASE."
      echo "Jc / Jmin / Jmax: $PROV_JC / $PROV_JMIN / $PROV_JMAX"
      echo "S1-S4: $PROV_S1 / $PROV_S2 / $PROV_S3 / $PROV_S4"
      echo "H1: $PROV_H1"
      echo "H2: $PROV_H2"
      echo "H3: $PROV_H3"
      echo "H4: $PROV_H4"
      if [ "$IS_REMOTE" = true ]; then
        echo "Вкладка 'Удалённый (по SSH)': IP=$SSH_HOST, юзер=$SSH_USER, ключ=$SSH_KEY"
      fi
    fi
  fi

  echo
  read -p "Развернуть ещё один? [y/N]: " ADD_MORE
done
