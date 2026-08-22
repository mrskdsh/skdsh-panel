provision_awg_server() {
  local script
  script=$(cat << PROVISION_EOF
set -e
IMAGE="$IMAGE"
CONTAINER_NAME="$CONTAINER_NAME"
WG_PORT="$WG_PORT"
SUBNET_BASE="$SUBNET_BASE"

if ! command -v docker &> /dev/null; then
  curl -fsSL https://get.docker.com | sh > /dev/null 2>&1
fi
docker pull "\$IMAGE" > /dev/null

PRIVATE_KEY=\$(docker run --rm --entrypoint awg "\$IMAGE" genkey)
PUBLIC_KEY=\$(echo "\$PRIVATE_KEY" | docker run --rm -i --entrypoint awg "\$IMAGE" pubkey)
PRESHARED_KEY=\$(docker run --rm --entrypoint awg "\$IMAGE" genpsk)

PARAMS=\$(docker run --rm --entrypoint awg-genparams "\$IMAGE")
CLIENT_JC=\$(echo "\$PARAMS" | grep "^Jc" | awk -F'= ' '{print \$2}')
CLIENT_JMIN=\$(echo "\$PARAMS" | grep "^Jmin" | awk -F'= ' '{print \$2}')
CLIENT_JMAX=\$(echo "\$PARAMS" | grep "^Jmax" | awk -F'= ' '{print \$2}')
S1=\$(echo "\$PARAMS" | grep "^S1" | head -1 | awk -F'= ' '{print \$2}')
S2=\$(echo "\$PARAMS" | grep "^S2" | head -1 | awk -F'= ' '{print \$2}')
S3=\$(echo "\$PARAMS" | grep "^S3" | head -1 | awk -F'= ' '{print \$2}')
S4=\$(echo "\$PARAMS" | grep "^S4" | head -1 | awk -F'= ' '{print \$2}')
H1=\$(echo "\$PARAMS" | grep "^H1" | head -1 | awk -F'= ' '{print \$2}')
H2=\$(echo "\$PARAMS" | grep "^H2" | head -1 | awk -F'= ' '{print \$2}')
H3=\$(echo "\$PARAMS" | grep "^H3" | head -1 | awk -F'= ' '{print \$2}')
H4=\$(echo "\$PARAMS" | grep "^H4" | head -1 | awk -F'= ' '{print \$2}')

IFACE_NAME=\$(printf '%s' "\$CONTAINER_NAME" | tr -c 'a-zA-Z0-9' '-' | cut -c1-15)
CONFIG_DIR="/opt/skdsh-panel/configs-\$CONTAINER_NAME"
mkdir -p "\$CONFIG_DIR"
cat > "\$CONFIG_DIR/\$IFACE_NAME.conf" << CONF_EOF
[Interface]
PrivateKey = \$PRIVATE_KEY
Address = $SUBNET_BASE.1/24
ListenPort = $WG_PORT
S1 = \$S1
S2 = \$S2
S3 = \$S3
S4 = \$S4
H1 = \$H1
H2 = \$H2
H3 = \$H3
H4 = \$H4
CONF_EOF

docker rm -f "\$CONTAINER_NAME" > /dev/null 2>&1 || true
docker run -d \
  --name "\$CONTAINER_NAME" \
  -v "\$CONFIG_DIR:/etc/amnezia/amneziawg" \
  --network host \
  --device=/dev/net/tun:/dev/net/tun \
  --cap-add=NET_ADMIN \
  --cap-add=SYS_MODULE \
  --restart always \
  "\$IMAGE" > /dev/null

sleep 2
if ! docker exec "\$CONTAINER_NAME" awg show "\$IFACE_NAME" > /dev/null 2>&1; then
  echo "ERROR: интерфейс не поднялся"
  exit 1
fi

MAIN_IFACE=\$(ip route show default | awk '{print \$5; exit}')
iptables -t nat -C POSTROUTING -s "$SUBNET_BASE.0/24" -o "\$MAIN_IFACE" -j MASQUERADE 2>/dev/null || \
  iptables -t nat -A POSTROUTING -s "$SUBNET_BASE.0/24" -o "\$MAIN_IFACE" -j MASQUERADE
iptables -C FORWARD -i "\$IFACE_NAME" -j ACCEPT 2>/dev/null || iptables -I FORWARD 1 -i "\$IFACE_NAME" -j ACCEPT
iptables -C FORWARD -o "\$IFACE_NAME" -j ACCEPT 2>/dev/null || iptables -I FORWARD 1 -o "\$IFACE_NAME" -j ACCEPT
if command -v netfilter-persistent &> /dev/null; then
  netfilter-persistent save > /dev/null 2>&1 || true
fi

echo "RESULT_START"
echo "PUBLIC_KEY=\$PUBLIC_KEY"
echo "PRESHARED_KEY=\$PRESHARED_KEY"
echo "IFACE_NAME=\$IFACE_NAME"
echo "JC=\$CLIENT_JC"
echo "JMIN=\$CLIENT_JMIN"
echo "JMAX=\$CLIENT_JMAX"
echo "S1=\$S1"
echo "S2=\$S2"
echo "S3=\$S3"
echo "S4=\$S4"
echo "H1=\$H1"
echo "H2=\$H2"
echo "H3=\$H3"
echo "H4=\$H4"
echo "RESULT_END"
PROVISION_EOF
)

  local output
  if [ "$IS_REMOTE" = true ]; then
    output=$(ssh -o StrictHostKeyChecking=no -i "$SSH_KEY" "$SSH_USER@$SSH_HOST" "sudo bash -s" <<< "$script" 2>&1) || {
      echo "✗ Ошибка на удалённом сервере:"
      echo "$output"
      return 1
    }
  else
    output=$(bash -c "$script" 2>&1) || {
      echo "✗ Ошибка:"
      echo "$output"
      return 1
    }
  fi

  if ! echo "$output" | grep -q "RESULT_START"; then
    echo "✗ Разворачивание не завершилось успешно. Полный вывод:"
    echo "$output"
    return 1
  fi

  local parsed
  parsed=$(echo "$output" | sed -n '/RESULT_START/,/RESULT_END/p')
  local get_val
  get_val() { echo "$parsed" | grep "^$1=" | cut -d= -f2-; }

  PROV_PUBLIC_KEY=$(get_val PUBLIC_KEY)
  PROV_PRESHARED_KEY=$(get_val PRESHARED_KEY)
  PROV_IFACE_NAME=$(get_val IFACE_NAME)
  PROV_JC=$(get_val JC)
  PROV_JMIN=$(get_val JMIN)
  PROV_JMAX=$(get_val JMAX)
  PROV_S1=$(get_val S1); PROV_S2=$(get_val S2); PROV_S3=$(get_val S3); PROV_S4=$(get_val S4)
  PROV_H1=$(get_val H1); PROV_H2=$(get_val H2); PROV_H3=$(get_val H3); PROV_H4=$(get_val H4)
}

