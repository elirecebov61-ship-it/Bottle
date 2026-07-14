"""
Spin the Bottle — Telegram Bot + Mini App (tək fayllı Python versiyası)
========================================================================
Bu fayl əvvəlki Node.js layihəsinin (server.js + bot.js + db/*) YERİNƏ keçir.
Hər şey (verilənlər bazası sxemi, oyun məntiqi, API, socket.io, Telegram bot)
bu tək `bot.py` faylının içindədir. Frontend (`public/`) dəyişməz qalıb.

Quraşdırma:
    pip install -r requirements.txt
    cp .env.example .env   # doldurub redaktə edin
    python bot.py

Bu, həm HTTP API-ni (FastAPI, port PORT) həm Telegram botunu (polling)
eyni prosesdə, eyni asyncio event loop-unda paralel işə salır.
"""

import os
import random
import asyncio
import logging
from datetime import datetime

import asyncpg
import socketio
from fastapi import FastAPI, Request, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse
from dotenv import load_dotenv
import uvicorn

from telegram import Update
from telegram.ext import Application, CommandHandler, ContextTypes
from telegram import InlineKeyboardButton, InlineKeyboardMarkup, WebAppInfo

load_dotenv()
logging.basicConfig(level=logging.INFO)
log = logging.getLogger("spin-bottle")

# =========================================================================
# 1) KONFİQURASİYA
# =========================================================================

BOT_TOKEN = os.getenv("BOT_TOKEN")
WEBAPP_URL = os.getenv("WEBAPP_URL", "https://example.com")
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://user:pass@localhost:5432/spin_bottle")
PORT = int(os.getenv("PORT", 3000))
STARTING_HEARTS = int(os.getenv("STARTING_HEARTS", 33))
STARTING_CHANCES = int(os.getenv("STARTING_CHANCES", 1))

