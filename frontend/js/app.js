/**
 * Main application logic.
 * WebSocket connection, call UI state, audio, avatar, performance metrics.
 */

import { AudioCapture, BargeInDetector } from "./audio-handler.js";
import { AudioPlayer } from "./audio/AudioPlayer.js";
import { AvatarRuntime } from "./avatar/AvatarRuntime.js";

// ── State ─────────────────────────────────────────────────────────────

let ws = null;
let capture = null;
let player = null;
let bargeIn = null;
let avatar = null;
let isInCall = false;
let aiSpeaking = false;
let callTimerInterval = null;
let callStartTime = null;
let perfEntryCount = 0;
let currentTtsSentences = [];
let userName = "";
let userLanguage = "en";
let micMuted = false;
let avatarEnabled = true;

// ── DOM Elements ──────────────────────────────────────────────────────

const nameModal = document.getElementById("name-modal");
const nameInput = document.getElementById("name-input");
const startCallBtn = document.getElementById("start-call-btn");
const callingOverlay = document.getElementById("calling-overlay");
const callingStatus = document.getElementById("calling-status");
const callView = document.getElementById("call-view");
const transcriptEl = document.getElementById("transcript");
const bookingSlots = document.getElementById("booking-slots");
const bookingEmpty = document.getElementById("booking-empty");
const endCallBtn = document.getElementById("end-call-btn");
const micBtn = document.getElementById("mic-btn");
const debugToggle = document.getElementById("debug-toggle");
const callTimer = document.getElementById("call-timer");
const perfToggle = document.getElementById("perf-toggle");
const perfBody = document.getElementById("perf-body");
const perfChevron = document.getElementById("perf-chevron");
const perfEntries = document.getElementById("perf-entries");
const videoTile = document.getElementById("video-tile");
const azureStatus = document.getElementById("azure-status");
const avatarCanvas = document.getElementById("avatar-canvas");
const avatarPhoto = document.getElementById("avatar-photo");
const alignmentBadge = document.getElementById("alignment-badge");
const alignmentValue = document.getElementById("alignment-value");

// Static fallback image (used only if the WebGL avatar can't initialise).
avatarPhoto.onerror = () => { avatarPhoto.onerror = null; avatarPhoto.src = "/avatars/azure/placeholder.svg"; };
avatarPhoto.src = "/avatars/azure/photo.jpg";

// ── UI Updates ────────────────────────────────────────────────────────

function setAzureState(state) {
  azureStatus.textContent = state;
  videoTile.classList.toggle("speaking", state === "Speaking...");
}

function addTranscript(role, text, opts = {}) {
  const bubble = document.createElement("div");
  bubble.className = `chat-bubble ${role === "user" ? "user" : "azure"}${opts.filler ? " filler" : ""}`;

  const nameEl = document.createElement("div");
  nameEl.className = "bubble-name";
  nameEl.textContent = role === "user" ? (userName || "You") : "Azure";

  const content = document.createElement("div");
  content.className = "bubble-text";
  content.textContent = text;

  bubble.appendChild(nameEl);
  bubble.appendChild(content);
  transcriptEl.appendChild(bubble);
  transcriptEl.scrollTop = transcriptEl.scrollHeight;
}

function updateBookingPanel(status) {
  const slotNames = {
    guest_name: "Name",
    contact: "Contact",
    check_in: "Check-in",
    check_out: "Check-out",
    room_type: "Room",
    num_guests: "Guests",
  };

  const filled = status.filled || {};
  let html = "";
  for (const [key, label] of Object.entries(slotNames)) {
    const value = filled[key];
    const isFilled = value !== undefined && value !== null;
    html += `
      <div class="slot ${isFilled ? "filled" : "empty"}">
        <span class="slot-label">${label}</span>
        <span class="slot-value">${isFilled ? value : "\u2014"}</span>
      </div>
    `;
  }
  bookingSlots.innerHTML = html;

  const anyFilled = Object.keys(filled).length > 0;
  bookingEmpty.classList.toggle("hidden", anyFilled);
}

