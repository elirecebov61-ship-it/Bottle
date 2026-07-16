const tg = window.Telegram?.WebApp;
if (tg) { tg.ready(); tg.expand(); }

// ---------- SPLASH EKRANI (yüklənmə -> loqo -> oyun) ----------
(function runSplashSequence() {
  const splash = document.getElementById('splashScreen');
  const loadingPhase = document.getElementById('splashLoading');
  const logoPhase = document.getElementById('splashLogo');
  if (!splash) return;

  const LOADING_MS = 2500; // yüklənmə zolağı ekranı
  const LOGO_MS = 1000;    // loqo ekranı

  setTimeout(() => {
    loadingPhase.classList.add('hidden');
    logoPhase.classList.remove('hidden');

    setTimeout(() => {
      splash.classList.add('splash-fade-out');
      setTimeout(() => splash.remove(), 400);
    }, LOGO_MS);
  }, LOADING_MS);
})();

const API = ''; // eyni domendə işlədiyi üçün boş saxlanılır
const socket = io();

let state = {
  user: null,
  npcs: [],
  session: null,
  currentNpcId: null,
  giftCatalog: [],
  gestureCatalog: [],
  activeGiftTab: 'gift',
  multiSelectMode: false,
  selectedNpcIds: [],
};

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
  const { session, npcs, user } = await api('/api/game/join', { method: 'POST', body: { userId: state.user.id } });
  state.session = session;
  state.npcs = npcs;
  state.currentNpcId = npcs[0] ? npcs[0].id : null;
  if (user) { state.user = user; $('tableNumber').textContent = user.table_number; }
  renderRing();
  startAmbientChat();
  setTimeout(() => {
    hideWaitScreen();
    $('centerText').textContent = 'Sonraki sırayı\nbekliyoruz';
    if (isFirstPlay) showTutorialStep(1);
    setTimeout(() => {
      $('centerText').textContent = 'Sıra sende!\nŞişeye tıkla!';
    }, 1500);
  }, 1200);
}

function renderRing() {
  const ring = $('npcRing');
  ring.innerHTML = '';

  // istifadəçinin öz yeri (0-cı mövqe) — toxunanda Stil (çərçivə) mağazası açılır
  const meSeat = document.createElement('div');
  meSeat.className = 'npc-seat me';
  meSeat.style.top = SEAT_POSITIONS[0].top;
  meSeat.style.left = SEAT_POSITIONS[0].left;
  meSeat.innerHTML = `<div class="avatar-wrap">
      <img src="${state.user.photo_url || 'img/npc/default.svg'}"/>
    </div>
    <div class="name">${state.user.first_name || 'Sən'}</div>`;
  meSeat.querySelector('.avatar-wrap').onclick = openFrameShop;
  ring.appendChild(meSeat);

  state.npcs.forEach((npc, i) => {
    const pos = SEAT_POSITIONS[i + 1] || SEAT_POSITIONS[SEAT_POSITIONS.length - 1];
    const seat = document.createElement('div');
    seat.className = 'npc-seat';
    seat.dataset.npcId = npc.id;
    seat.style.top = pos.top;
    seat.style.left = pos.left;
    seat.innerHTML = `<div class="avatar-wrap">
        <img src="${npc.photo_url}"/>
        <span class="kiss-badge">${npc.kiss_count ?? 0}</span>
        <span class="drink-icon">🥃</span>
      </div>
      <div class="name">${npc.name}</div>`;
    ring.appendChild(seat);
  });
}

// ---------- ŞİŞƏ ÇEVİRMƏ ----------

let longPressTimer = null;
$('bottle').addEventListener('pointerdown', () => {
  longPressTimer = setTimeout(() => openBottleLongPressMenu(), 550);
});
['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => {
  $('bottle').addEventListener(ev, () => clearTimeout(longPressTimer));
});

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

    $('spinLabel').classList.remove('hidden');
    $('bottle').style.transform = `rotate(${targetAngle}deg)`;

    setTimeout(() => {
      $('spinLabel').classList.add('hidden');
      document.querySelectorAll('.npc-seat').forEach((s) => s.classList.add('dim'));
      if (seatEl) seatEl.classList.remove('dim'), seatEl.classList.add('highlight');
      if (isFirstPlay) { showTutorialStep(3); showTutorialHint('Bir hediye seç', '18%', '78%'); }
      openChoiceOverlay(target);
    }, 1900);
  } catch (e) {
    $('centerText').textContent = e.message;
  }
};

