import { initSocial } from "./social.js?v=10";

const APP_VERSION = "10";
const STORAGE_KEY = "tinderu_user";

function showOverlay(el) {
  if (!el) return;
  el.classList.remove("hidden");
  el.hidden = false;
  el.style.removeProperty("display");
}

function hideOverlay(el) {
  if (!el) return;
  el.classList.add("hidden");
  el.hidden = true;
  el.style.display = "none";
}

const prevVersion = localStorage.getItem("tinderu_app_version");
if (prevVersion && prevVersion !== APP_VERSION) {
  localStorage.setItem("tinderu_app_version", APP_VERSION);
  location.reload();
} else {
  localStorage.setItem("tinderu_app_version", APP_VERSION);
}

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const els = {
  onboarding: $("#onboarding"),
  discover: $("#discover"),
  matches: $("#matches"),
  profile: $("#profile"),
  loginForm: $("#login-form"),
  registerForm: $("#register-form"),
  authTitle: $("#auth-title"),
  photoInput: $("#photo-input"),
  photoPreview: $("#photo-preview"),
  photoLabel: $("#photo-label"),
  dobInput: $("#dob-input"),
  cardStack: $("#card-stack"),
  emptyState: $("#empty-state"),
  btnNope: $("#btn-nope"),
  btnLike: $("#btn-like"),
  matchesList: $("#matches-list"),
  matchesEmpty: $("#matches-empty"),
  matchBadge: $("#match-badge"),
  toast: $("#toast"),
  btnLogout: $("#btn-logout"),
  mainNav: $("#main-nav"),
  userChip: $("#user-chip"),
  userAvatar: $("#user-avatar"),
  userName: $("#user-name"),
  profileView: $("#profile-view"),
  profileEditForm: $("#profile-edit-form"),
  profilePhotoView: $("#profile-photo-view"),
  profileNameView: $("#profile-name-view"),
  profileMetaView: $("#profile-meta-view"),
  profileBioView: $("#profile-bio-view"),
  profilePhotoEdit: $("#profile-photo-edit"),
  profilePhotoInput: $("#profile-photo-input"),
  profileNameInput: $("#profile-name-input"),
  profileGenderInput: $("#profile-gender-input"),
  profileDobInput: $("#profile-dob-input"),
  profileBioInput: $("#profile-bio-input"),
  btnEditProfile: $("#btn-edit-profile"),
  btnCancelEdit: $("#btn-cancel-edit"),
  users: $("#users"),
  leaderboard: $("#leaderboard"),
  usersList: $("#users-list"),
  usersEmpty: $("#users-empty"),
  usersSort: $("#users-sort"),
  leaderboardList: $("#leaderboard-list"),
  leaderboardEmpty: $("#leaderboard-empty"),
  chatOverlay: $("#chat-overlay"),
  chatTitle: $("#chat-title"),
  chatPeerPhoto: $("#chat-peer-photo"),
  chatMessages: $("#chat-messages"),
  chatForm: $("#chat-form"),
  chatInput: $("#chat-input"),
  chatClose: $("#chat-close"),
  callOverlay: $("#call-overlay"),
  callPeerName: $("#call-peer-name"),
  callStatus: $("#call-status"),
  callEnd: $("#call-end"),
  incomingCall: $("#incoming-call"),
  incomingText: $("#incoming-text"),
  incomingAccept: $("#incoming-accept"),
  incomingDecline: $("#incoming-decline"),
  rateOverlay: $("#rate-overlay"),
  rateForm: $("#rate-form"),
  rateTargetId: $("#rate-target-id"),
  rateTargetType: $("#rate-target-type"),
  rateScore: $("#rate-score"),
  rateClose: $("#rate-close"),
};

let user = null;
let socialApi = null;
let cards = [];
let swiping = false;
let authMode = "login";
let activeTab = "discover";