function showAlignment(alignment) {
  if (!alignment) return;
  alignmentValue.textContent = alignment === "estimated-rule-based" ? "estimated" : alignment;
  alignmentBadge.classList.remove("hidden");
}

// ── Call Timer ─────────────────────────────────────────────────────────

function startCallTimer() {
  callStartTime = Date.now();
  callTimer.textContent = "00:00";
  callTimerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - callStartTime) / 1000);
    const m = String(Math.floor(elapsed / 60)).padStart(2, "0");
    const s = String(elapsed % 60).padStart(2, "0");
    callTimer.textContent = `${m}:${s}`;
  }, 1000);
}

function stopCallTimer() {
  if (callTimerInterval) {
    clearInterval(callTimerInterval);
    callTimerInterval = null;
  }
}

// ── Ringing Tone (Web Audio generated) ────────────────────────────────

function createRingTone(audioCtx) {
  const osc1 = audioCtx.createOscillator();
  const osc2 = audioCtx.createOscillator();
  const gain = audioCtx.createGain();

  osc1.frequency.value = 440;
  osc2.frequency.value = 480;
  osc1.connect(gain);
  osc2.connect(gain);
  gain.connect(audioCtx.destination);
  gain.gain.value = 0;

  const now = audioCtx.currentTime;
  gain.gain.setValueAtTime(0.08, now);
  gain.gain.setValueAtTime(0, now + 1.5);
  gain.gain.setValueAtTime(0.08, now + 2.5);
  gain.gain.setValueAtTime(0, now + 4);

  osc1.start(now);
  osc2.start(now);
  osc1.stop(now + 5);
  osc2.stop(now + 5);

  return { stop: () => { gain.gain.cancelScheduledValues(0); gain.gain.value = 0; } };
}

// ── Performance Panel ─────────────────────────────────────────────────

function addPerfEntry(timing) {
  perfEntryCount++;
  const empty = perfEntries.querySelector(".perf-empty");
  if (empty) empty.remove();

  const total = timing.total_pipeline_ms || 0;

  const bars = [];
  if (timing.stt_ms != null) bars.push({ label: "STT", cls: "stt", ms: timing.stt_ms });
  if (timing.rag_ms != null) bars.push({ label: "RAG", cls: "rag", ms: timing.rag_ms });
  if (timing.llm_first_token_ms != null) bars.push({ label: "LLM 1st", cls: "llm-first", ms: timing.llm_first_token_ms });
  if (timing.llm_total_ms != null) bars.push({ label: "LLM total", cls: "llm", ms: timing.llm_total_ms });

  let ttsTotal = 0;
  for (const s of currentTtsSentences) ttsTotal += s.tts_ms;
  if (ttsTotal > 0) bars.push({ label: "TTS total", cls: "tts", ms: ttsTotal });

  if (timing.slot_extraction_ms != null) bars.push({ label: "Slots", cls: "slots", ms: timing.slot_extraction_ms });

  const maxMs = Math.max(...bars.map(b => b.ms), 1);

  let barsHtml = bars.map(b => `
    <div class="perf-row">
      <span class="perf-label">${b.label}</span>
      <div class="perf-bar-track">
        <div class="perf-bar-fill ${b.cls}" style="width:${Math.max(2, (b.ms / maxMs) * 100)}%"></div>
      </div>
      <span class="perf-value">${formatMs(b.ms)}</span>
    </div>
  `).join("");

  let ttsDetail = "";
  if (currentTtsSentences.length > 0) {
    const lines = currentTtsSentences.map((s, i) => {
      const preview = s.text ? s.text.substring(0, 35) + (s.text.length > 35 ? "..." : "") : `Sentence ${i + 1}`;
      return `<div class="perf-tts-sentence"><span>${preview}</span><span>${formatMs(s.tts_ms)}</span></div>`;
    }).join("");
    ttsDetail = `<div class="perf-tts-detail">${lines}</div>`;
  }

  let extraInfo = "";
  const parts = [];
  if (timing.audio_duration_ms) parts.push(`Audio: ${formatMs(timing.audio_duration_ms)}`);
  if (timing.llm_tokens) parts.push(`Tokens: ${timing.llm_tokens}`);
  if (timing.sentence_count) parts.push(`Sentences: ${timing.sentence_count}`);
  if (parts.length) extraInfo = `<div style="font-size:11px;color:var(--text-muted);margin-top:6px">${parts.join(" &middot; ")}</div>`;

  const entry = document.createElement("div");
  entry.className = "perf-entry";
  entry.innerHTML = `
    <div class="perf-entry-header">
      <span>Response #${perfEntryCount}</span>
      <span class="perf-entry-total">${formatMs(total)} total</span>
    </div>
    <div class="perf-bars">${barsHtml}</div>
    ${ttsDetail}
    ${extraInfo}
  `;

  perfEntries.prepend(entry);
  currentTtsSentences = [];
}