function seatAngle(seatIdx) {
  // 12 oturacağı saat əqrəbi istiqamətində bərabər bölürük (sadə vizual approximasiya)
  return (360 / 12) * seatIdx;
}

// ---------- SEÇİMİN (Vazgeç / Öp) + GERİ ÖPECEK Mİ ----------

function openChoiceOverlay(target) {
  state.currentNpcId = target.id;
  $('choiceUserAvatar').src = state.user.photo_url || 'img/npc/default.svg';
  $('choiceTargetAvatar').src = target.photo_url;
  $('choiceNumber').textContent = target.kiss_count ?? 0;
  $('choiceOverlay').classList.remove('hidden');
}

$('btnChoiceCancel').onclick = () => {
  $('choiceOverlay').classList.add('hidden');
  document.querySelectorAll('.npc-seat').forEach((s) => { s.classList.remove('dim'); s.classList.remove('highlight'); });
  $('bottle').style.transform = 'rotate(0deg)';
  $('centerText').textContent = 'Sıra sende!\nŞişeye tıkla!';
};

$('btnChoiceKiss').onclick = async () => {
  $('choiceOverlay').classList.add('hidden');
  const target = state.npcs.find((n) => n.id === state.currentNpcId);
  $('kissBackTargetAvatar').src = target.photo_url;
  $('kissBackUserAvatar').src = state.user.photo_url || 'img/npc/default.svg';
  $('kissBackOverlay').classList.remove('hidden');

  try {
    const { npc } = await api('/api/game/kiss', { method: 'POST', body: { userId: state.user.id, npcId: state.currentNpcId } });
    const idx = state.npcs.findIndex((n) => n.id === npc.id);
    if (idx >= 0) state.npcs[idx].kiss_count = npc.kiss_count;
    const badge = document.querySelector(`.npc-seat[data-npc-id="${npc.id}"] .kiss-badge`);
    if (badge) badge.textContent = npc.kiss_count;
  } catch (e) { /* sessiz keç */ }

  setTimeout(() => {
    $('kissBackOverlay').classList.add('hidden');
    $('centerText').textContent = `${target.name} ile eşleştin! 🎉`;
    openGiftPicker(target.id);
  }, 1500);
};

// ---------- ŞİŞƏ UZUN-BASMA MENYUSU ----------

function openBottleLongPressMenu() {
  $('bottleLongPressMenu').classList.remove('hidden');
}
document.addEventListener('click', (e) => {
  const menu = $('bottleLongPressMenu');
  if (!menu.classList.contains('hidden') && !menu.contains(e.target) && e.target.id !== 'bottle') {
    menu.classList.add('hidden');
  }
});
$('btnOpenBoosters').onclick = () => { $('bottleLongPressMenu').classList.add('hidden'); openBoosterModal(); };
$('btnOpenBottleShop').onclick = () => { $('bottleLongPressMenu').classList.add('hidden'); openBottleShop(); };

// ---------- HƏDİYYƏ / JEST SEÇİCİ ----------

async function ensureCatalogsLoaded() {
  if (!state.giftCatalog.length) {
    const { rows } = await api('/api/gifts');
    state.giftCatalog = rows;
  }
  if (!state.gestureCatalog.length) {
    const { rows } = await api('/api/gestures');
    state.gestureCatalog = rows;
  }
}

async function openGiftPicker(npcId) {
  state.currentNpcId = npcId;
  state.multiSelectMode = false;
  state.selectedNpcIds = [];
  $('btnMultiConfirm').classList.add('hidden');
  await ensureCatalogsLoaded();
  const npc = state.npcs.find((n) => n.id === npcId);
  if (npc) {
    $('giftRecipientAvatar').src = npc.photo_url;
    $('giftRecipientName').textContent = npc.name;
  }
  renderGiftTab();
  renderGestureTab();
  $('giftPicker').classList.remove('hidden');
}