const maxDob = (() => {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 18);
  return d.toISOString().slice(0, 10);
})();
els.dobInput.max = maxDob;
els.profileDobInput.max = maxDob;

function loadUser() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveUser(u) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(u));
}

function clearUser() {
  localStorage.removeItem(STORAGE_KEY);
  user = null;
  cards = [];
}

function updateUserChip() {
  if (!user) {
    els.userChip.classList.add("hidden");
    return;
  }
  els.userChip.classList.remove("hidden");
  els.userAvatar.src = user.photo;
  els.userName.textContent = user.name;
}

function resetAuthForms() {
  els.loginForm.reset();
  els.registerForm.reset();
  els.photoPreview.classList.add("hidden");
  els.photoPreview.removeAttribute("src");
  els.photoLabel.textContent = "Фото (необязательно)";
  setAuthMode("login");
}

function setAuthMode(mode) {
  authMode = mode;
  const isLogin = mode === "login";
  els.authTitle.textContent = isLogin ? "Вход" : "Регистрация";
  els.loginForm.classList.toggle("hidden", !isLogin);
  els.registerForm.classList.toggle("hidden", isLogin);
  $$(".auth-tab").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.authMode === mode);
  });
}

function hideAllScreens() {
  els.onboarding.classList.add("hidden");
  els.discover.classList.add("hidden");
  els.matches.classList.add("hidden");
  els.users.classList.add("hidden");
  els.leaderboard.classList.add("hidden");
  els.profile.classList.add("hidden");
}

function hideOverlays() {
  hideOverlay(els.chatOverlay);
  hideOverlay(els.callOverlay);
  hideOverlay(els.incomingCall);
  hideOverlay(els.rateOverlay);
}

function showLoggedOut() {
  hideAllScreens();
  hideOverlays();
  socialApi?.stop();
  els.onboarding.classList.remove("hidden");
  els.btnLogout.classList.add("hidden");
  els.mainNav.classList.add("hidden");
  els.userChip.classList.add("hidden");
  els.cardStack.innerHTML = "";
  els.matchesList.innerHTML = "";
  els.emptyState.classList.add("hidden");
  els.matchBadge.classList.add("hidden");
  resetAuthForms();
}

function showLoggedIn() {
  hideOverlays();
  els.onboarding.classList.add("hidden");
  els.btnLogout.classList.remove("hidden");
  els.mainNav.classList.remove("hidden");
  updateUserChip();
  setTab(activeTab || "discover");
}

function logout() {
  socialApi?.stop();
  hideOverlays();
  clearUser();
  showLoggedOut();
  showToast("Вы вышли");
}

