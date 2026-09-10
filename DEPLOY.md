# ขึ้นระบบบน VPS ที่ใช้ร่วมกับโปรเจกอื่น

ทำตามลำดับ ทุกขั้นก่อนข้อ 7 เป็นการดูอย่างเดียว ไม่แตะของคนอื่นบนเครื่อง

ในเอกสารนี้ใช้ค่าตัวอย่าง แทนด้วยของจริง

| ค่าตัวอย่าง | แทนด้วย |
|---|---|
| `attendance.yourdomain.com` | โดเมนที่จะใช้ |
| `4801` / `4802` | พอร์ตที่เลือกในข้อ 3 |
| `~/attendance` | โฟลเดอร์ที่วางโค้ดบน VPS |

---

## 0. ขอจากพี่ก่อนเริ่ม

- บัญชี SSH ที่ใช้ `sudo` ได้ หรืออย่างน้อยอยู่ในกลุ่ม `docker`
- เว็บบนเครื่องใช้อะไรรับพอร์ต 80/443 (nginx, Caddy หรือ Traefik ใน Docker) ข้อ 2 จะช่วยดูให้
- มีพอร์ตไหนที่พี่จองไว้ในใจแต่ยังไม่ได้ใช้บ้าง สคริปต์มองไม่เห็นพอร์ตพวกนี้
- สิทธิ์เพิ่ม DNS ของโดเมน (subdomain ใหม่ 1 ตัว)

## 1. เข้าเครื่องและวางโค้ด

```bash
ssh <user>@<ip-ของ-vps>
```

ถ้า repo เป็น **public**

```bash
git clone https://github.com/Aommykung1250-X7/Attendance.git ~/attendance
```

ถ้า repo เป็น **private** ให้ใช้ deploy key (อ่านได้อย่างเดียว ไม่ต้องใช้รหัสผ่าน GitHub ของตัวเองบนเครื่องพี่)

```bash
ssh-keygen -t ed25519 -f ~/.ssh/attendance_deploy -N "" -C "attendance-vps"
cat ~/.ssh/attendance_deploy.pub
# คัดลอกไปวางที่ GitHub → repo Attendance → Settings → Deploy keys → Add deploy key (ไม่ต้องติ๊ก write)

GIT_SSH_COMMAND="ssh -i ~/.ssh/attendance_deploy" git clone git@github.com:Aommykung1250-X7/Attendance.git ~/attendance
cd ~/attendance
git config core.sshCommand "ssh -i ~/.ssh/attendance_deploy"
```

## 2. ตรวจเครื่อง (อ่านอย่างเดียว)

```bash
cd ~/attendance
sudo bash scripts/check-vps.sh attendance.yourdomain.com 4801
```

สคริปต์บอกครบในรอบเดียว

- มี docker, docker compose, git ครบไหม และ RAM/ดิสก์เหลือพอไหม
- **ใครใช้พอร์ต 80/443** → บอกว่าต้องทำข้อ 8 แบบ A, B หรือ C
- **พอร์ตที่ว่าง** นับรวม container ที่หยุดอยู่ด้วย เพราะเปิดขึ้นมาเมื่อไหร่ก็จะแย่งพอร์ตคืน แล้วแนะนำคู่พอร์ตที่ว่างให้
- ชื่อ `attendance` ใน Docker ชนกับของเดิมไหม
- โดเมนชี้มาที่เครื่องนี้หรือยัง และมีเว็บอื่นใน nginx ใช้โดเมนนี้อยู่หรือเปล่า

ถ้าอยากดูเองโดยไม่ใช้สคริปต์

```bash
sudo ss -tlnp                                   # ทุกพอร์ตที่มีโปรแกรมใช้ พร้อมชื่อโปรแกรม
sudo ss -tlnp | grep -E ':(4801|4802)\b'        # ไม่มีผลลัพธ์ = ว่าง
docker ps -a --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
docker compose ls -a                            # compose project ทั้งหมดบนเครื่อง
```

## 3. เลือกพอร์ต