function renderGiftTab() {
  const grid = $('giftGrid');
  grid.innerHTML = '';
  state.giftCatalog.forEach((g) => {
    const div = document.createElement('div');
    div.className = 'gift-item';
    div.innerHTML = `${g.emoji}<span class="cost">${g.cost}❤️</span>`;
    div.onclick = () => sendGift(g.key);
    grid.appendChild(div);
  });
}

function renderGestureTab() {
  const grid = $('gestureGrid');
  grid.innerHTML = '';
  state.gestureCatalog.forEach((g) => {
    const div = document.createElement('div');
    div.className = 'gift-item' + (g.locked ? ' locked' : '');
    div.innerHTML = `${g.emoji}${g.locked ? '<span class="lock-icon">🔒</span>' : ''}`;
    div.onclick = () => sendGesture(g);
    grid.appendChild(div);
  });
}

document.querySelectorAll('.gift-tab').forEach((btn) => {
  btn.onclick = () => {
    document.querySelectorAll('.gift-tab').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    state.activeGiftTab = btn.dataset.tab;
    $('giftGrid').classList.toggle('hidden', state.activeGiftTab !== 'gift');
    $('gestureGrid').classList.toggle('hidden', state.activeGiftTab !== 'gesture');
  };
});

// ---------- ÇOXLU ALICI SEÇİMİ ("+" düyməsi) ----------

$('btnAddRecipient').onclick = () => {
  state.multiSelectMode = !state.multiSelectMode;
  state.selectedNpcIds = state.currentNpcId ? [state.currentNpcId] : [];
  $('btnMultiConfirm').classList.toggle('hidden', !state.multiSelectMode);
  document.querySelectorAll('.npc-seat').forEach((seat) => {
    const npcId = Number(seat.dataset.npcId);
    seat.classList.toggle('selectable', state.multiSelectMode && !!npcId);
    seat.classList.toggle('selected', state.selectedNpcIds.includes(npcId));
    let badge = seat.querySelector('.select-badge');
    if (state.multiSelectMode && npcId) {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'select-badge';
        seat.querySelector('.avatar-wrap').appendChild(badge);
      }
      badge.textContent = state.selectedNpcIds.includes(npcId) ? '✓' : '+';
      seat.onclick = () => toggleSeatSelection(npcId);
    } else if (badge) {
      badge.remove();
      seat.onclick = null;
    }
  });
};

function toggleSeatSelection(npcId) {
  const idx = state.selectedNpcIds.indexOf(npcId);
  if (idx >= 0) state.selectedNpcIds.splice(idx, 1);
  else state.selectedNpcIds.push(npcId);
  const seat = document.querySelector(`.npc-seat[data-npc-id="${npcId}"]`);
  if (seat) {
    seat.classList.toggle('selected', state.selectedNpcIds.includes(npcId));
    const badge = seat.querySelector('.select-badge');
    if (badge) badge.textContent = state.selectedNpcIds.includes(npcId) ? '✓' : '+';
  }
}

$('btnMultiConfirm').onclick = () => {
  if (!state.selectedNpcIds.length) { alert('Ən azı bir alıcı seç'); return; }
  $('giftPicker').scrollIntoView?.();
};

function currentRecipients() {
  return state.multiSelectMode && state.selectedNpcIds.length
    ? state.selectedNpcIds
    : [state.currentNpcId];
}

async function sendGift(giftKey) {
  try {
    const npcIds = currentRecipients();
    const { replies } = await api('/api/game/gift', {
      method: 'POST',
      body: { userId: state.user.id, npcIds, giftKey },
    });
    $('giftPicker').classList.add('hidden');
    exitMultiSelect();
    hideTutorialHint();
    refreshHearts();
    replies.forEach((r) => addMsg(r.npcName, r.reply, 'npc'));
    if (isFirstPlay) { showTutorialStep(4); showTutorialHint('Ona bir şeyler yaz', '50%', '68%'); }
  } catch (e) {
    alert(e.message);
  }
}