async function api(path, options = {}) {
  const headers = {
    ...(user ? { "X-User-Id": user.id } : {}),
    ...options.headers,
  };
  if (!(options.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }
  const res = await fetch(path, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Ошибка сети");
  return data;
}

function showToast(msg) {
  els.toast.textContent = msg;
  els.toast.classList.remove("hidden");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => els.toast.classList.add("hidden"), 2500);
}

function setTab(tab) {
  activeTab = tab;
  $$(".tab").forEach((btn) => {
    const active = btn.dataset.tab === tab;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-selected", active);
  });
  hideAllScreens();
  if (tab === "discover") els.discover.classList.remove("hidden");
  if (tab === "matches") {
    els.matches.classList.remove("hidden");
    socialApi?.loadMatchesList();
  }
  if (tab === "users") {
    els.users.classList.remove("hidden");
    socialApi?.loadUsers();
  }
  if (tab === "leaderboard") {
    els.leaderboard.classList.remove("hidden");
    socialApi?.loadLeaderboard();
  }
  if (tab === "profile") {
    els.profile.classList.remove("hidden");
    showProfileView();
  }
}

function fillProfileView() {
  if (!user) return;
  els.profilePhotoView.src = user.photo;
  els.profileNameView.textContent = `${user.name}, ${user.age}`;
  const rating = user.ratingCount
    ? ` · ★ ${user.ratingAvg} (${user.ratingCount})`
    : "";
  els.profileMetaView.textContent = `@${user.login} · ${user.genderLabel || ""}${rating}`;
  els.profileBioView.textContent = user.bio?.trim() || "Нет описания";
}

function fillProfileEditForm() {
  if (!user) return;
  els.profilePhotoEdit.src = user.photo;
  els.profileNameInput.value = user.name;
  els.profileGenderInput.value = user.gender;
  els.profileDobInput.value = user.dateOfBirth;
  els.profileBioInput.value = user.bio || "";
  els.profilePhotoInput.value = "";
}

function showProfileView() {
  fillProfileView();
  els.profileView.classList.remove("hidden");
  els.profileEditForm.classList.add("hidden");
}

function showProfileEdit() {
  fillProfileEditForm();
  els.profileView.classList.add("hidden");
  els.profileEditForm.classList.remove("hidden");
}

async function saveProfile(e) {
  e.preventDefault();
  const fd = new FormData(els.profileEditForm);
  try {
    const u = await api("/api/auth/me", { method: "PATCH", body: fd });
    user = u;
    saveUser(user);
    updateUserChip();
    showProfileView();
    showToast("Профиль сохранён");
    await loadCards();
  } catch (err) {
    showToast(err.message);
  }
}

async function onAuthSuccess(u) {
  user = u;
  saveUser(user);
  activeTab = "discover";
  showLoggedIn();
  await loadCards();
  socialApi?.loadMatchesList();
}

function createCardEl(card) {
  const el = document.createElement("article");
  el.className = "card";
  el.dataset.id = card.id;
  el.dataset.type = card.cardType || "profile";
  const badge =
    card.cardType === "user" ? `<span class="card-badge">Пользователь</span>` : "";
  el.innerHTML = `
    <img src="${card.photo}" alt="${escapeHtml(card.name)}" loading="lazy" draggable="false" />
    ${badge}
    <div class="card-stamp like">LIKE</div>
    <div class="card-stamp nope">NOPE</div>
    <div class="card-info">
      <h2>${escapeHtml(card.name)}, ${card.age}</h2>
      <p>${escapeHtml(card.bio)}</p>
    </div>
  `;
  attachSwipe(el, card);
  return el;
}

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function renderStack() {
  els.cardStack.innerHTML = "";
  const top = cards[cards.length - 1];
  if (!top) {
    els.emptyState.classList.remove("hidden");
    return;
  }
  els.emptyState.classList.add("hidden");
  els.cardStack.appendChild(createCardEl(top));
}

async function loadCards() {
  cards = await api("/api/cards");
  renderStack();
}

async function swipe(targetId, targetType, liked) {
  if (swiping) return;
  swiping = true;
  try {
    const { match } = await api("/api/swipe", {
      method: "POST",
      body: JSON.stringify({ targetId, targetType, liked }),
    });
    cards.pop();
    if (match) {
      showToast("Это матч! 🎉");
      await socialApi?.loadMatchesList();
    }
    renderStack();
  } finally {
    swiping = false;
  }
}

function attachSwipe(el, card) {
  let startX = 0;
  let currentX = 0;
  let dragging = false;

  const stampLike = el.querySelector(".card-stamp.like");
  const stampNope = el.querySelector(".card-stamp.nope");

  const onStart = (x) => {
    dragging = true;
    startX = x;
    currentX = 0;
    el.style.transition = "none";
  };

  const onMove = (x) => {
    if (!dragging) return;
    currentX = x - startX;
    const rot = currentX * 0.08;
    el.style.transform = `translateX(${currentX}px) rotate(${rot}deg)`;

    const opacity = Math.min(Math.abs(currentX) / 120, 1);
    if (currentX > 0) {
      stampLike.style.opacity = opacity;
      stampNope.style.opacity = 0;
    } else {
      stampNope.style.opacity = opacity;
      stampLike.style.opacity = 0;
    }
  };

  const onEnd = async () => {
    if (!dragging) return;
    dragging = false;
    el.style.transition = "transform 0.25s ease";

    if (currentX > 100) {
      el.style.transform = "translateX(120%) rotate(20deg)";
      await swipe(card.id, card.cardType || "profile", true);
    } else if (currentX < -100) {
      el.style.transform = "translateX(-120%) rotate(-20deg)";
      await swipe(card.id, card.cardType || "profile", false);
    } else {
      el.style.transform = "";
      stampLike.style.opacity = 0;
      stampNope.style.opacity = 0;
    }
  };

  el.addEventListener("pointerdown", (e) => {
    el.setPointerCapture(e.pointerId);
    onStart(e.clientX);
  });
  el.addEventListener("pointermove", (e) => onMove(e.clientX));
  el.addEventListener("pointerup", onEnd);
  el.addEventListener("pointercancel", onEnd);
}

els.photoInput.addEventListener("change", () => {
  const file = els.photoInput.files?.[0];
  if (!file) return;
  els.photoPreview.src = URL.createObjectURL(file);
  els.photoPreview.classList.remove("hidden");
  els.photoLabel.textContent = "Изменить фото";
});

els.profilePhotoInput.addEventListener("change", () => {
  const file = els.profilePhotoInput.files?.[0];
  if (!file) return;
  els.profilePhotoEdit.src = URL.createObjectURL(file);
});

els.loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(els.loginForm);
  try {
    const u = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        login: fd.get("login"),
        password: fd.get("password"),
      }),
    });
    await onAuthSuccess(u);
  } catch (err) {
    showToast(err.message);
  }
});

