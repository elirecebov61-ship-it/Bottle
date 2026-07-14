# 🍾 Spin the Bottle — Python versiyası (tək fayl: bot.py)

Bu, əvvəlki Node.js layihəsinin **tam Python qarşılığıdır**. Server (API),
verilənlər bazası sxemi/toxumu, socket.io və Telegram bot handler-lərinin
**hamısı `bot.py` daxilindədir**. Yalnız frontend (`public/` — HTML/CSS/JS)
ayrı fayllardadır, çünki Mini App brauzerdə işləyir və Python-a köçürülə bilməz.

## 1. Tələblər

- Python 3.11+
- PostgreSQL 14+
- Telegram bot tokeni (BotFather-dan)
- HTTPS domen (Telegram Mini App yalnız HTTPS-də açılır)

## 2. Quraşdırma

```bash
python -m venv venv
source venv/bin/activate      # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
```

`.env` faylını doldurun (BOT_TOKEN, WEBAPP_URL, DATABASE_URL).

## 3. Verilənlər bazası

Sxem və NPC/nailiyyət toxumu `bot.py` işə düşəndə **avtomatik** yaradılır
(startup zamanı). Sadəcə boş bir Postgres bazası hazır olsun:

```bash
createdb spin_bottle
```

## 4. İşə salmaq

```bash
python bot.py
```

Bu tək əmr:
- Telegram botunu polling rejimində başladır (`/start`, `/play`)
- FastAPI + Socket.io serverini `PORT` (default 3000) üzərində işə salır
- Mini App-ı (`public/`) həmin portdan serve edir

Production üçün `systemd` və ya `pm2`/`supervisor` ilə daimi işlək saxlaya bilərsiniz:

```bash
# systemd nümunəsi: /etc/systemd/system/spin-bottle.service
[Unit]
Description=Spin the Bottle bot
After=network.target

[Service]
WorkingDirectory=/path/to/spin-bottle-py
ExecStart=/path/to/venv/bin/python bot.py
Restart=always
EnvironmentFile=/path/to/spin-bottle-py/.env

[Install]
WantedBy=multi-user.target
```

## 5. BotFather tənzimləməsi

1. `@BotFather` → `/newbot` → tokeni `.env`-ə yazın
2. `/mybots` → botunuzu seçin → **Bot Settings → Menu Button** → `WEBAPP_URL`-i təyin edin

## 6. Pulsuz deploy — Render.com

Layihədə artıq hazır olan `Dockerfile` və `render.yaml` ilə:

1. Bu layihəni GitHub-a repo kimi yükləyin (yeni repo yaradıb faylları push edin)
2. [render.com](https://render.com) → **New +** → **Blueprint** → GitHub repo-nuzu seçin
   (Render `render.yaml` faylını avtomatik tapıb Web Service + Postgres yaradacaq)
3. Deploy zamanı Render sizdən 2 gizli dəyişəni soruşacaq:
   - `BOT_TOKEN` — BotFather-dan aldığınız token
   - `WEBAPP_URL` — bunu Render sizə ilk deploy-dan sonra verdiyi
     `https://spin-bottle-bot-xxxx.onrender.com` ünvanı ilə doldurun
     (ilk dəfə boş buraxıb deploy edin, ünvanı görün, sonra Environment
     bölməsindən əlavə edib yenidən deploy edin)
4. Deploy bitəndə BotFather-də **Menu Button** olaraq həmin `WEBAPP_URL`-i təyin edin

**Pulsuz planın məhdudiyyətləri:**
- Web Service 15 dəqiqə istifadəsiz qalanda yuxuya keçir (ilk mesajda bir neçə saniyə gecikə bilər)
- PostgreSQL 90 gündən sonra silinir — bu müddət bitməzdən əvvəl backup alın və ya ödənişli plana keçin
- Uzunmüddətli/ciddi istifadə üçün Starter plan (~$7/ay) və ya VPS tövsiyə olunur

## 7. Deploy tövsiyəsi (VPS — Nginx + SSL)

```nginx
server {
    listen 443 ssl;
    server_name sizin-domeniniz.com;
    ssl_certificate /etc/letsencrypt/live/sizin-domeniniz.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/sizin-domeniniz.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
}
```

## 8. Genişləndirmə

- `GIFT_CATALOG` (bot.py) — yeni hədiyyələr əlavə edin (frontend-də `public/app.js` → `GIFTS` siyahısına da uyğun əlavə edin)
- `ACHV_SEED` (bot.py) — nailiyyət siyahısını istədiyiniz qədər genişləndirin
- `public/img/npc/*.svg` — öz NPC şəkillərinizlə (jpg/png) əvəz edin, `NPC_SEED`-dəki yolları da yeniləyin

## Fayl strukturu

```
spin-bottle-py/
├── bot.py              # HƏR ŞEY: DB sxemi, API, socket.io, Telegram bot
├── requirements.txt
├── .env.example
├── Dockerfile          # Render/Fly/hər hansı Docker host üçün
├── render.yaml         # Render.com Blueprint (Web Service + Postgres)
├── .dockerignore
└── public/
    ├── index.html
    ├── style.css
    ├── app.js
    └── img/npc/*.svg
```
