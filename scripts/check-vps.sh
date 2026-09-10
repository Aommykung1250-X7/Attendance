#!/usr/bin/env bash
# ตรวจ VPS ก่อนติดตั้ง ว่าอะไรจะชนกับโปรเจกอื่นบ้าง
# สคริปต์นี้อ่านอย่างเดียว ไม่แก้ ไม่ลบ ไม่รีสตาร์ทอะไรทั้งสิ้น
#
# ใช้:  bash scripts/check-vps.sh [โดเมน] [พอร์ตเริ่มต้น]
#  เช่น  bash scripts/check-vps.sh attendance.example.com 4801
# ถ้า docker ต้องใช้ sudo ให้รันด้วย sudo

DOMAIN="${1:-}"
START="${2:-4801}"
PROJECT="attendance"

ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$*"; }
section() { printf '\n\033[1m%s\033[0m\n' "$*"; }

have() { command -v "$1" >/dev/null 2>&1; }

# พอร์ต TCP ที่มีโปรแกรมรอรับอยู่ (ใช้ ss ถ้ามี ไม่งั้นอ่านจาก /proc)
listen_ports() {
  if have ss; then
    ss -Htln 2>/dev/null | awk '{print $4}' | sed -E 's/.*:([0-9]+)$/\1/'
  else
    for h in $(awk 'NR>1 && $4=="0A"{split($2,a,":"); print a[2]}' /proc/net/tcp /proc/net/tcp6 2>/dev/null); do
      echo $((16#$h))
    done
  fi | sort -un
}

# ---------------------------------------------------------------
section "1. เครื่องมือที่ต้องมี"
if have docker; then ok "docker $(docker --version 2>/dev/null | awk '{print $3}' | tr -d ,)"; else bad "ไม่มี docker"; fi
if docker compose version >/dev/null 2>&1; then ok "docker compose $(docker compose version --short 2>/dev/null)"; else bad "ไม่มี docker compose (plugin v2)"; fi
if have git; then ok "git"; else bad "ไม่มี git"; fi
if have openssl; then ok "openssl"; else warn "ไม่มี openssl (ใช้สร้างรหัสสุ่ม)"; fi
DOCKER_OK=1
if ! docker ps >/dev/null 2>&1; then
  DOCKER_OK=0
  warn "เรียก docker ไม่ได้ด้วยสิทธิ์นี้ ลองรันใหม่ด้วย sudo (ผลเรื่องพอร์ตของ container จะไม่ครบ)"
fi

# ---------------------------------------------------------------
section "2. ทรัพยากรเครื่อง"
if have free; then free -h | awk 'NR==2{printf "  RAM ทั้งหมด %s ใช้อยู่ %s ว่าง %s\n",$2,$3,$7}'; fi
df -h / | awk 'NR==2{printf "  ดิสก์ / ทั้งหมด %s ว่าง %s\n",$2,$4}'
echo "  (ระบบนี้ใช้ RAM ประมาณ 300–400MB และดิสก์ประมาณ 1GB รวม image)"

# ---------------------------------------------------------------
section "3. ใครใช้พอร์ต 80/443 อยู่ (reverse proxy ของเครื่อง)"
LISTEN=$(listen_ports)
for p in 80 443; do
  if ! echo "$LISTEN" | grep -qx "$p"; then warn "พอร์ต $p ยังไม่มีใครใช้ (ต้องติดตั้ง nginx หรือ Caddy เอง)"; continue; fi
  proc=""
  have ss && proc=$(ss -Htlnp "sport = :$p" 2>/dev/null | grep -o 'users:(("[^"]*"' | head -1 | cut -d'"' -f2)
  ok "พอร์ต $p ใช้โดย: ${proc:-ไม่ทราบชื่อโปรแกรม (ดูด้วย sudo ss -tlnp)}"
done
echo "  nginx  → ใช้วิธี A ใน DEPLOY.md   caddy → วิธี B   docker-proxy/traefik → ถามพี่ก่อน (วิธี C)"

# ---------------------------------------------------------------
section "4. พอร์ตที่ถูกใช้หรือถูกจองไว้"
USED="$LISTEN"
RESERVED=""
if [ "$DOCKER_OK" = 1 ]; then
  # รวม container ที่หยุดอยู่ด้วย เพราะเปิดขึ้นมาเมื่อไหร่ก็จะแย่งพอร์ตคืน
  RESERVED=$(docker ps -aq | xargs -r docker inspect --format \
    '{{range $p, $conf := .HostConfig.PortBindings}}{{range $conf}}{{.HostPort}} {{end}}{{end}}' 2>/dev/null |
    tr ' ' '\n' | grep -E '^[0-9]+$' | sort -un)
fi
is_taken() { echo "$USED" | grep -qx "$1" || echo "$RESERVED" | grep -qx "$1"; }

for p in "$START" "$((START + 1))"; do
  if echo "$USED" | grep -qx "$p"; then bad "พอร์ต $p มีโปรแกรมใช้อยู่"
  elif echo "$RESERVED" | grep -qx "$p"; then bad "พอร์ต $p ถูก container (อาจหยุดอยู่) จองไว้"
  else ok "พอร์ต $p ว่าง"; fi
done

p=$START
while is_taken "$p" || is_taken "$((p + 1))"; do p=$((p + 2)); done
echo
echo "  แนะนำให้ใช้:  FRONTEND_PORT=$p   BACKEND_PORT=$((p + 1))"
echo "  (ใส่ใน .env.production) ยังควรถามพี่ด้วยว่ามีโปรเจกที่ยังไม่ได้รันแต่จองพอร์ตไว้ในใจหรือเปล่า"

if [ "$DOCKER_OK" = 1 ]; then
  echo
  echo "  พอร์ตที่ container บนเครื่องนี้ผูกไว้ทั้งหมด:"
  [ -z "$RESERVED" ] && echo "    (ไม่มี)"
  docker ps -a --format '    {{.Names}}\t{{.Status}}' | while IFS=$'\t' read -r name status; do
    ports=$(docker inspect --format '{{range $p, $conf := .HostConfig.PortBindings}}{{range $conf}}{{.HostPort}}→{{$p}} {{end}}{{end}}' "$(echo "$name" | xargs)" 2>/dev/null)
    [ -n "$ports" ] && printf '%s  [%s]  %s\n' "$name" "$status" "$ports"
  done
fi

# ---------------------------------------------------------------
section "5. ชื่อ Docker ที่อาจชน (โปรเจก '$PROJECT')"
if [ "$DOCKER_OK" = 1 ]; then
  if docker compose ls -a 2>/dev/null | awk 'NR>1{print $1}' | grep -qx "$PROJECT"; then
    bad "มี compose project ชื่อ '$PROJECT' อยู่แล้ว → ใช้ชื่ออื่นด้วย  docker compose -p attendance-turnpro ..."
  else ok "ชื่อ project '$PROJECT' ว่าง"; fi
  if docker volume ls -q | grep -qx "${PROJECT}_db-data"; then
    warn "มี volume '${PROJECT}_db-data' อยู่แล้ว (ถ้าไม่ใช่ของระบบนี้ ให้ใช้ชื่อ project อื่น)"
  else ok "ชื่อ volume ว่าง"; fi
  if docker network ls --format '{{.Name}}' | grep -qx "${PROJECT}_default"; then
    warn "มี network '${PROJECT}_default' อยู่แล้ว"
  else ok "ชื่อ network ว่าง"; fi
else
  warn "ข้าม (เรียก docker ไม่ได้)"
fi

# ---------------------------------------------------------------
if [ -n "$DOMAIN" ]; then
  section "6. โดเมน $DOMAIN"
  ip=$(getent ahostsv4 "$DOMAIN" 2>/dev/null | awk '{print $1}' | head -1)
  myip=$(curl -4 -s --max-time 5 https://api.ipify.org 2>/dev/null)
  if [ -z "$ip" ]; then bad "โดเมนยังไม่ชี้มาที่ไหน → เพิ่ม A record ให้ชี้มาที่ ${myip:-IP ของเครื่องนี้}"
  elif [ -n "$myip" ] && [ "$ip" != "$myip" ]; then warn "โดเมนชี้ไปที่ $ip แต่เครื่องนี้คือ $myip"
  elif [ -z "$myip" ]; then warn "โดเมนชี้ไปที่ $ip (ตรวจ IP ของเครื่องนี้ไม่ได้ เทียบเองด้วย: curl -4 ifconfig.me)"
  else ok "โดเมนชี้มาที่เครื่องนี้ ($ip)"; fi

  if have nginx; then
    if sudo -n true 2>/dev/null || [ "$(id -u)" = 0 ]; then
      if sudo nginx -T 2>/dev/null | grep -E "server_name" | grep -qw "$DOMAIN"; then
        bad "nginx มี server_name $DOMAIN อยู่แล้ว (ชนกับเว็บอื่น)"
      else ok "ยังไม่มีเว็บไหนใน nginx ใช้โดเมนนี้"; fi
    else
      warn "ตรวจ nginx ต้องใช้ sudo: sudo nginx -T | grep server_name"
    fi
  fi
fi

echo
echo "เสร็จแล้ว สคริปต์นี้ไม่ได้แก้อะไรในเครื่อง"
