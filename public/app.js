const tg = window.Telegram?.WebApp;
if (tg) { tg.ready(); tg.expand(); }

const API = ''; // eyni domendə işlədiyi üçün boş saxlanılır
const socket = io();

let state = {
  user: null,
  npcs: [],
  session: null,
  currentNpcId: null,
};

const GIFTS = [
  ['crown', '👑', 50], ['kiss', '💋', 10], ['gem', '💎', 100], ['strawberry', '🍓', 5],
  ['tomato', '🍅', 1], ['rose', '🌹', 20], ['milk', '🥛', 3], ['teddy', '🧸', 30],
  ['icecream', '🍨', 8], ['champagne', '🍾', 15], ['wine', '🍷', 12], ['cocktail', '🍹', 15],
  ['cap', '🧢', 7], ['lime', '🍸', 4], ['ring', '💍', 200],
];

// mövqe faizləri (12 oturacaq: 0-cı yer = istifadəçinin özü)
const SEAT_POSITIONS = [
  { top: '14%', left: '50%' },  // 0 - user (üstdə, özü göstərilir amma toxunulmur)
  { top: '10%', left: '20%' },  // 1
  { top: '10%', left: '80%' },  // 2
  { top: '32%', left: '8%'  },  // 3
  { top: '32%', left: '92%' },  // 4
  { top: '52%', left: '8%'  },  // 5
  { top: '52%', left: '92%' },  // 6
  { top: '72%', left: '18%' },  // 7
  { top: '72%', left: '82%' },  // 8
  { top: '86%', left: '35%' },  // 9
  { top: '86%', left: '65%' },  // 10
  { top: '10%', left: '50%' },  // 11 (ehtiyat)
];

function $(id) { return document.getElementById(id); }

// ---------- TUTORIAL (ilk oyun üçün) ----------
const isFirstPlay = !localStorage.getItem('stb_tutorial_done');
let tutorialStep = 0; // 0 = deaktiv

function showTutorialStep(n) {
  if (!isFirstPlay) return;
  tutorialStep = n;
  $('tutorialStep').classList.remove('hidden');
  $('tutorialStepLabel').textContent = `Adım ${n} / 5`;
}
function hideTutorialStep() {
  $('tutorialStep').classList.add('hidden');
}
function showTutorialHint(text, x, y) {
  if (!isFirstPlay) return;
  const hint = $('tutorialHint');
  hint.classList.remove('hidden');
  $('tutorialHintText').textContent = text;
  hint.style.left = x; hint.style.top = y;
}
function hideTutorialHint() {
  $('tutorialHint').classList.add('hidden');
}
function finishTutorial() {
  if (!isFirstPlay) return;
  localStorage.setItem('stb_tutorial_done', '1');
  hideTutorialStep();
  hideTutorialHint();
}

// ---------- GÖZLƏMƏ EKRANI ----------
function showWaitScreen(name, photo) {
  $('waitAvatar').src = photo || 'img/npc/default.svg';
  $('waitName').textContent = name || '';
  $('waitScreen').classList.remove('hidden');
}
function hideWaitScreen() {
  $('waitScreen').classList.add('hidden');
}

async function api(path, opts = {}) {
  const res = await fetch(API + path, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'server xətası');
  }
  return res.json();
}

// ---------- BAŞLANĞIC ----------

async function init() {
  const tgUser = tg?.initDataUnsafe?.user || { id: Date.now(), first_name: 'Qonaq' };
  const { user } = await api('/api/auth', { method: 'POST', body: { tgUser } });
  state.user = user;
  $('heartsCount').textContent = user.hearts;
  $('tableNumber').textContent = user.table_number;
  socket.emit('register', user.id);

  if (!user.gender || !user.age) {
    openProfileModal();
  } else {
    await joinTable();
  }
}

// ---------- PROFİL MODALI ----------

let chosenGender = null;
function openProfileModal() {
  $('profileModal').classList.remove('hidden');
}

