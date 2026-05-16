import { showOverlay, hideOverlay } from "./overlay.js";

export function initSocial(ctx) {
  const { api, showToast, escapeHtml, els, user } = ctx;

  let chatPoll = null;
  let callPoll = null;
  let incomingPoll = null;
  let activeChat = null;
  let activeCall = null;
  const matchCache = new Map();
  let pc = null;
  let localStream = null;
  let signalCursor = 0;

  function starsHtml(avg, count) {
    const filled = Math.round(avg || 0);
    const stars = "★".repeat(filled) + "☆".repeat(5 - filled);
    return `<span class="stars" title="${avg} (${count})">${stars}</span> <small>${avg || "—"} (${count || 0})</small>`;
  }

  function openChat(match) {
    activeChat = match;
    els.chatTitle.textContent = match.peer.name;
    els.chatPeerPhoto.src = match.peer.photo;
    showOverlay(els.chatOverlay);
    loadMessages();
    if (chatPoll) clearInterval(chatPoll);
    chatPoll = setInterval(loadMessages, 2500);
  }

  function closeChat() {
    activeChat = null;
    hideOverlay(els.chatOverlay);
    if (chatPoll) clearInterval(chatPoll);
    chatPoll = null;
  }

  async function loadMessages() {
    if (!activeChat) return;
    const after = els.chatMessages.dataset.last || "";
    const path = after
      ? `/api/matches/${activeChat.matchId}/messages?after=${after}`
      : `/api/matches/${activeChat.matchId}/messages`;
    const msgs = await api(path);
    if (!msgs.length && after) return;
    if (!after) {
      els.chatMessages.innerHTML = "";
      els.chatMessages.dataset.last = "";
    }
    for (const m of msgs) {
      const div = document.createElement("div");
      div.className = `msg ${m.mine ? "mine" : "theirs"}`;
      div.textContent = m.body;
      els.chatMessages.appendChild(div);
      els.chatMessages.dataset.last = m.id;
    }
    els.chatMessages.scrollTop = els.chatMessages.scrollHeight;
  }

  async function sendMessage(e) {
    e.preventDefault();
    const text = els.chatInput.value.trim();
    if (!text || !activeChat) return;
    await api(`/api/matches/${activeChat.matchId}/messages`, {
      method: "POST",
      body: JSON.stringify({ text }),
    });
    els.chatInput.value = "";
    await loadMessages();
  }

  async function loadUsers() {
    try {
    const sort = els.usersSort?.value || "rating";
    const people = await api(`/api/users?sort=${sort}`);
    els.usersList.innerHTML = "";
    els.usersEmpty.classList.toggle("hidden", people.length > 0);
    for (const p of people) {
      const li = document.createElement("li");
      li.className = "user-item";
      li.innerHTML = `
        <img src="${p.photo}" alt="" />
        <div class="user-item-info">
          <h3>${escapeHtml(p.name)}, ${p.age}</h3>
          <p>${escapeHtml(p.bio || "")}</p>
          ${starsHtml(p.ratingAvg, p.ratingCount)}
        </div>
        <button type="button" class="btn-rate-mini" data-id="${p.id}" data-type="${p.type}">★</button>
      `;
      els.usersList.appendChild(li);
    }
    } catch (err) {
      showToast(err.message);
    }
  }

  async function loadLeaderboard() {
    try {
    const board = await api("/api/ratings/leaderboard");
    els.leaderboardList.innerHTML = "";
    els.leaderboardEmpty.classList.toggle("hidden", board.length > 0);
    board.forEach((p, i) => {
      const li = document.createElement("li");
      li.className = "leader-item";
      li.innerHTML = `
        <span class="leader-rank">${i + 1}</span>
        <img src="${p.photo}" alt="" />
        <div class="leader-info">
          <h3>${escapeHtml(p.name)}</h3>
          ${starsHtml(p.ratingAvg, p.ratingCount)}
        </div>
      `;
      els.leaderboardList.appendChild(li);
    });
    } catch (err) {
      showToast(err.message);
    }
  }

  async function loadMatchesList() {
    const matches = await api("/api/matches");
    els.matchesList.innerHTML = "";
    els.matchesEmpty.classList.toggle("hidden", matches.length > 0);
    els.matchBadge.textContent = matches.length;
    els.matchBadge.classList.toggle("hidden", matches.length === 0);

    for (const m of matches) {
      matchCache.set(m.matchId, m);
      const li = document.createElement("li");
      li.className = "match-item";
      li.innerHTML = `
        <img src="${m.peer.photo}" alt="" />
        <div class="match-item-body">
          <h3>${escapeHtml(m.peer.name)}, ${m.peer.age}</h3>
          <p class="match-preview">${escapeHtml(m.lastMessage || "Написать сообщение…")}</p>
          ${starsHtml(m.peer.ratingAvg, m.peer.ratingCount)}
        </div>
        <div class="match-actions">
          <button type="button" class="btn-icon btn-chat" data-match-id="${m.matchId}" title="Чат">💬</button>
          <button type="button" class="btn-icon btn-call" data-match-id="${m.matchId}" title="Звонок">📞</button>
          <button type="button" class="btn-icon btn-rate" data-id="${m.peer.id}" data-type="${m.peer.type}" title="Оценить">★</button>
        </div>
      `;
      els.matchesList.appendChild(li);
    }
  }

  function openRateModal(targetId, targetType) {
    els.rateTargetId.value = targetId;
    els.rateTargetType.value = targetType;
    showOverlay(els.rateOverlay);
  }

  function closeRateModal() {
    hideOverlay(els.rateOverlay);
  }

  async function submitRating(e) {
    e.preventDefault();
    const score = Number(els.rateScore.value);
    await api("/api/ratings", {
      method: "POST",
      body: JSON.stringify({
        targetId: els.rateTargetId.value,
        targetType: els.rateTargetType.value,
        score,
      }),
    });
    showToast("Оценка сохранена");
    closeRateModal();
    if (ctx.activeTab === "users") loadUsers();
    if (ctx.activeTab === "leaderboard") loadLeaderboard();
    if (ctx.activeTab === "matches") loadMatchesList();
  }

  function showCallUI(peerName, statusText) {
    els.callPeerName.textContent = peerName;
    els.callStatus.textContent = statusText;
    showOverlay(els.callOverlay);
  }

  function hideCallUI() {
    hideOverlay(els.callOverlay);
    if (callPoll) clearInterval(callPoll);
    callPoll = null;
    if (pc) {
      pc.close();
      pc = null;
    }
    if (localStream) {
      localStream.getTracks().forEach((t) => t.stop());
      localStream = null;
    }
    activeCall = null;
    signalCursor = 0;
  }

  async function endCall() {
    if (activeCall?.callId) {
      await api(`/api/calls/${activeCall.callId}/end`, { method: "POST" });
    }
    hideCallUI();
  }

  async function pollSignals() {
    if (!activeCall?.callId) return;
    const signals = await api(`/api/calls/${activeCall.callId}/signals?after=${signalCursor}`);
    for (const s of signals) {
      signalCursor = s.id;
      if (s.fromUserId === user.id) continue;
      if (s.type === "answer" || s.payload?.sdp === "bot-simulated") {
        els.callStatus.textContent = "Разговор (демо)";
      }
    }
    const st = await api(`/api/calls/${activeCall.callId}`);
    if (st.status === "active") els.callStatus.textContent = "Разговор";
    if (st.status === "ended") hideCallUI();
  }

  async function startCall(matchId, peerName) {
    try {
      const { callId, status } = await api("/api/calls", {
        method: "POST",
        body: JSON.stringify({ matchId }),
      });
      activeCall = { callId, matchId, peerName };
      showCallUI(peerName, "Вызов…");

      try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        els.callStatus.textContent = "Микрофон подключён";
      } catch {
        els.callStatus.textContent = "Без микрофона (демо)";
      }

      if (status === "ringing") {
        await api(`/api/calls/${callId}/signal`, {
          method: "POST",
          body: JSON.stringify({ type: "offer", payload: { demo: true } }),
        });
      }

      callPoll = setInterval(pollSignals, 1500);
      setTimeout(async () => {
        if (!activeCall) return;
        const st = await api(`/api/calls/${callId}`);
        if (st.status === "ringing") {
          await api(`/api/calls/${callId}/accept`, { method: "POST" });
          els.callStatus.textContent = "Соединено (демо)";
        }
      }, 2000);
    } catch (err) {
      showToast(err.message);
      hideCallUI();
    }
  }

  async function pollIncoming() {
    if (activeCall) return;
    const incoming = await api("/api/calls/incoming").catch(() => null);
    if (!incoming) {
      hideOverlay(els.incomingCall);
      return;
    }
    showOverlay(els.incomingCall);
    els.incomingText.textContent = `Входящий звонок — ${incoming.match?.peer?.name || "пользователь"}`;
    els.incomingCall.dataset.callId = incoming.callId;
  }

  els.chatClose.addEventListener("click", closeChat);
  els.chatForm.addEventListener("submit", sendMessage);
  els.callEnd.addEventListener("click", endCall);
  els.rateForm.addEventListener("submit", submitRating);
  els.rateClose.addEventListener("click", closeRateModal);
  els.usersSort.addEventListener("change", loadUsers);

  els.incomingAccept.addEventListener("click", async () => {
    const callId = els.incomingCall.dataset.callId;
    await api(`/api/calls/${callId}/accept`, { method: "POST" });
    hideOverlay(els.incomingCall);
    activeCall = { callId };
    showCallUI("Собеседник", "Разговор");
    callPoll = setInterval(pollSignals, 1500);
  });

  els.incomingDecline.addEventListener("click", async () => {
    const callId = els.incomingCall.dataset.callId;
    await api(`/api/calls/${callId}/end`, { method: "POST" });
    hideOverlay(els.incomingCall);
  });

  hideOverlay(els.chatOverlay);
  hideOverlay(els.callOverlay);
  hideOverlay(els.incomingCall);
  hideOverlay(els.rateOverlay);

  document.addEventListener("click", (e) => {
    const chatBtn = e.target.closest(".btn-chat");
    if (chatBtn) {
      const m = matchCache.get(chatBtn.dataset.matchId);
      if (m) openChat(m);
      return;
    }
    const callBtn = e.target.closest(".btn-call");
    if (callBtn) {
      const matchId = callBtn.dataset.matchId;
      const item = callBtn.closest(".match-item");
      const name = item?.querySelector("h3")?.textContent || "Собеседник";
      startCall(matchId, name);
      return;
    }
    const rateBtn = e.target.closest(".btn-rate, .btn-rate-mini");
    if (rateBtn) {
      openRateModal(rateBtn.dataset.id, rateBtn.dataset.type);
    }
  });

  incomingPoll = setInterval(pollIncoming, 3000);

  return {
    loadUsers,
    loadLeaderboard,
    loadMatchesList,
    stop() {
      if (incomingPoll) clearInterval(incomingPoll);
      if (chatPoll) clearInterval(chatPoll);
      if (callPoll) clearInterval(callPoll);
      hideCallUI();
      closeChat();
    },
  };
}
