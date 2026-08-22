#!/bin/bash

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/lib/provision-awg.sh"

IMAGE="vernette/amneziawg:v1.0.20260223"
SUBNET_BASE="10.20.1"

echo "=== Добавление AmneziaWG-сервера ==="
echo

if [ "$EUID" -ne 0 ]; then
  echo "Запустите с sudo: sudo ./add-server.sh"
  exit 1
fi

read -p "Разворачивать здесь или на другом сервере по SSH? [здесь/ssh]: " WHERE
IS_REMOTE=false
if [[ "$WHERE" =~ ^[Ss][Ss][Hh]$ ]]; then
  IS_REMOTE=true
  read -p "IP удалённого сервера: " SSH_HOST
  read -p "SSH-пользователь [root]: " SSH_USER
  SSH_USER=${SSH_USER:-root}
  read -p "Путь к приватному SSH-ключу (на ЭТОЙ машине): " SSH_KEY
  echo "Проверяю SSH-доступ…"
  if ! ssh -o StrictHostKeyChecking=no -o ConnectTimeout=8 -i "$SSH_KEY" "$SSH_USER@$SSH_HOST" "echo ok" > /dev/null 2>&1; then
    echo "✗ Не удалось подключиться по SSH. Проверьте IP, пользователя и ключ."
    exit 1
  fi
  echo "✓ SSH-доступ подтверждён"
fi

read -p "Название для панели (например 'Сервер NL-2'): " NAME
read -p "Публичный IP сервера, который увидят клиенты: " SERVER_IP
read -p "Порт WireGuard (не должен совпадать с уже занятыми на том хосте): " WG_PORT
read -p "Имя для Docker-контейнера (например skdsh-awg-2): " CONTAINER_NAME

echo
echo "→ Разворачиваю AmneziaWG…"
provision_awg_server

echo
echo "=== Сервер поднят ==="
echo "Название:        $NAME"
echo "Адрес:порт:      $SERVER_IP:$WG_PORT"
echo "Контейнер:       $CONTAINER_NAME"
echo "Имя интерфейса:  $PROV_IFACE_NAME"
echo "Публичный ключ:  $PROV_PUBLIC_KEY"

echo
read -p "Зарегистрировать этот сервер в панели прямо сейчас через API? [Y/n]: " AUTO_REGISTER
if [[ ! "$AUTO_REGISTER" =~ ^[Nn]$ ]]; then
  read -p "Адрес панели (например http://localhost:3001 или https://ваш-домен.ru): " PANEL_URL
  read -p "Логин администратора панели: " ADMIN_USERNAME
  read -sp "Пароль администратора: " ADMIN_PASSWORD
  echo

  if register_server_via_api; then
    echo
    echo "Готово — сервер уже виден в разделе 'Серверы' панели."
    exit 0
  fi
  echo "Не получилось зарегистрировать автоматически — данные для ручного добавления ниже."
fi

echo
echo "Добавьте сервер вручную через раздел 'Серверы' → '+ Добавить сервер':"
echo
echo "Путь к конфигу:  /etc/amnezia/amneziawg/$PROV_IFACE_NAME.conf"
echo "Preshared key:   $PROV_PRESHARED_KEY"
echo "Префикс подсети: $SUBNET_BASE."
echo "Jc / Jmin / Jmax: $PROV_JC / $PROV_JMIN / $PROV_JMAX"
echo "S1-S4: $PROV_S1 / $PROV_S2 / $PROV_S3 / $PROV_S4"
echo "H1: $PROV_H1"
echo "H2: $PROV_H2"
echo "H3: $PROV_H3"
echo "H4: $PROV_H4"
if [ "$IS_REMOTE" = true ]; then
  echo
  echo "Вкладка 'Удалённый (по SSH)':"
  echo "  IP:      $SSH_HOST"
  echo "  Юзер:    $SSH_USER"
  echo "  Ключ:    $SSH_KEY"
fi
echo
echo "Не забудьте открыть порт в firewall на том сервере: ufw allow $WG_PORT/udp"