function sendGesture(g) {
  if (g.locked) { alert('Bu jest VIP istifadəçilər üçündür 🔒'); return; }
  currentRecipients().forEach((npcId) => {
    const npc = state.npcs.find((n) => n.id === npcId);
    if (npc) addMsg('Sən', g.emoji, 'user');
  });
  $('giftPicker').classList.add('hidden');
  exitMultiSelect();
}

function exitMultiSelect() {
  state.multiSelectMode = false;
  state.selectedNpcIds = [];
  $('btnMultiConfirm').classList.add('hidden');
  document.querySelectorAll('.npc-seat').forEach((seat) => {
    seat.classList.remove('selectable', 'selected');
    const badge = seat.querySelector('.select-badge');
    if (badge) badge.remove();
    seat.onclick = null;
  });
}

async function refreshHearts() {
  const { user } = await api('/api/auth', {
    method: 'POST',
    body: { tgUser: tg?.initDataUnsafe?.user || { id: state.user.telegram_id } },
  });
  state.user = user;
  $('heartsCount').textContent = user.hearts;
}

// ---------- MASA SÖHBƏTİ (həmişə görünən) ----------

function addMsg(sender, text, who, translatable) {
  const box = $('chatMessages');
  const div = document.createElement('div');
  div.className = `chat-msg ${who}`;
  div.innerHTML = `<span class="sender">${sender}:</span> <span class="msg-text">${text}</span>` +
    (translatable ? `<span class="translate-link">Tercümeyi göster</span>` : '');
  const link = div.querySelector('.translate-link');
  if (link) link.onclick = () => { link.outerHTML = `<span class="msg-text" style="color:#999;"> (${text})</span>`; };
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}

$('btnSend').onclick = sendChatMessage;
$('chatInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChatMessage(); });

async function sendChatMessage() {
  const text = $('chatInput').value.trim();
  const npcId = state.currentNpcId || (state.npcs[0] && state.npcs[0].id);
  if (!text || !npcId) return;
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
        await joinTable();
      };
    }, 1500);
  }
  await api('/api/game/message', { method: 'POST', body: { userId: state.user.id, npcId, text } });
}