document.querySelectorAll('.gender-btn').forEach((btn) => {
  btn.onclick = () => {
    document.querySelectorAll('.gender-btn').forEach((b) => b.classList.remove('selected'));
    btn.classList.add('selected');
    chosenGender = btn.dataset.gender;
    checkProfileForm();
  };
});
$('ageSelect').onchange = checkProfileForm;
function checkProfileForm() {
  $('btnProfileContinue').disabled = !(chosenGender && $('ageSelect').value);
}
$('btnProfileContinue').onclick = async () => {
  const { user } = await api('/api/profile', {
    method: 'POST',
    body: { userId: state.user.id, gender: chosenGender, age: parseInt($('ageSelect').value, 10) },
  });
  state.user = user;
  $('profileModal').classList.add('hidden');
  await joinTable();
};

// ---------- MASA / NPC HALQASI ----------

async function joinTable() {
  showWaitScreen(state.user.first_name || 'Sən', state.user.photo_url);
  $('centerText').textContent = '';
  const { session, npcs } = await api('/api/game/join', { method: 'POST', body: { userId: state.user.id } });
  state.session = session;
  state.npcs = npcs;
  renderRing();
  setTimeout(() => {
    hideWaitScreen();
    $('centerText').textContent = 'Sıra sende!\nŞişeye tıkla!';
    if (isFirstPlay) showTutorialStep(1);
  }, 1200);
}

function renderRing() {
  const ring = $('npcRing');
  ring.innerHTML = '';

  // istifadəçinin öz yeri (0-cı mövqe)
  const meSeat = document.createElement('div');
  meSeat.className = 'npc-seat';
  meSeat.style.top = SEAT_POSITIONS[0].top;
  meSeat.style.left = SEAT_POSITIONS[0].left;
  meSeat.innerHTML = `<img src="${state.user.photo_url || 'img/npc/default.svg'}"/><div class="name">${state.user.first_name || 'Sən'}</div>`;
  ring.appendChild(meSeat);

  state.npcs.forEach((npc, i) => {
    const pos = SEAT_POSITIONS[i + 1] || SEAT_POSITIONS[SEAT_POSITIONS.length - 1];
    const seat = document.createElement('div');
    seat.className = 'npc-seat';
    seat.dataset.npcId = npc.id;
    seat.style.top = pos.top;
    seat.style.left = pos.left;
    seat.innerHTML = `<img src="${npc.photo_url}"/><div class="name">${npc.name}</div>`;
    ring.appendChild(seat);
  });
}

// ---------- ŞİŞƏ ÇEVİRMƏ ----------

$('bottle').onclick = async () => {
  if (state.user.chances < 1) {
    $('centerText').textContent = 'Şansınız bitti! 🎡 Çarkıfelekten kazanın';
    return;
  }
  $('centerText').textContent = '';
  try {
    const { target } = await api('/api/game/spin', { method: 'POST', body: { userId: state.user.id } });
    state.user.chances -= 1;

    const seatIndex = state.npcs.findIndex((n) => n.id === target.id);
    const seatEl = document.querySelector(`.npc-seat[data-npc-id="${target.id}"]`);
    const targetAngle = seatAngle(seatIndex + 1) + 720; // bir neçə tam dövr + hədəf bucağı

    $('bottle').style.transform = `rotate(${targetAngle}deg)`;

    setTimeout(() => {
      document.querySelectorAll('.npc-seat').forEach((s) => s.classList.add('dim'));
      if (seatEl) seatEl.classList.remove('dim'), seatEl.classList.add('highlight');
      $('centerText').textContent = `${target.name} ile eşleştin! 🎉`;
      if (isFirstPlay) { showTutorialStep(3); showTutorialHint('Bir hediye seç', '18%', '78%'); }
      openGiftPicker(target.id);
    }, 1900);
  } catch (e) {
    $('centerText').textContent = e.message;
  }
};

function seatAngle(seatIdx) {
  // 12 oturacağı saat əqrəbi istiqamətində bərabər bölürük (sadə vizual approximasiya)
  return (360 / 12) * seatIdx;
}

// ---------- HƏDİYYƏ SEÇİCİ ----------

function openGiftPicker(npcId) {
  state.currentNpcId = npcId;
  const grid = $('giftGrid');
  grid.innerHTML = '';
  GIFTS.forEach(([key, emoji, cost]) => {
    const div = document.createElement('div');
    div.className = 'gift-item';
    div.innerHTML = `${emoji}<span class="cost">${cost}❤️</span>`;
    div.onclick = () => sendGift(key);
    grid.appendChild(div);
  });
  $('giftPicker').classList.remove('hidden');
}