ระบบนี้ใช้พอร์ตบนเครื่อง 2 ตัว และ **ผูกกับ 127.0.0.1 เท่านั้น** คนนอกเข้าตรงไม่ได้ จึงไม่ต้องเปิด firewall เพิ่ม

| ตัวแปร | ค่าเริ่มต้น | ใช้ทำอะไร |
|---|---|---|
| `FRONTEND_PORT` | 4801 | reverse proxy ของเครื่องส่งเว็บเข้าที่พอร์ตนี้ |
| `BACKEND_PORT` | 4802 | ไว้ตรวจ health เท่านั้น |

- ใช้คู่ที่สคริปต์แนะนำ แล้วบอกพี่ว่าจองพอร์ตนี้แล้ว
- Postgres อยู่ใน Docker network ของระบบนี้ **ไม่ใช้พอร์ต 5432 ของเครื่อง** ไม่ชนกับ Postgres ของพี่แน่นอน

## 4. DNS

เพิ่ม A record ที่ผู้ให้บริการโดเมน

```
attendance   A   <ip-ของ-vps>
```

รอสักพักแล้วเช็กด้วย `getent ahostsv4 attendance.yourdomain.com` ต้องได้ IP ของ VPS

## 5. Google Auth Platform

ที่ Client ที่สร้างไว้ เพิ่มโดเมนจริง (เก็บของ localhost ไว้ได้)

- Authorized JavaScript origins: `https://attendance.yourdomain.com`
- Authorized redirect URIs: `https://attendance.yourdomain.com/api/auth/google/callback`

## 6. ไฟล์ .env.production

```bash
cd ~/attendance
cp .env.production.example .env.production
chmod 600 .env.production           # ให้เจ้าของไฟล์อ่านได้คนเดียว
openssl rand -hex 32                # → SESSION_SECRET
openssl rand -hex 24                # → POSTGRES_PASSWORD
nano .env.production
```

แก้ค่าเหล่านี้

| ค่า | ใส่อะไร |
|---|---|
| `DOMAIN_URL` | `https://attendance.yourdomain.com` ไม่มี `/` ท้าย ต้องตรงกับที่เปิดในเบราว์เซอร์ |
| `FRONTEND_PORT`, `BACKEND_PORT` | ค่าจากข้อ 3 |
| `COMPOSE_PROJECT_NAME` | ถ้าข้อ 2 บอกว่าชื่อ `attendance` ชน ให้เปลี่ยน เช่น `attendance-turnpro` |
| `POSTGRES_PASSWORD`, `SESSION_SECRET` | ค่าที่สุ่มจาก openssl |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | จากข้อ 5 |
| `ADMIN_EMAILS` | Gmail ของแอดมิน คั่นด้วย comma |

## 7. สร้างและเปิดระบบ

ตั้งชื่อย่อไว้พิมพ์ทีหลังจะได้ไม่พลาด (ใส่ใน `~/.bashrc` ได้)

```bash
alias dc='docker compose --env-file .env.production'
```

ในโฟลเดอร์ `~/attendance`

```bash
dc up -d --build                    # ครั้งแรกใช้เวลา 2–5 นาที
dc ps                               # ต้องเห็น db, backend, frontend สถานะ running/healthy
dc logs -f backend                  # ดู log (Ctrl+C ออก) ต้องเห็นบรรทัด Server listening
curl http://127.0.0.1:4802/api/health        # {"ok":true,...}
curl -I http://127.0.0.1:4801                # HTTP/1.1 200 OK
```

ถ้าขึ้น `port is already allocated` แปลว่าพอร์ตถูกใช้ ให้กลับไปข้อ 3 เลือกพอร์ตใหม่ แล้วรัน `dc up -d` อีกครั้ง

## 8. ต่อเข้าโดเมนพร้อม HTTPS

ใช้แบบที่ตรงกับผลของสคริปต์ในข้อ 2 **สร้างไฟล์ใหม่ของเราเท่านั้น ห้ามแก้ไฟล์ของเว็บอื่น**

### แบบ A: เครื่องใช้ nginx

ดูก่อนว่าเครื่องเก็บ config ไว้ที่ไหน