// Fon (ambient) masa söhbəti — orijinaldakı kimi arxa fonda daim davam edən yazışma hissi
let ambientTimer = null;
function startAmbientChat() {
  clearInterval(ambientTimer);
  ambientTimer = setInterval(async () => {
    if (!state.npcs.length) return;
    try {
      const data = await api(`/api/game/ambient/${state.user.id}`);
      if (data.text) addMsg(data.npcName, data.text, 'npc', Math.random() < 0.4);
    } catch (e) { /* səssiz keç */ }
  }, 6000 + Math.random() * 3000);
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
// QEYD: orijinal botda 333 nailiyyətin hər birinin özünəməxsus əl çəkilmiş
// medal ikonu var. Bunu dəqiq təkrarlamaq mümkün olmadığı üçün burada emoji
// əsaslı yaxınlaşma istifadə olunur (say və struktur eynidir: 333, tab-lar və s.)

let achvRows = [];
let achvFilter = 'completed';

$('btnMenu').onclick = async () => {
  $('achvModal').classList.remove('hidden');
  const { rows } = await api(`/api/achievements/${state.user.id}`);
  achvRows = rows;
  renderAchievements();
};

document.querySelectorAll('.achv-filter-btn').forEach((btn) => {
  btn.onclick = () => {
    document.querySelectorAll('.achv-filter-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    achvFilter = btn.dataset.filter;
    renderAchievements();
  };
});

function renderAchievements() {
  const grid = $('achvGrid');
  grid.innerHTML = '';
  let done = 0;
  achvRows.forEach((a) => { if (a.completed) done++; });
  const filtered = achvRows.filter((a) => (achvFilter === 'completed' ? a.completed : !a.completed));
  filtered.forEach((a) => {
    const div = document.createElement('div');
    div.className = 'achv-item' + (a.completed ? ' done' : '');
    div.title = `${a.name} — ${a.description} (${a.progress}/${a.goal})`;
    div.innerHTML = `<span class="stars">${'⭐'.repeat(Math.min(a.stars, 5))}</span>
      <span class="achv-icon">${a.icon_url || '❔'}</span>`;
    grid.appendChild(div);
  });
  $('achvCount').textContent = `${done}/${achvRows.length}`;
}

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
  $('choiceOverlay').classList.add('hidden');
  $('kissBackOverlay').classList.add('hidden');
  $('chatMessages').innerHTML = '';
  await joinTable();
};

// ---------- MASAYI DƏYİŞTİR ----------

$('btnTableSwitch').onclick = () => { $('tableSwitchModal').classList.remove('hidden'); loadRecentTables(); };

async function loadRecentTables() {
  const { rows } = await api(`/api/game/table/history/${state.user.id}`);
  const list = $('recentTablesList');
  list.innerHTML = '';
  if (!rows.length) {
    list.innerHTML = '<div style="color:#999;font-size:13px;">Hələ ziyarət olunmuş masa yoxdur</div>';
    return;
  }
  rows.forEach((r) => {
    const div = document.createElement('div');
    div.className = 'recent-table-row';
    div.innerHTML = `<img src="img/npc/bottle_icon.svg" onerror="this.style.display='none'"/>
      <span class="rt-number">#${r.table_number}</span>
      <span class="rt-counts">👦${r.male_count} 👧${r.female_count}</span>`;
    div.onclick = async () => {
      $('tableSwitchModal').classList.add('hidden');
      $('choiceOverlay').classList.add('hidden');
      $('kissBackOverlay').classList.add('hidden');
      await joinTable();
    };
    list.appendChild(div);
  });
}

$('btnRandomTable').onclick = async () => {
  $('tableSwitchModal').classList.add('hidden');
  document.querySelectorAll('.npc-seat').forEach((s) => { s.classList.remove('dim'); s.classList.remove('highlight'); });
  $('bottle').style.transform = 'rotate(0deg)';
  const { session, npcs, user } = await api('/api/game/table/switch', { method: 'POST', body: { userId: state.user.id } });
  state.session = session;
  state.npcs = npcs;
  state.user = user;
  state.currentNpcId = npcs[0] ? npcs[0].id : null;
  $('tableNumber').textContent = user.table_number;
  $('heartsCount').textContent = user.hearts;
  $('chatMessages').innerHTML = '';
  renderRing();
  startAmbientChat();
  $('centerText').textContent = 'Sonraki sırayı\nbekliyoruz';
  setTimeout(() => { $('centerText').textContent = 'Sıra sende!\nŞişeye tıkla!'; }, 1500);
};

// ---------- BOOSTER'LAR ----------

async function openBoosterModal() {
  $('boosterModal').classList.remove('hidden');
  const data = await api(`/api/boosters/${state.user.id}`);
  $('boosterFlame').textContent = data.flame ?? 0;
  $('boosterClap').textContent = data.clap ?? 0;
  $('boosterX2').textContent = data.x2 ?? 0;
  $('boosterKissup').textContent = data.kissup ?? 0;
  $('boosterPlus5').textContent = data.plus5 ?? 0;
}

// ---------- ŞİŞƏNİ DƏYİŞ ----------

async function openBottleShop() {
  $('bottleShopSheet').classList.remove('hidden');
  const { rows } = await api('/api/shop/bottles');
  const grid = $('bottleShopGrid');
  grid.innerHTML = '';
  rows.forEach((b) => {
    const div = document.createElement('div');
    div.className = 'bottle-shop-item' + (state.user.bottle_skin === b.key ? ' selected' : '');
    div.innerHTML = `${b.emoji}<span class="cost">${b.cost ? '❤️' + b.cost : 'Pulsuz'}</span>`;
    div.onclick = async () => {
      try {
        const { user } = await api('/api/shop/bottle/buy', { method: 'POST', body: { userId: state.user.id, skinKey: b.key } });
        state.user = user;
        $('heartsCount').textContent = user.hearts;
        $('bottle').textContent = b.emoji;
        openBottleShop();
      } catch (e) { alert(e.message); }
    };
    grid.appendChild(div);
  });
}

// ---------- STİL (ÇƏRÇİVƏ) MAĞAZASI ----------

let chosenFrameKey = null;
async function openFrameShop() {
  $('frameShopModal').classList.remove('hidden');
  $('framePreviewAvatar').src = state.user.photo_url || 'img/npc/default.svg';
  chosenFrameKey = state.user.frame_id || 'none';
  const { rows } = await api('/api/shop/frames');
  const grid = $('frameGrid');
  grid.innerHTML = '';
  rows.forEach((f) => {
    const div = document.createElement('div');
    div.className = 'frame-item';
    if (f.key === 'none') {
      div.textContent = '✕';
    } else {
      div.style.background = `linear-gradient(135deg, ${f.colors[0]}, ${f.colors[1]})`;
    }
    if (f.cost > 0) {
      const costEl = document.createElement('span');
      costEl.className = 'frame-cost';
      costEl.textContent = '❤️' + f.cost;
      div.appendChild(costEl);
    }
    if (f.key === chosenFrameKey) div.style.outline = '3px solid #6fb53a';
    div.onclick = () => {
      chosenFrameKey = f.key;
      document.querySelectorAll('.frame-item').forEach((el) => { el.style.outline = 'none'; });
      div.style.outline = '3px solid #6fb53a';
    };
    grid.appendChild(div);
  });
}
$('btnApplyFrame').onclick = async () => {
  try {
    const { user } = await api('/api/shop/frame/buy', { method: 'POST', body: { userId: state.user.id, frameKey: chosenFrameKey } });
    state.user = user;
    $('heartsCount').textContent = user.hearts;
    $('frameShopModal').classList.add('hidden');
  } catch (e) { alert(e.message); }
};

// ---------- KALP AL (Telegram Stars) ----------

$('btnHeartShop').onclick = openHeartShop;
async function openHeartShop() {
  $('heartShopModal').classList.remove('hidden');
  const { rows } = await api('/api/hearts/packages');
  const grid = $('heartShopGrid');
  grid.innerHTML = '';

  // Xüsusi kartlar (VIP / dost dəvəti / iltifatlar) — sadələşdirilmiş, demo işləkdir
  const special = [
    { title: 'VIP\nDURUM', icon: '👑', action: () => alert('VIP status hələ tam işlənməyib — tezliklə!') },
    { title: 'Bir arkadaş için\n❤️20 alın', icon: '➕', action: () => grantBonus(20) },
    { title: 'İltifatlar için\n❤️10 alın', icon: '✉️', action: () => grantBonus(10) },
  ];
  special.forEach((s) => {
    const div = document.createElement('div');
    div.className = 'heart-shop-item';
    div.innerHTML = `<div class="hs-title">${s.icon}</div>
      <div class="hs-title" style="white-space:pre-line;">${s.title}</div>
      <button class="hs-buy">Ayrıntılar</button>`;
    div.querySelector('.hs-buy').onclick = s.action;
    grid.appendChild(div);
  });

  rows.forEach((p) => {
    const div = document.createElement('div');
    div.className = 'heart-shop-item';
    const bonus = p.hearts > p.stars ? `+${Math.round((p.hearts / p.stars - 1) * 100)}% BONUS` : '';
    div.innerHTML = `${bonus ? `<div class="hs-badge">${bonus}</div>` : ''}
      <div class="hs-title">Ürəklər</div>
      <div class="hs-amount">❤️${p.hearts}</div>
      <button class="hs-buy">⭐ ${p.stars}</button>`;
    div.querySelector('.hs-buy').onclick = () => buyHeartPackage(p.key);
    grid.appendChild(div);
  });
}

async function grantBonus(amount) {
  try {
    const { user } = await api('/api/hearts/bonus', { method: 'POST', body: { userId: state.user.id, amount } });
    state.user = user;
    $('heartsCount').textContent = user.hearts;
    openHeartShop();
  } catch (e) { alert(e.message); }
}

async function buyHeartPackage(packageKey) {
  try {
    const { link } = await api('/api/hearts/invoice', { method: 'POST', body: { userId: state.user.id, packageKey } });
    if (tg && tg.openInvoice) {
      tg.openInvoice(link, async (status) => {
        if (status === 'paid') { await refreshHearts(); }
      });
    } else {
      window.open(link, '_blank');
    }
  } catch (e) { alert(e.message); }
}

init();