async function sendGift(giftKey) {
  try {
    const { npcReply, npc } = await api('/api/game/gift', {
      method: 'POST',
      body: { userId: state.user.id, npcId: state.currentNpcId, giftKey },
    });
    $('giftPicker').classList.add('hidden');
    hideTutorialHint();
    refreshHearts();
    openChat(npc, npcReply);
    if (isFirstPlay) { showTutorialStep(4); showTutorialHint('Ona bir şeyler yaz', '50%', '68%'); }
  } catch (e) {
    alert(e.message);
  }
}

async function refreshHearts() {
  const { user } = await api('/api/auth', {
    method: 'POST',
    body: { tgUser: tg?.initDataUnsafe?.user || { id: state.user.telegram_id } },
  });
  state.user = user;
  $('heartsCount').textContent = user.hearts;
}

// ---------- SÖHBƏT ----------

function openChat(npc, firstReply) {
  $('chatBox').classList.remove('hidden');
  const box = $('chatMessages');
  box.innerHTML = '';
  addMsg(npc.name, firstReply, 'npc');
}

function addMsg(sender, text, who) {
  const box = $('chatMessages');
  const div = document.createElement('div');
  div.className = `chat-msg ${who}`;
  div.innerHTML = who === 'npc'
    ? `<div class="bubble"><span class="sender">${sender}</span><br>${text}</div>`
    : `<div class="bubble">${text}</div>`;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}

$('btnSend').onclick = sendChatMessage;
$('chatInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChatMessage(); });

async function sendChatMessage() {
  const text = $('chatInput').value.trim();
  if (!text || !state.currentNpcId) return;
  addMsg('Sən', text, 'user');
  $('chatInput').value = '';
  if (isFirstPlay && tutorialStep === 4) {
    hideTutorialHint();
    showTutorialStep(5);
    setTimeout(() => {
      hideTutorialStep();
      showTutorialHint('Öpmeyi, sohbet etmeyi ve hediyeler göndermeyi öğrenmiştin!\nHaydi bir başka tabloyu kontrol edelim', '50%', '52%');
      $('tutorialHint').classList.add('center-note');
      const refreshHint = document.createElement('div');
      refreshHint.className = 'tutorial-refresh-hint';
      refreshHint.innerHTML = 'Tıkla! ↗';
      document.body.appendChild(refreshHint);
      $('btnRefresh').onclick = async () => {
        refreshHint.remove();
        finishTutorial();
        document.querySelectorAll('.npc-seat').forEach((s) => { s.classList.remove('dim'); s.classList.remove('highlight'); });
        $('bottle').style.transform = 'rotate(0deg)';
        $('chatBox').classList.add('hidden');
        await joinTable();
      };
    }, 1500);
  }
  await api('/api/game/message', { method: 'POST', body: { userId: state.user.id, npcId: state.currentNpcId, text } });
}

socket.on('npc_message', ({ npcId, text, npcName }) => {
  if (npcId === state.currentNpcId) addMsg(npcName, text, 'npc');
});

// ---------- ÇARXIFƏLƏK ----------

$('btnWheel').onclick = () => {
  $('wheelModal').classList.remove('hidden');
  $('wheelChances').textContent = state.user.chances ?? 0;
};
$('btnSpinWheel').onclick = async () => {
  try {
    const { sliceIndex, slice, user } = await api('/api/wheel/spin', { method: 'POST', body: { userId: state.user.id } });
    const anglePerSlice = 360 / 12;
    const finalAngle = 360 * 4 + (360 - sliceIndex * anglePerSlice) - anglePerSlice / 2;
    $('wheelSpinner').style.transform = `rotate(${finalAngle}deg)`;
    setTimeout(() => {
      state.user = user;
      $('heartsCount').textContent = user.hearts;
      $('wheelChances').textContent = user.chances ?? 0;
      const box = $('wheelWinnerBox');
      box.classList.remove('hidden');
      $('wheelWinnerAvatar').src = state.user.photo_url || 'img/npc/default.svg';
      $('wheelWinnerName').textContent = state.user.first_name || 'Sən';
      $('wheelWinnerText').textContent = slice.type === 'hearts'
        ? `büyük ikramiyeyi kazandı ve ❤️${slice.amount} aldı`
        : `+${slice.amount} şans kazandı`;
    }, 3100);
  } catch (e) {
    alert(e.message);
  }
};

// ---------- REYTİNQ ----------

$('btnTrophy').onclick = () => { $('leaderboardModal').classList.remove('hidden'); loadLeaderboard('kiss'); };
document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.onclick = () => {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    loadLeaderboard(btn.dataset.cat);
  };
});