els.registerForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!els.registerForm.gender.value) {
    showToast("Укажите пол");
    return;
  }
  try {
    const u = await api("/api/auth/register", {
      method: "POST",
      body: new FormData(els.registerForm),
    });
    await onAuthSuccess(u);
  } catch (err) {
    showToast(err.message);
  }
});

$$(".auth-tab").forEach((btn) => {
  btn.addEventListener("click", () => setAuthMode(btn.dataset.authMode));
});

$$(".tab").forEach((btn) => {
  btn.addEventListener("click", () => setTab(btn.dataset.tab));
});

els.userChip.addEventListener("click", () => setTab("profile"));

els.btnEditProfile.addEventListener("click", showProfileEdit);
els.btnCancelEdit.addEventListener("click", showProfileView);
els.profileEditForm.addEventListener("submit", saveProfile);

els.btnLogout.addEventListener("click", logout);

els.btnLike.addEventListener("click", () => {
  const card = els.cardStack.querySelector(".card");
  if (!card) return;
  card.style.transition = "transform 0.25s ease";
  card.style.transform = "translateX(120%) rotate(20deg)";
  swipe(card.dataset.id, card.dataset.type || "profile", true);
});

els.btnNope.addEventListener("click", () => {
  const card = els.cardStack.querySelector(".card");
  if (!card) return;
  card.style.transition = "transform 0.25s ease";
  card.style.transform = "translateX(-120%) rotate(-20deg)";
  swipe(card.dataset.id, card.dataset.type || "profile", false);
});

async function init() {
  user = loadUser();
  if (!user) {
    showLoggedOut();
    return;
  }

  try {
    user = await api("/api/auth/me");
    saveUser(user);
  } catch {
    clearUser();
    showLoggedOut();
    return;
  }

  socialApi = initSocial({
    api,
    showToast,
    escapeHtml,
    els,
    user,
    showOverlay,
    hideOverlay,
    get activeTab() {
      return activeTab;
    },
    setTab,
  });

  showLoggedIn();
  try {
    await loadCards();
    await socialApi.loadMatchesList();
    await socialApi.loadUsers();
    await socialApi.loadLeaderboard();
  } catch (err) {
    showToast(err.message);
  }
}

init();