```bash
ls /etc/nginx/sites-enabled/ /etc/nginx/conf.d/ 2>/dev/null
```

ถ้ามี `sites-enabled` ให้ใช้ `/etc/nginx/sites-available/attendance` ถ้ามีแต่ `conf.d` ให้ใช้ `/etc/nginx/conf.d/attendance.conf`

```bash
sudo nano /etc/nginx/sites-available/attendance
```

```nginx
server {
    listen 80;
    server_name attendance.yourdomain.com;
    client_max_body_size 6m;

    location / {
        proxy_pass http://127.0.0.1:4801;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/attendance /etc/nginx/sites-enabled/attendance   # (ข้ามถ้าใช้ conf.d)
sudo nginx -t                          # ต้องขึ้น "syntax is ok" และ "test is successful" เท่านั้นถึงไปต่อ
sudo systemctl reload nginx            # reload ไม่ตัดการเชื่อมต่อของเว็บอื่น
sudo certbot --nginx -d attendance.yourdomain.com
```

**ถ้า `nginx -t` ไม่ผ่าน ห้าม reload** ไม่งั้นเว็บของพี่จะล่มไปด้วย ให้ลบไฟล์ของเราออกแล้วแก้ใหม่

### แบบ B: เครื่องใช้ Caddy

เพิ่มบล็อกนี้ท้ายไฟล์ `/etc/caddy/Caddyfile` (Caddy ทำ HTTPS ให้เอง)

```
attendance.yourdomain.com {
    reverse_proxy 127.0.0.1:4801
}
```

```bash
sudo caddy validate --config /etc/caddy/Caddyfile     # ต้องผ่านก่อน
sudo systemctl reload caddy
```

### แบบ C: พอร์ต 80/443 เป็นของ container (Traefik, nginx-proxy)

ต้องต่อ container ของเราเข้า network ของ proxy ตัวนั้นและใส่ label ตามที่พี่ตั้งไว้ ถามพี่ว่าใช้ชื่อ network และ label แบบไหน แล้วส่งให้ผมปรับ `docker-compose.yml` ให้

## 9. ทดสอบจริง

- [ ] เปิด `https://attendance.yourdomain.com/admin` แล้วล็อกอิน Google ด้วยบัญชีใน `ADMIN_EMAILS` ได้
- [ ] หน้าตั้งค่า: เพิ่มวันหยุด แล้วคัดลอกลิงก์หน้าจอ
- [ ] สร้างโปรเจก แล้วเพิ่มตัวเองเป็นพนักงาน โดยให้มีกะวันนี้
- [ ] เปิดลิงก์หน้าจอบนคอม หรือบนจอจริง ต้องเห็นนาฬิกาและ QR
- [ ] เอามือถือสแกน ล็อกอิน Google กดเช็กชื่อ เวลาที่บันทึกต้องเป็นเวลาตอนสแกน
- [ ] สแกนซ้ำ ต้องขึ้นหน้าแจ้งกลับก่อนเวลา
- [ ] หน้าบันทึกประจำวันต้องเห็นชื่อตัวเองพร้อมสถานะ
- [ ] นำเข้าไฟล์ Excel ของจริง ตรวจหน้าสรุปก่อนกดยืนยัน

## 10. อัปเดตโค้ดครั้งถัดไป

```bash
cd ~/attendance
git pull
dc up -d --build        # ข้อมูลในฐานข้อมูลอยู่ครบ migration ใหม่รันเอง
```

## 11. สำรองฐานข้อมูลทุกคืน

```bash
mkdir -p ~/attendance-backup
crontab -e
```

เพิ่มบรรทัดนี้ แก้ user และชื่อฐานข้อมูลให้ตรงกับ `.env.production` (backup วันละไฟล์ เก็บ 30 วัน)

```
0 2 * * * cd $HOME/attendance && docker compose --env-file .env.production exec -T db pg_dump -U attendance_user attendance_db | gzip > $HOME/attendance-backup/$(date +\%F).sql.gz && find $HOME/attendance-backup -name '*.sql.gz' -mtime +30 -delete
```

กู้คืน (ใช้ตอนจำเป็นเท่านั้น)