# =========================================================================
# 2) SXEM + TOXUM MƏLUMATLARI (əvvəlki schema.sql + init.js buraya köçdü)
# =========================================================================

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS users (
  id             SERIAL PRIMARY KEY,
  telegram_id    BIGINT UNIQUE NOT NULL,
  username       TEXT,
  first_name     TEXT,
  photo_url      TEXT,
  gender         TEXT CHECK (gender IN ('male','female')),
  age            INT,
  hearts         INT NOT NULL DEFAULT 33,
  chances        INT NOT NULL DEFAULT 1,
  table_number   INT NOT NULL DEFAULT 1,
  sound_volume   INT NOT NULL DEFAULT 100,
  music_volume   INT NOT NULL DEFAULT 100,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS npc_profiles (
  id           SERIAL PRIMARY KEY,
  name         TEXT NOT NULL,
  age          INT NOT NULL,
  gender       TEXT CHECK (gender IN ('male','female')),
  photo_url    TEXT NOT NULL,
  personality  TEXT DEFAULT 'friendly'
);

CREATE TABLE IF NOT EXISTS game_sessions (
  id              SERIAL PRIMARY KEY,
  user_id         INT REFERENCES users(id) ON DELETE CASCADE,
  seated_npc_ids  INT[] NOT NULL,
  bottle_target   INT,
  status          TEXT NOT NULL DEFAULT 'waiting',
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS messages (
  id           SERIAL PRIMARY KEY,
  session_id   INT REFERENCES game_sessions(id) ON DELETE CASCADE,
  sender       TEXT NOT NULL,
  npc_id       INT REFERENCES npc_profiles(id),
  text         TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS gifts (
  id          SERIAL PRIMARY KEY,
  user_id     INT REFERENCES users(id) ON DELETE CASCADE,
  npc_id      INT REFERENCES npc_profiles(id),
  gift_key    TEXT NOT NULL,
  cost        INT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS leaderboard_scores (
  id          SERIAL PRIMARY KEY,
  user_id     INT REFERENCES users(id) ON DELETE CASCADE,
  category    TEXT NOT NULL CHECK (category IN ('kiss','music','heart','hug','smile')),
  score       BIGINT NOT NULL DEFAULT 0,
  UNIQUE(user_id, category)
);

CREATE TABLE IF NOT EXISTS achievements (
  id           SERIAL PRIMARY KEY,
  achv_key     TEXT UNIQUE NOT NULL,
  name         TEXT NOT NULL,
  description  TEXT,
  stars        INT NOT NULL DEFAULT 3,
  icon_url     TEXT,
  goal         INT NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS user_achievements (
  id              SERIAL PRIMARY KEY,
  user_id         INT REFERENCES users(id) ON DELETE CASCADE,
  achievement_id  INT REFERENCES achievements(id) ON DELETE CASCADE,
  progress        INT NOT NULL DEFAULT 0,
  completed       BOOLEAN NOT NULL DEFAULT FALSE,
  completed_at    TIMESTAMPTZ,
  UNIQUE(user_id, achievement_id)
);

CREATE TABLE IF NOT EXISTS wheel_spins (
  id          SERIAL PRIMARY KEY,
  user_id     INT REFERENCES users(id) ON DELETE CASCADE,
  reward_type TEXT NOT NULL,
  amount      INT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_leaderboard_cat_score ON leaderboard_scores(category, score DESC);
CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
"""

NPC_SEED = [
    ("Serkan", 24, "male", "/img/npc/serkan.svg", "flirty"),
    ("Gamze", 23, "female", "/img/npc/gamze.svg", "friendly"),
    ("Gizem", 22, "female", "/img/npc/gizem.svg", "funny"),
    ("Kübra", 25, "female", "/img/npc/kubra.svg", "shy"),
    ("Mehmet", 27, "male", "/img/npc/mehmet.svg", "friendly"),
    ("Ömer", 26, "male", "/img/npc/omer.svg", "funny"),
    ("Aleyna", 21, "female", "/img/npc/aleyna.svg", "flirty"),
    ("Kıvanç", 24, "male", "/img/npc/kivanc.svg", "friendly"),
    ("Burak", 28, "male", "/img/npc/burak.svg", "shy"),
    ("Yağmur", 23, "female", "/img/npc/yagmur.svg", "flirty"),
    ("Ahmet", 25, "male", "/img/npc/ahmet.svg", "friendly"),
]

ACHV_SEED = [
    ("first_spin", "İlk Çevirmə", "Şişəni ilk dəfə çevir", 3, 1),
    ("first_gift", "İlk Hədiyyə", "İlk hədiyyəni göndər", 3, 1),
    ("first_kiss", "İlk Öpüş", "İlk dəfə öp emoji-si göndər", 3, 1),
    ("hearts_100", "Yüz Ürək", "100 ürək qazan", 4, 100),
    ("hearts_1000", "Min Ürək", "1000 ürək qazan", 5, 1000),
    ("gifts_10", "Səxavətli", "10 hədiyyə göndər", 4, 10),
    ("spins_50", "Şişə Ustası", "50 dəfə şişəni çevir", 5, 50),
    ("wheel_master", "Çarxıfələk Ustası", "Çarxıfələkdə böyük ikramiyəni qazan", 6, 1),
    ("social_butterfly", "Sosial Kəpənək", "20 fərqli profil ilə söhbət et", 5, 20),
]

GIFT_CATALOG = {
    "crown":     {"cost": 50,  "category": "heart"},
    "kiss":      {"cost": 10,  "category": "kiss"},
    "gem":       {"cost": 100, "category": "heart"},
    "strawberry":{"cost": 5,   "category": "heart"},
    "tomato":    {"cost": 1,   "category": "smile"},
    "rose":      {"cost": 20,  "category": "heart"},
    "milk":      {"cost": 3,   "category": "hug"},
    "teddy":     {"cost": 30,  "category": "hug"},
    "icecream":  {"cost": 8,   "category": "smile"},
    "champagne": {"cost": 15,  "category": "music"},
    "wine":      {"cost": 12,  "category": "music"},
    "cocktail":  {"cost": 15,  "category": "music"},
    "cap":       {"cost": 7,   "category": "smile"},
    "lime":      {"cost": 4,   "category": "smile"},
    "ring":      {"cost": 200, "category": "heart"},
}

WHEEL_SLICES = [
    {"type": "hearts", "amount": 3},
    {"type": "hearts", "amount": 7},
    {"type": "hearts", "amount": 5},
    {"type": "hearts", "amount": 25},
    {"type": "hearts", "amount": 3},
    {"type": "hearts", "amount": 1000},  # böyük ikramiyə (nadir)
    {"type": "chance", "amount": 1},
    {"type": "hearts", "amount": 3},
    {"type": "hearts", "amount": 100},
    {"type": "hearts", "amount": 3},
    {"type": "hearts", "amount": 10},
    {"type": "hearts", "amount": 5},
]

GIFT_REPLIES = {
    "friendly": [
        "Hey! Hediye için teşekkürler :) Nasılsın?",
        "Çok naziksin, teşekkürler! Bugün nasıl geçiyor?",
    ],
    "flirty": [
        "Vayy, ne tatlısın böyle 😉 Teşekkürler canım!",
        "Bunu hiç beklemiyordum, çok hoşuma gitti 😘",
    ],
    "shy": [
        "Aa... teşekkür ederim, çok utandım :)",
        "Bunu bana mı gönderdin? Çok naziksin...",
    ],
    "funny": [
        "Hahaha bu neydi böyle 😂 ama teşekkürler!",
        "Resmen şoke oldum, cebimi mi soydun 😄",
    ],
}

CHAT_REPLIES = {
    "friendly": ["İyiyim, sen nasılsın?", "Bugün güzel geçiyor, senden ne haber?"],
    "flirty": ["Seninle konuşmak güzel 😊", "Biraz daha anlat kendinden..."],
    "shy": ["Hmm, iyiyim sanırım :)", "Pek konuşkan değilim ama... merhaba"],
    "funny": ["İyiyim valla, sen ne bu enerji 😄", "Hoş geldin, eğlenceli biri gibisin"],
}


def reply_to_gift(personality: str) -> str:
    return random.choice(GIFT_REPLIES.get(personality, GIFT_REPLIES["friendly"]))


def reply_to_chat(personality: str) -> str:
    return random.choice(CHAT_REPLIES.get(personality, CHAT_REPLIES["friendly"]))


# =========================================================================
# 3) VERİLƏNLƏR BAZASI HAVUZU + BAŞLANĞIC
# =========================================================================

db_pool: asyncpg.Pool | None = None


async def init_db():
    global db_pool
    db_pool = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=10)
    async with db_pool.acquire() as conn:
        await conn.execute(SCHEMA_SQL)
        for name, age, gender, photo, personality in NPC_SEED:
            await conn.execute(
                """INSERT INTO npc_profiles (name, age, gender, photo_url, personality)
                   SELECT $1,$2,$3,$4,$5
                   WHERE NOT EXISTS (SELECT 1 FROM npc_profiles WHERE name=$1)""",
                name, age, gender, photo, personality,
            )
        for key, name, desc, stars, goal in ACHV_SEED:
            await conn.execute(
                """INSERT INTO achievements (achv_key, name, description, stars, goal)
                   VALUES ($1,$2,$3,$4,$5) ON CONFLICT (achv_key) DO NOTHING""",
                key, name, desc, stars, goal,
            )
    log.info("✅ Verilənlər bazası hazırdır")


# =========================================================================
# 4) KÖMƏKÇİ FUNKSİYALAR (oyun məntiqi)
# =========================================================================

async def get_or_create_user(conn, tg_user: dict):
    row = await conn.fetchrow("SELECT * FROM users WHERE telegram_id=$1", tg_user["id"])
    if row:
        return dict(row)
    row = await conn.fetchrow(
        """INSERT INTO users (telegram_id, username, first_name, photo_url, hearts, chances)
           VALUES ($1,$2,$3,$4,$5,$6) RETURNING *""",
        tg_user["id"], tg_user.get("username"), tg_user.get("first_name"),
        tg_user.get("photo_url"), STARTING_HEARTS, STARTING_CHANCES,
    )
    return dict(row)


async def seat_table(conn, user_id: int):
    npcs = await conn.fetch("SELECT id FROM npc_profiles ORDER BY random() LIMIT 11")
    seated_ids = [n["id"] for n in npcs]
    existing = await conn.fetchrow("SELECT * FROM game_sessions WHERE user_id=$1", user_id)
    if existing:
        row = await conn.fetchrow(
            """UPDATE game_sessions SET seated_npc_ids=$1, status='waiting',
               bottle_target=NULL, updated_at=now() WHERE user_id=$2 RETURNING *""",
            seated_ids, user_id,
        )
    else:
        row = await conn.fetchrow(
            """INSERT INTO game_sessions (user_id, seated_npc_ids, status)
               VALUES ($1,$2,'waiting') RETURNING *""",
            user_id, seated_ids,
        )
    return dict(row)


async def add_score(conn, user_id: int, category: str, amount: int):
    await conn.execute(
        """INSERT INTO leaderboard_scores (user_id, category, score) VALUES ($1,$2,$3)
           ON CONFLICT (user_id, category) DO UPDATE
           SET score = leaderboard_scores.score + $3""",
        user_id, category, amount,
    )


async def bump_achievement(conn, user_id: int, key: str, increment_by: int = 1):
    achv = await conn.fetchrow("SELECT * FROM achievements WHERE achv_key=$1", key)
    if not achv:
        return None
    existing = await conn.fetchrow(
        "SELECT * FROM user_achievements WHERE user_id=$1 AND achievement_id=$2",
        user_id, achv["id"],
    )
    progress = increment_by if not existing else existing["progress"] + increment_by
    completed = progress >= achv["goal"]
    await conn.execute(
        """INSERT INTO user_achievements (user_id, achievement_id, progress, completed, completed_at)
           VALUES ($1,$2,$3,$4, CASE WHEN $4 THEN now() ELSE NULL END)
           ON CONFLICT (user_id, achievement_id) DO UPDATE
           SET progress=$3, completed=$4,
               completed_at = CASE WHEN $4 AND user_achievements.completed=FALSE
                                    THEN now() ELSE user_achievements.completed_at END""",
        user_id, achv["id"], progress, completed,
    )


def row_to_json(row):
    """asyncpg Record -> JSON-safe dict (datetime-ləri stringə çevirir)"""
    d = dict(row)
    for k, v in d.items():
        if isinstance(v, datetime):
            d[k] = v.isoformat()
    return d


# =========================================================================
# 5) SOCKET.IO (real-time söhbət)
# =========================================================================

sio = socketio.AsyncServer(async_mode="asgi", cors_allowed_origins="*")


@sio.event
async def register(sid, user_id):
    await sio.enter_room(sid, f"user:{user_id}")


# =========================================================================
# 6) FASTAPI TƏTBİQİ VƏ ENDPOINT-LƏR
# =========================================================================

api = FastAPI()


@api.on_event("startup")
async def on_startup():
    await init_db()


@api.post("/api/auth")
async def auth(req: Request):
    body = await req.json()
    tg_user = body.get("tgUser")
    if not tg_user or "id" not in tg_user:
        raise HTTPException(400, "tgUser lazımdır")
    async with db_pool.acquire() as conn:
        user = await get_or_create_user(conn, tg_user)
    return {"user": row_to_json(user)}


@api.post("/api/profile")
async def set_profile(req: Request):
    body = await req.json()
    async with db_pool.acquire() as conn:
        row = await conn.fetchrow(
            "UPDATE users SET gender=$1, age=$2 WHERE id=$3 RETURNING *",
            body["gender"], body["age"], body["userId"],
        )
    return {"user": row_to_json(row)}


@api.post("/api/game/join")
async def game_join(req: Request):
    body = await req.json()
    user_id = body["userId"]
    async with db_pool.acquire() as conn:
        session = await seat_table(conn, user_id)
        npcs = await conn.fetch(
            "SELECT * FROM npc_profiles WHERE id = ANY($1::int[])", session["seated_npc_ids"]
        )
    return {"session": session, "npcs": [dict(n) for n in npcs]}


@api.post("/api/game/spin")
async def game_spin(req: Request):
    body = await req.json()
    user_id = body["userId"]
    async with db_pool.acquire() as conn:
        user = await conn.fetchrow("SELECT * FROM users WHERE id=$1", user_id)
        if not user:
            raise HTTPException(404, "istifadəçi tapılmadı")
        if user["chances"] < 1:
            raise HTTPException(400, "Şans kifayət etmir")

        session = await conn.fetchrow("SELECT * FROM game_sessions WHERE user_id=$1", user_id)
        if not session:
            raise HTTPException(400, "Əvvəlcə masaya qoşulun")

        target_id = random.choice(session["seated_npc_ids"])

        await conn.execute("UPDATE users SET chances = chances - 1 WHERE id=$1", user_id)
        await conn.execute(
            "UPDATE game_sessions SET bottle_target=$1, status='matched', updated_at=now() WHERE id=$2",
            target_id, session["id"],
        )
        await bump_achievement(conn, user_id, "first_spin", 1)
        await bump_achievement(conn, user_id, "spins_50", 1)

        npc = await conn.fetchrow("SELECT * FROM npc_profiles WHERE id=$1", target_id)
    return {"target": dict(npc)}


@api.post("/api/game/gift")
async def game_gift(req: Request):
    body = await req.json()
    user_id, npc_id, gift_key = body["userId"], body["npcId"], body["giftKey"]
    gift = GIFT_CATALOG.get(gift_key)
    if not gift:
        raise HTTPException(400, "naməlum hədiyyə")

    async with db_pool.acquire() as conn:
        user = await conn.fetchrow("SELECT * FROM users WHERE id=$1", user_id)
        if not user or user["hearts"] < gift["cost"]:
            raise HTTPException(400, "ürək kifayət etmir")

        await conn.execute("UPDATE users SET hearts = hearts - $1 WHERE id=$2", gift["cost"], user_id)
        await conn.execute(
            "INSERT INTO gifts (user_id, npc_id, gift_key, cost) VALUES ($1,$2,$3,$4)",
            user_id, npc_id, gift_key, gift["cost"],
        )
        await add_score(conn, user_id, gift["category"], gift["cost"])
        await bump_achievement(conn, user_id, "first_gift", 1)
        await bump_achievement(conn, user_id, "gifts_10", 1)
        if gift_key == "kiss":
            await bump_achievement(conn, user_id, "first_kiss", 1)

        npc = await conn.fetchrow("SELECT * FROM npc_profiles WHERE id=$1", npc_id)
        reply = reply_to_gift(npc["personality"])

        session = await conn.fetchrow("SELECT * FROM game_sessions WHERE user_id=$1", user_id)
        await conn.execute(
            "INSERT INTO messages (session_id, sender, npc_id, text) VALUES ($1,'npc',$2,$3)",
            session["id"], npc_id, f"{npc['name']}, {reply}",
        )
    return {"ok": True, "npcReply": reply, "npc": dict(npc)}


@api.post("/api/game/message")
async def game_message(req: Request):
    body = await req.json()
    user_id, npc_id, text = body["userId"], body["npcId"], body["text"]

    async with db_pool.acquire() as conn:
        session = await conn.fetchrow("SELECT * FROM game_sessions WHERE user_id=$1", user_id)
        await conn.execute(
            "INSERT INTO messages (session_id, sender, npc_id, text) VALUES ($1,'user',$2,$3)",
            session["id"], npc_id, text,
        )
        npc = await conn.fetchrow("SELECT * FROM npc_profiles WHERE id=$1", npc_id)
        reply = reply_to_chat(npc["personality"])

    async def delayed_reply():
        await asyncio.sleep(1.2)
        async with db_pool.acquire() as conn2:
            sess2 = await conn2.fetchrow("SELECT * FROM game_sessions WHERE user_id=$1", user_id)
            await conn2.execute(
                "INSERT INTO messages (session_id, sender, npc_id, text) VALUES ($1,'npc',$2,$3)",
                sess2["id"], npc_id, reply,
            )
        await sio.emit("npc_message", {"npcId": npc_id, "text": reply, "npcName": npc["name"]},
                        room=f"user:{user_id}")

    asyncio.create_task(delayed_reply())
    return {"ok": True}


@api.post("/api/wheel/spin")
async def wheel_spin(req: Request):
    body = await req.json()
    user_id = body["userId"]
    async with db_pool.acquire() as conn:
        user = await conn.fetchrow("SELECT * FROM users WHERE id=$1", user_id)
        if not user or user["chances"] < 1:
            raise HTTPException(400, "Şans kifayət etmir")

        idx = random.randrange(len(WHEEL_SLICES))
        slice_ = WHEEL_SLICES[idx]

        await conn.execute("UPDATE users SET chances = chances - 1 WHERE id=$1", user_id)
        if slice_["type"] == "hearts":
            await conn.execute("UPDATE users SET hearts = hearts + $1 WHERE id=$2", slice_["amount"], user_id)
        else:
            await conn.execute("UPDATE users SET chances = chances + $1 WHERE id=$2", slice_["amount"], user_id)

        await conn.execute(
            "INSERT INTO wheel_spins (user_id, reward_type, amount) VALUES ($1,$2,$3)",
            user_id, slice_["type"], slice_["amount"],
        )
        if slice_["amount"] >= 1000:
            await bump_achievement(conn, user_id, "wheel_master", 1)

        fresh = await conn.fetchrow("SELECT * FROM users WHERE id=$1", user_id)
    return {"sliceIndex": idx, "slice": slice_, "user": row_to_json(fresh)}


@api.get("/api/leaderboard/{category}")
async def leaderboard(category: str):
    async with db_pool.acquire() as conn:
        rows = await conn.fetch(
            """SELECT u.id, u.username, u.first_name, u.photo_url, l.score
               FROM leaderboard_scores l JOIN users u ON u.id = l.user_id
               WHERE l.category=$1 ORDER BY l.score DESC LIMIT 25""",
            category,
        )
    return {"rows": [dict(r) for r in rows]}


@api.get("/api/achievements/{user_id}")
async def achievements(user_id: int):
    async with db_pool.acquire() as conn:
        rows = await conn.fetch(
            """SELECT a.*, COALESCE(ua.progress,0) AS progress, COALESCE(ua.completed,false) AS completed
               FROM achievements a
               LEFT JOIN user_achievements ua ON ua.achievement_id = a.id AND ua.user_id=$1
               ORDER BY a.id""",
            user_id,
        )
    return {"rows": [dict(r) for r in rows]}


# Statik fayllar (Mini App frontend) — /public qovluğu
api.mount("/", StaticFiles(directory="public", html=True), name="public")

# Socket.io-nu FastAPI ilə birləşdiririk (eyni ASGI tətbiqi kimi)
socket_app = socketio.ASGIApp(sio, other_asgi_app=api)


# =========================================================================
# 7) TELEGRAM BOT HANDLER-LƏRİ
# =========================================================================

async def start_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    keyboard = InlineKeyboardMarkup([
        [InlineKeyboardButton("🎲 Oyuna başla", web_app=WebAppInfo(url=WEBAPP_URL))]
    ])
    await update.message.reply_text(
        "Salam! 🍾 Spin the Bottle oyununa xoş gəldin.\n"
        "Aşağıdakı düymə ilə masaya otur və şişəni çevir!",
        reply_markup=keyboard,
    )


async def play_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    keyboard = InlineKeyboardMarkup([
        [InlineKeyboardButton("🍾 Şişəni çevir", web_app=WebAppInfo(url=WEBAPP_URL))]
    ])
    await update.message.reply_text("Masaya qayıt 👇", reply_markup=keyboard)


# =========================================================================
# 8) HƏR ŞEYİ EYNİ EVENT LOOP-DA BAŞLATMAQ
# =========================================================================

async def main():
    if not BOT_TOKEN:
        raise RuntimeError("BOT_TOKEN .env faylında təyin olunmayıb")

    application = Application.builder().token(BOT_TOKEN).build()
    application.add_handler(CommandHandler("start", start_handler))
    application.add_handler(CommandHandler("play", play_handler))

    uv_config = uvicorn.Config(socket_app, host="0.0.0.0", port=PORT, log_level="info")
    server = uvicorn.Server(uv_config)

    async with application:
        await application.start()
        await application.updater.start_polling()
        log.info("🤖 Bot polling rejimində işə düşdü")
        log.info(f"🍾 Mini App server {PORT} portunda işləyir")
        await server.serve()  # bloklayır, proqram bağlanana qədər
        await application.updater.stop()
        await application.stop()


if __name__ == "__main__":
    asyncio.run(main())