function formatMs(ms) {
  if (ms >= 1000) return (ms / 1000).toFixed(1) + "s";
  return ms + "ms";
}

// ── WebSocket ─────────────────────────────────────────────────────────

function connectWS() {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  ws = new WebSocket(`${proto}//${location.host}/ws/voice`);
  ws.binaryType = "arraybuffer";

  ws.onopen = () => {
    ws.send(JSON.stringify({ type: "session.start", user_name: userName, language: userLanguage }));
  };

  ws.onmessage = (e) => {
    if (e.data instanceof ArrayBuffer) {
      player?.enqueue(e.data);
      return;
    }

    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }

    switch (msg.type) {
      case "session.ready":
        setAzureState("Connecting...");
        break;

      case "transcript":
        addTranscript("user", msg.text);
        setAzureState("Processing...");
        break;

      case "response.text":
        addTranscript("assistant", msg.text, { filler: msg.filler });
        if (msg.filler) {
          // Filler doesn't mean the *agent* started yet, keep "Processing..."
          break;
        }
        setAzureState("Speaking...");
        break;

      case "audio.begin":
        player?.beginSentence(msg.sentence_index, msg);
        break;

      case "audio.end":
        player?.endSentence(msg.sentence_index, msg);
        break;

      case "animation.timeline":
        if (avatar) avatar.attachTimeline(msg);
        showAlignment(msg.alignment);
        break;

      case "timing.tts":
        currentTtsSentences.push({
          tts_ms: msg.tts_ms,
          text: msg.text_length ? `(${msg.text_length} chars, ${(msg.tts_bytes / 1024).toFixed(0)}KB)` : "",
        });
        break;

      case "response.end":
        setAzureState("Listening");
        if (msg.timing) {
          const assistantBubbles = transcriptEl.querySelectorAll(".chat-bubble.azure:not(.filler) .bubble-text");
          const recentTexts = [];
          for (let i = Math.max(0, assistantBubbles.length - (msg.timing.sentence_count || 0)); i < assistantBubbles.length; i++) {
            recentTexts.push(assistantBubbles[i].textContent);
          }
          currentTtsSentences.forEach((s, i) => {
            if (recentTexts[i]) s.text = recentTexts[i];
          });
          addPerfEntry(msg.timing);
        }
        break;

      case "interrupted":
        player?.interrupt();
        setAzureState("Paused");
        break;

      case "booking.status":
        updateBookingPanel(msg);
        break;

      case "booking.saved":
        addTranscript("assistant", `Booking confirmed! ID: ${msg.booking_id}`);
        break;

      case "session.end":
        setTimeout(() => { endCall(); }, 2000);
        break;

      case "error":
        addTranscript("assistant", `Error: ${msg.message}`);
        setAzureState("Listening");
        break;
    }
  };

  ws.onclose = () => { if (isInCall) endCall(); };
  ws.onerror = () => { setAzureState("Error"); };
}

// ── Avatar ────────────────────────────────────────────────────────────

async function initAvatar() {
  try {
    avatar = new AvatarRuntime({
      canvas: avatarCanvas,
      avatarId: "azure",
      getClock: () => (player ? player.getPlayhead() : null),
      getAnalyzer: () => (player ? player.analyzer : null),
      debug: false,
    });
    const ok = await avatar.init();
    if (!ok) throw new Error("avatar init failed");
    // Swap photo -> canvas.
    avatarPhoto.classList.add("hidden");
    avatarCanvas.classList.remove("hidden");
    avatar.start();
  } catch (err) {
    console.warn("Avatar unavailable, using static photo:", err);
    avatar = null;
    avatarCanvas.classList.add("hidden");
    avatarPhoto.classList.remove("hidden");
  }
}