```bash
gunzip -c ~/attendance-backup/2026-09-20.sql.gz | dc exec -T db psql -U attendance_user attendance_db
```

## 12. ก่อนเปิดใช้จริง

- [ ] Google Auth Platform → Audience → **Publish app** (สถานะ In production)
- [ ] ตั้ง backup ในข้อ 11 แล้ว และลองดูว่ามีไฟล์เกิดขึ้นจริง
- [ ] ล้างข้อมูลทดสอบ ถ้าต้องการเริ่มใหม่หมด (ลบทุกอย่างของระบบนี้ กู้คืนไม่ได้)
  ```bash
  cd ~/attendance && dc down -v && dc up -d
  ```

---

## ข้อห้ามบนเครื่องที่ใช้ร่วมกับพี่

| ห้าม | เพราะ | ทำแบบนี้แทน |
|---|---|---|
| `docker system prune`, `docker volume prune`, `docker image prune -a` | ลบ image หรือข้อมูลของโปรเจกพี่ที่หยุดอยู่ | ไม่ต้องล้าง ถ้าดิสก์เต็มให้คุยกับพี่ก่อน |
| `docker stop $(docker ps -q)` | หยุดทุก container บนเครื่อง | `dc stop` ในโฟลเดอร์ `~/attendance` |
| `dc down -v` ตอนไม่ได้ตั้งใจล้างข้อมูล | ลบฐานข้อมูลของระบบนี้ทิ้ง | `dc down` (ไม่มี `-v`) เก็บข้อมูลไว้ |
| แก้ไฟล์ nginx หรือ Caddy ของเว็บอื่น | เว็บพี่อาจล่ม | สร้างไฟล์ใหม่ของเราเท่านั้น และ `nginx -t` ก่อน reload ทุกครั้ง |
| เปิดพอร์ต 4801/4802 ใน firewall | ไม่จำเป็น และทำให้เข้าข้าม HTTPS ได้ | ปล่อยไว้ ผูก 127.0.0.1 อยู่แล้ว |
| `sudo systemctl restart nginx` | ตัดการเชื่อมต่อของทุกเว็บชั่วขณะ | `reload` |

## ถอนระบบออก

```bash
cd ~/attendance && dc down                  # หยุดและลบ container (ข้อมูลยังอยู่ใน volume)
sudo rm /etc/nginx/sites-enabled/attendance /etc/nginx/sites-available/attendance
sudo nginx -t && sudo systemctl reload nginx
sudo certbot delete --cert-name attendance.yourdomain.com
# ลบข้อมูลด้วย (กู้คืนไม่ได้): dc down -v
```

## เจอปัญหา

| อาการ | สาเหตุที่พบบ่อย |
|---|---|
| `port is already allocated` | พอร์ตถูกใช้ เลือกคู่ใหม่ในข้อ 3 |
| เปิดเว็บแล้ว 502 Bad Gateway | container frontend ไม่ทำงาน หรือพอร์ตใน nginx ไม่ตรงกับ `FRONTEND_PORT` ดูด้วย `dc ps` |
| Google ขึ้น `redirect_uri_mismatch` | redirect URI ใน Google ไม่ตรงกับ `DOMAIN_URL/api/auth/google/callback` ทุกตัวอักษร |
| ขึ้นว่า "คำขอนี้ไม่ได้มาจากหน้าเว็บของระบบ" | `DOMAIN_URL` ไม่ตรงกับที่เปิด เช่นมี `www` หรือเป็น http |
| ล็อกอินแล้วเด้งกลับมาให้ล็อกอินใหม่ | เปิดผ่าน http แทน https ทำให้ cookie แบบ Secure ไม่ถูกเก็บ |
| backend ไม่ขึ้น log บอก `ต้องตั้งค่า ...` | ลืมใส่ค่านั้นใน `.env.production` |
| หน้าจอในออฟฟิศขึ้นว่าลิงก์ใช้ไม่ได้ | มีคนกดสร้างลิงก์ใหม่ในหน้าตั้งค่า ให้เปิดลิงก์ใหม่ |