const CAT_TITLES = { kiss: 'En çok öpülenler', music: 'En iyi DJ\'ler', heart: 'En pahalı', hug: 'En sıcak', smile: 'En duygusal' };

async function loadLeaderboard(cat) {
  $('lbTitle').textContent = CAT_TITLES[cat] || '';
  const { rows } = await api(`/api/leaderboard/${cat}`);
  const list = $('lbList');
  list.innerHTML = '';
  rows.forEach((r, i) => {
    if (i === 10) {
      const sep1 = document.createElement('div');
      sep1.className = 'lb-sep';
      sep1.textContent = 'En iyiler - En iyi oyuncuların 10';
      list.appendChild(sep1);
      const sep2 = document.createElement('div');
      sep2.className = 'lb-sep';
      sep2.textContent = 'En iyiler - En iyi oyuncuların 25';
      list.appendChild(sep2);
    }
    const div = document.createElement('div');
    div.className = 'lb-row' + (r.id === state.user.id ? ' me' : '');
    div.innerHTML = `<span class="rank">${i + 1}.</span>
      <img src="${r.photo_url || 'img/npc/default.svg'}"/>
      <span class="name">${r.first_name || r.username || 'Anonim'}</span>
      <span class="score">${r.score.toLocaleString()}</span>`;
    list.appendChild(div);
  });
  if (!rows.find((r) => r.id === state.user.id)) {
    const div = document.createElement('div');
    div.className = 'lb-row me';
    div.innerHTML = `<span class="rank">–</span><img src="${state.user.photo_url || 'img/npc/default.svg'}"/>
      <span class="name">${state.user.first_name}</span><span class="score">0</span>`;
    list.appendChild(div);
  }
}

// ---------- NAİLİYYƏTLƏR ----------

$('btnMenu').onclick = async () => {
  $('achvModal').classList.remove('hidden');
  const { rows } = await api(`/api/achievements/${state.user.id}`);
  const grid = $('achvGrid');
  grid.innerHTML = '';
  let done = 0;
  rows.forEach((a) => {
    if (a.completed) done++;
    const div = document.createElement('div');
    div.className = 'achv-item' + (a.completed ? ' done' : '');
    div.title = `${a.name} — ${a.description} (${a.progress}/${a.goal})`;
    div.innerHTML = `<span class="stars">${'⭐'.repeat(Math.min(a.stars, 5))}</span>${a.completed ? '🏆' : '❔'}`;
    grid.appendChild(div);
  });
  $('achvCount').textContent = `${done}/${rows.length}`;
};

// ---------- AYARLAR ----------

$('btnSettings').onclick = () => $('settingsModal').classList.remove('hidden');
$('soundRange').value = 100;
$('musicRange').value = 100;
$('btnProfileSettings').onclick = () => { $('settingsModal').classList.add('hidden'); openProfileModal(); };
$('btnInvite').onclick = () => {
  const link = `https://t.me/share/url?url=https://t.me/${'YOUR_BOT_USERNAME'}`;
  if (tg) tg.openTelegramLink(link); else window.open(link, '_blank');
};
$('btnContact').onclick = () => alert('Dəstək: @your_support_username');

// ---------- MODAL BAĞLAMA ----------

document.querySelectorAll('[data-close]').forEach((btn) => {
  btn.onclick = () => $(btn.dataset.close).classList.add('hidden');
});

// ---------- YENİ MASA ----------

$('btnRefresh').onclick = async () => {
  document.querySelectorAll('.npc-seat').forEach((s) => { s.classList.remove('dim'); s.classList.remove('highlight'); });
  $('bottle').style.transform = 'rotate(0deg)';
  $('chatBox').classList.add('hidden');
  await joinTable();
};

init();