// ── Call Management ───────────────────────────────────────────────────

async function startCall() {
  try {
    isInCall = true;

    nameModal.classList.add("hidden");
    callingOverlay.classList.remove("hidden");
    callingStatus.textContent = "Calling...";

    const ringCtx = new AudioContext();
    const ring = createRingTone(ringCtx);

    player = new AudioPlayer({
      onStart: () => { aiSpeaking = true; setAzureState("Speaking..."); },
      onEnd: () => { aiSpeaking = false; setAzureState("Listening"); },
    });

    bargeIn = new BargeInDetector(-35);

    capture = new AudioCapture((frame) => {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      if (micMuted) return;

      // Barge-in only while the agent is speaking, and only on
      // gated+sustained speech (not raw energy / background noise).
      if (aiSpeaking && bargeIn.check(frame)) {
        player.stopAll();
        aiSpeaking = false;
        ws.send(JSON.stringify({ type: "interrupt" }));
      }

      ws.send(frame.pcm);
    });

    await capture.start();

    await new Promise(resolve => setTimeout(resolve, 3500));
    ring.stop();
    ringCtx.close();

    if (!isInCall) return;

    callingStatus.textContent = "Connected";
    await new Promise(resolve => setTimeout(resolve, 700));

    if (!isInCall) return;

    callingOverlay.classList.add("hidden");
    callView.classList.remove("hidden");
    startCallTimer();

    if (avatarEnabled) await initAvatar();

    connectWS();

  } catch (err) {
    console.error("Failed to start call:", err);
    callingOverlay.classList.add("hidden");
    nameModal.classList.remove("hidden");
  }
}

function endCall() {
  isInCall = false;

  if (avatar) { avatar.destroy(); avatar = null; }
  if (capture) { capture.stop(); capture = null; }
  if (player) { player.dispose(); player = null; }
  if (ws) { ws.close(); ws = null; }

  aiSpeaking = false;
  callingOverlay.classList.add("hidden");
  callView.classList.add("hidden");
  stopCallTimer();

  nameModal.classList.remove("hidden");
  alignmentBadge.classList.add("hidden");
  avatarCanvas.classList.add("hidden");
  avatarPhoto.classList.remove("hidden");

  transcriptEl.innerHTML = "";

  perfEntryCount = 0;
  perfEntries.innerHTML = '<div class="perf-empty">Timing data appears after first response</div>';
  perfBody.classList.add("hidden");
  perfChevron.classList.remove("open");

  micMuted = false;
  micBtn.classList.remove("active");
}

// ── Event Listeners ───────────────────────────────────────────────────

startCallBtn.addEventListener("click", () => {
  userName = nameInput.value.trim();
  if (!userName) {
    nameInput.focus();
    nameInput.style.borderColor = "var(--danger)";
    setTimeout(() => { nameInput.style.borderColor = ""; }, 1500);
    return;
  }
  startCall();
});

nameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") startCallBtn.click();
});

endCallBtn.addEventListener("click", () => endCall());

micBtn.addEventListener("click", () => {
  micMuted = !micMuted;
  micBtn.classList.toggle("active", micMuted);
  if (capture?.stream) {
    capture.stream.getAudioTracks().forEach(t => { t.enabled = !micMuted; });
  }
});

debugToggle.addEventListener("click", () => {
  debugToggle.classList.toggle("active");
  avatar?.setDebug(debugToggle.classList.contains("active"));
});

perfToggle.addEventListener("click", () => {
  perfBody.classList.toggle("hidden");
  perfChevron.classList.toggle("open");
});

const langBtns = document.querySelectorAll(".lang-btn");
langBtns.forEach(btn => {
  btn.addEventListener("click", () => {
    langBtns.forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    userLanguage = btn.dataset.lang;
  });
});

nameInput.focus();