register_server_via_api() {
  local cookie_jar
  cookie_jar=$(mktemp)

  curl -s -c "$cookie_jar" -X POST "$PANEL_URL/api/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"username\":\"$ADMIN_USERNAME\",\"password\":\"$ADMIN_PASSWORD\"}" > /tmp/login_response.json

  if ! grep -q '"user"' /tmp/login_response.json; then
    echo "✗ Не удалось войти в панель — проверьте адрес/логин/пароль:"
    cat /tmp/login_response.json
    rm -f "$cookie_jar" /tmp/login_response.json
    return 1
  fi

  local ssh_fields=""
  if [ "$IS_REMOTE" = true ]; then
    ssh_fields=", \"sshHost\": \"$SSH_HOST\", \"sshUser\": \"$SSH_USER\", \"sshKeyPath\": \"$SSH_KEY\""
  fi

  local response
  response=$(curl -s -b "$cookie_jar" -X POST "$PANEL_URL/api/servers" \
    -H "Content-Type: application/json" \
    -d "{
      \"name\": \"$NAME\",
      \"endpoint\": \"$SERVER_IP:$WG_PORT\",
      \"container\": \"$CONTAINER_NAME\",
      \"interface\": \"$PROV_IFACE_NAME\",
      \"configPath\": \"/etc/amnezia/amneziawg/$PROV_IFACE_NAME.conf\",
      \"publicKey\": \"$PROV_PUBLIC_KEY\",
      \"presharedKey\": \"$PROV_PRESHARED_KEY\",
      \"subnetPrefix\": \"$SUBNET_BASE.\",
      \"jc\": \"$PROV_JC\", \"jmin\": \"$PROV_JMIN\", \"jmax\": \"$PROV_JMAX\",
      \"s1\": \"$PROV_S1\", \"s2\": \"$PROV_S2\", \"s3\": \"$PROV_S3\", \"s4\": \"$PROV_S4\",
      \"h1\": \"$PROV_H1\", \"h2\": \"$PROV_H2\", \"h3\": \"$PROV_H3\", \"h4\": \"$PROV_H4\"
      $ssh_fields
    }")

  rm -f "$cookie_jar" /tmp/login_response.json

  if echo "$response" | grep -q '"id"'; then
    echo "✓ Сервер автоматически зарегистрирован в панели"
    return 0
  else
    echo "✗ Не удалось зарегистрировать сервер через API:"
    echo "$response"
    return 1
  fi
}
