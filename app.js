// =====================================================
// Higum Forum – Gesamte Anwendungslogik (Firebase v9 Modular)
// Seiten: index.html (Themenliste) & topic.html (Themendetail)
// =====================================================
import { db, auth } from "./firebase-config.js";
import {
  ref,
  push,
  set,
  get,
  onValue,
  runTransaction,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// =====================================================
// Konfiguration
// =====================================================
// HINWEIS: Der EmailJS Public Key wurde in der Anfrage maskiert übermittelt.
// Bitte "DEIN_EMAILJS_PUBLIC_KEY" durch den echten Public Key ersetzen.
const EMAILJS_PUBLIC_KEY = "DEIN_EMAILJS_PUBLIC_KEY";
const EMAILJS_SERVICE_ID = "service_rs96mwp";
const EMAILJS_TEMPLATE_ID = "template_uvj39wr";

const DICEBEAR_BASE = "https://api.dicebear.com/10.x/notionists-neutral/svg?seed=";

const TOPICS_PER_PAGE = 10;
const OTP_VALIDITY_MS = 15 * 60 * 1000; // 15 Minuten

// Kategorien mit zugehörigen Schlagwörtern (Tags)
const CATEGORIES = {
  allgemein: { name: "Allgemein", color: "#38bdf8", tags: ["Diskussion", "Frage", "Ankündigung"] },
  technik: { name: "Technik", color: "#4ade80", tags: ["Hardware", "Software", "Netzwerk"] },
  strategie: { name: "Strategie & Taktik", color: "#facc15", tags: ["Planung", "Analyse", "Geschichte"] },
  offtopic: { name: "Off-Topic", color: "#f472b6", tags: ["Freizeit", "Medien", "Sonstiges"] },
};

// Militärische Ränge nach Punkten
const RANKS = [
  { min: 501, name: "Major" },
  { min: 251, name: "Hauptmann" },
  { min: 101, name: "Leutnant" },
  { min: 21, name: "Unteroffizier" },
  { min: 0, name: "Rekrut" },
];

// =====================================================
// Globaler Zustand
// =====================================================
let currentUser = null; // Firebase Auth Benutzer
let currentProfile = null; // Datensatz aus /users/{uid}
let usersCache = {}; // uid -> Profil (für Anzeige von Rängen/Avataren)

let allTopics = []; // Alle Themen (sortiert, neueste zuerst)
let activeCategory = "alle";
let activeTag = null;
let searchQuery = "";
let currentPage = 1;

let registerTurnstileToken = null;
let topicTurnstileToken = null;

let pendingRegistration = null; // { username, email, password, otp, expiresAt }

// =====================================================
// Turnstile-Callbacks (müssen global verfügbar sein)
// =====================================================
window.onRegisterTurnstile = function (token) {
  registerTurnstileToken = token;
};
window.onTopicTurnstile = function (token) {
  topicTurnstileToken = token;
};

// =====================================================
// Hilfsfunktionen
// =====================================================
function $(id) {
  return document.getElementById(id);
}

function escapeHTML(str) {
  if (typeof str !== "string") return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function avatarURL(seed) {
  return DICEBEAR_BASE + encodeURIComponent(seed || "anonym");
}

function formatDate(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  return d.toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getRank(points, isAdmin) {
  if (isAdmin === true) {
    return { name: "General (Admin)", isAdmin: true };
  }
  const p = Number(points) || 0;
  for (const r of RANKS) {
    if (p >= r.min) return { name: r.name, isAdmin: false };
  }
  return { name: "Rekrut", isAdmin: false };
}

function rankBadgeHTML(points, isAdmin) {
  const rank = getRank(points, isAdmin);
  if (rank.isAdmin) {
    return `<span class="rank-badge rank-admin"><i data-lucide="shield-check"></i>${escapeHTML(rank.name)}</span>`;
  }
  return `<span class="rank-badge"><i data-lucide="medal"></i>${escapeHTML(rank.name)}</span>`;
}

function refreshIcons() {
  if (window.lucide && typeof window.lucide.createIcons === "function") {
    window.lucide.createIcons();
  }
}

let toastTimer = null;
function showToast(message, isError = false) {
  const toast = $("toast");
  if (!toast) return;
  toast.textContent = message;
  toast.classList.toggle("toast-error", isError);
  toast.classList.remove("hidden");
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add("hidden"), 4000);
}

function showFormError(id, message) {
  const el = $(id);
  if (!el) return;
  el.textContent = message;
  el.classList.remove("hidden");
}

function hideFormError(id) {
  const el = $(id);
  if (!el) return;
  el.textContent = "";
  el.classList.add("hidden");
}

function openModal(id) {
  const m = $(id);
  if (m) m.classList.remove("hidden");
}

function closeModal(id) {
  const m = $(id);
  if (m) m.classList.add("hidden");
}

function authErrorMessage(error) {
  const code = error && error.code ? error.code : "";
  switch (code) {
    case "auth/email-already-in-use":
      return "Diese E-Mail-Adresse wird bereits verwendet.";
    case "auth/invalid-email":
      return "Die E-Mail-Adresse ist ungültig.";
    case "auth/weak-password":
      return "Das Passwort ist zu schwach (mindestens 6 Zeichen).";
    case "auth/user-not-found":
    case "auth/wrong-password":
    case "auth/invalid-credential":
      return "E-Mail-Adresse oder Passwort ist falsch.";
    case "auth/too-many-requests":
      return "Zu viele Versuche. Bitte warte einen Moment.";
    default:
      return "Ein Fehler ist aufgetreten. Bitte versuche es erneut.";
  }
}

// =====================================================
// Benutzerprofile laden / cachen
// =====================================================
function watchUsers() {
  onValue(ref(db, "users"), (snapshot) => {
    usersCache = snapshot.val() || {};
    if (currentUser && usersCache[currentUser.uid]) {
      currentProfile = usersCache[currentUser.uid];
      renderHeaderUser();
    }
    // Neu rendern, damit Ränge/Avatare aktuell sind
    if ($("topic-list")) renderTopics();
    if ($("comments-tree") && loadedTopicId) renderTopicPage();
  });
}

function profileOf(uid) {
  return usersCache[uid] || null;
}

// =====================================================
// Punktevergabe (Transaktion, atomar)
// =====================================================
function addPoints(uid, amount) {
  return runTransaction(ref(db, `users/${uid}/points`), (current) => {
    return (Number(current) || 0) + amount;
  });
}

// =====================================================
// Header / Auth-Zustand
// =====================================================
function renderHeaderUser() {
  const authButtons = $("auth-buttons");
  const userMenu = $("user-menu");
  if (!authButtons || !userMenu) return;

  if (currentUser && currentProfile) {
    authButtons.classList.add("hidden");
    userMenu.classList.remove("hidden");

    const avatar = $("user-avatar");
    const name = $("user-name");
    const rankEl = $("user-rank");
    if (avatar) avatar.src = avatarURL(currentProfile.avatarSeed || currentUser.uid);
    if (name) name.textContent = currentProfile.username || "Mitglied";
    if (rankEl) {
      const rank = getRank(currentProfile.points, currentProfile.isAdmin);
      rankEl.textContent = rank.name + " · " + (Number(currentProfile.points) || 0) + " Punkte";
    }
  } else {
    authButtons.classList.remove("hidden");
    userMenu.classList.add("hidden");
  }

  // Antwort-Formular auf der Themenseite umschalten
  const replyForm = $("reply-form");
  const loginHint = $("reply-login-hint");
  if (replyForm && loginHint) {
    if (currentUser) {
      replyForm.classList.remove("hidden");
      loginHint.classList.add("hidden");
    } else {
      replyForm.classList.add("hidden");
      loginHint.classList.remove("hidden");
    }
  }
}

function initAuthState() {
  onAuthStateChanged(auth, async (user) => {
    currentUser = user;
    if (user) {
      try {
        const snap = await get(ref(db, `users/${user.uid}`));
        currentProfile = snap.exists() ? snap.val() : null;
      } catch (error) {
        console.log("[v0] Fehler beim Laden des Profils:", error.message);
        currentProfile = null;
      }
    } else {
      currentProfile = null;
    }
    renderHeaderUser();
  });

  const logoutBtn = $("btn-logout");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      await signOut(auth);
      showToast("Du wurdest erfolgreich abgemeldet.");
    });
  }
}

// =====================================================
// Modale: Öffnen / Schließen / Tabs
// =====================================================
function initModals() {
  document.querySelectorAll("[data-close-modal]").forEach((btn) => {
    btn.addEventListener("click", () => closeModal(btn.getAttribute("data-close-modal")));
  });

  // Klick auf den Hintergrund schließt das Modal
  document.querySelectorAll(".modal-overlay").forEach((overlay) => {
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) overlay.classList.add("hidden");
    });
  });

  const tabLogin = $("tab-login");
  const tabRegister = $("tab-register");
  const loginForm = $("login-form");
  const registerForm = $("register-form");

  if (tabLogin && tabRegister && loginForm && registerForm) {
    tabLogin.addEventListener("click", () => {
      tabLogin.classList.add("active");
      tabRegister.classList.remove("active");
      tabLogin.setAttribute("aria-selected", "true");
      tabRegister.setAttribute("aria-selected", "false");
      loginForm.classList.remove("hidden");
      registerForm.classList.add("hidden");
    });
    tabRegister.addEventListener("click", () => {
      tabRegister.classList.add("active");
      tabLogin.classList.remove("active");
      tabRegister.setAttribute("aria-selected", "true");
      tabLogin.setAttribute("aria-selected", "false");
      registerForm.classList.remove("hidden");
      loginForm.classList.add("hidden");
    });
  }

  const openLogin = $("btn-open-login");
  const openRegister = $("btn-open-register");
  if (openLogin) {
    openLogin.addEventListener("click", () => {
      if (tabLogin) tabLogin.click();
      openModal("auth-modal");
    });
  }
  if (openRegister) {
    openRegister.addEventListener("click", () => {
      if (tabRegister) tabRegister.click();
      openModal("auth-modal");
    });
  }
}

// =====================================================
// Anmeldung (Login)
// =====================================================
function initLogin() {
  const form = $("login-form");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    hideFormError("login-error");

    const email = $("login-email").value.trim();
    const password = $("login-password").value;

    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;

    try {
      await signInWithEmailAndPassword(auth, email, password);
      closeModal("auth-modal");
      form.reset();
      showToast("Willkommen zurück!");
    } catch (error) {
      showFormError("login-error", authErrorMessage(error));
    } finally {
      submitBtn.disabled = false;
    }
  });
}

// =====================================================
// Registrierung mit OTP-E-Mail-Verifizierung
// =====================================================
function generateOTP() {
  // Kryptografisch sicherer 6-stelliger Code
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return String(100000 + (arr[0] % 900000));
}

async function sendOTPEmail(email, otp) {
  if (!window.emailjs) {
    throw new Error("EmailJS wurde nicht geladen.");
  }
  await window.emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, {
    passcode: otp,
    time: new Date(Date.now() + OTP_VALIDITY_MS).toLocaleTimeString("de-DE", {
      hour: "2-digit",
      minute: "2-digit",
    }),
    email: email,
    to_email: email,
  });
}

function initRegister() {
  const form = $("register-form");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    hideFormError("register-error");

    const username = $("register-username").value.trim();
    const email = $("register-email").value.trim();
    const password = $("register-password").value;

    if (username.length < 3) {
      showFormError("register-error", "Der Benutzername muss mindestens 3 Zeichen lang sein.");
      return;
    }
    if (!registerTurnstileToken) {
      showFormError("register-error", "Bitte bestätige zuerst die Sicherheitsprüfung (Turnstile).");
      return;
    }

    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;

    try {
      const otp = generateOTP();
      pendingRegistration = {
        username,
        email,
        password,
        otp,
        expiresAt: Date.now() + OTP_VALIDITY_MS,
      };

      await sendOTPEmail(email, otp);

      const emailDisplay = $("otp-email-display");
      if (emailDisplay) emailDisplay.textContent = email;

      closeModal("auth-modal");
      openModal("otp-modal");

      const firstDigit = document.querySelector(".otp-digit");
      if (firstDigit) firstDigit.focus();
    } catch (error) {
      console.log("[v0] Fehler beim Senden der OTP-E-Mail:", error);
      showFormError("register-error", "Die Bestätigungs-E-Mail konnte nicht gesendet werden. Bitte versuche es erneut.");
    } finally {
      submitBtn.disabled = false;
    }
  });
}

function initOTP() {
  const form = $("otp-form");
  if (!form) return;

  const digits = Array.from(document.querySelectorAll(".otp-digit"));

  // Automatischer Fokuswechsel zwischen den Eingabefeldern
  digits.forEach((input, idx) => {
    input.addEventListener("input", () => {
      input.value = input.value.replace(/\D/g, "").slice(0, 1);
      if (input.value && idx < digits.length - 1) {
        digits[idx + 1].focus();
      }
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Backspace" && !input.value && idx > 0) {
        digits[idx - 1].focus();
      }
    });
    input.addEventListener("paste", (e) => {
      e.preventDefault();
      const pasted = (e.clipboardData.getData("text") || "").replace(/\D/g, "").slice(0, 6);
      pasted.split("").forEach((ch, i) => {
        if (digits[i]) digits[i].value = ch;
      });
      if (pasted.length === 6) digits[5].focus();
    });
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    hideFormError("otp-error");

    if (!pendingRegistration) {
      showFormError("otp-error", "Keine ausstehende Registrierung gefunden. Bitte starte erneut.");
      return;
    }
    if (Date.now() > pendingRegistration.expiresAt) {
      showFormError("otp-error", "Der Code ist abgelaufen. Bitte fordere einen neuen Code an.");
      return;
    }

    const entered = digits.map((d) => d.value).join("");
    if (entered.length !== 6) {
      showFormError("otp-error", "Bitte gib alle 6 Ziffern ein.");
      return;
    }
    if (entered !== pendingRegistration.otp) {
      showFormError("otp-error", "Der eingegebene Code ist falsch.");
      return;
    }

    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;

    try {
      const cred = await createUserWithEmailAndPassword(
        auth,
        pendingRegistration.email,
        pendingRegistration.password
      );
      const uid = cred.user.uid;

      // Profil in der Realtime Database anlegen
      await set(ref(db, `users/${uid}`), {
        username: pendingRegistration.username,
        email: pendingRegistration.email,
        points: 0,
        isAdmin: false,
        avatarSeed: uid,
        createdAt: serverTimestamp(),
      });

      pendingRegistration = null;
      digits.forEach((d) => (d.value = ""));
      closeModal("otp-modal");
      showToast("Registrierung erfolgreich! Willkommen bei Higum, Rekrut!");

      const registerForm = $("register-form");
      if (registerForm) registerForm.reset();
      registerTurnstileToken = null;
      if (window.turnstile) window.turnstile.reset();
    } catch (error) {
      console.log("[v0] Fehler bei der Kontoerstellung:", error);
      showFormError("otp-error", authErrorMessage(error));
    } finally {
      submitBtn.disabled = false;
    }
  });

  const resendBtn = $("btn-resend-otp");
  if (resendBtn) {
    resendBtn.addEventListener("click", async () => {
      if (!pendingRegistration) {
        showFormError("otp-error", "Keine ausstehende Registrierung gefunden. Bitte starte erneut.");
        return;
      }
      resendBtn.disabled = true;
      try {
        const otp = generateOTP();
        pendingRegistration.otp = otp;
        pendingRegistration.expiresAt = Date.now() + OTP_VALIDITY_MS;
        await sendOTPEmail(pendingRegistration.email, otp);
        hideFormError("otp-error");
        showToast("Ein neuer Code wurde gesendet.");
      } catch (error) {
        console.log("[v0] Fehler beim erneuten Senden:", error);
        showFormError("otp-error", "Der Code konnte nicht erneut gesendet werden.");
      } finally {
        setTimeout(() => (resendBtn.disabled = false), 30000);
      }
    });
  }
}

// =====================================================
// STARTSEITE: Kategorien, Tags, Themenliste, Pagination
// =====================================================
function renderCategories() {
  const list = $("category-list");
  if (!list) return;

  let html = `
    <button class="category-item ${activeCategory === "alle" ? "active" : ""}" data-category="alle">
      <span class="category-dot" style="background-color: var(--accent);"></span>
      Alle Themen
    </button>
  `;
  for (const [key, cat] of Object.entries(CATEGORIES)) {
    html += `
      <button class="category-item ${activeCategory === key ? "active" : ""}" data-category="${key}">
        <span class="category-dot" style="background-color: ${cat.color};"></span>
        ${escapeHTML(cat.name)}
      </button>
    `;
  }
  list.innerHTML = html;

  list.querySelectorAll(".category-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      activeCategory = btn.getAttribute("data-category");
      activeTag = null;
      currentPage = 1;
      renderCategories();
      renderTags();
      renderTopics();
    });
  });
}

function renderTags() {
  const list = $("tag-list");
  if (!list) return;

  let tags = [];
  if (activeCategory !== "alle" && CATEGORIES[activeCategory]) {
    tags = CATEGORIES[activeCategory].tags;
  } else {
    tags = Object.values(CATEGORIES).flatMap((c) => c.tags);
  }

  list.innerHTML = tags
    .map(
      (tag) =>
        `<button class="tag-chip ${activeTag === tag ? "active" : ""}" data-tag="${escapeHTML(tag)}">${escapeHTML(tag)}</button>`
    )
    .join("");

  list.querySelectorAll(".tag-chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tag = btn.getAttribute("data-tag");
      activeTag = activeTag === tag ? null : tag;
      currentPage = 1;
      renderTags();
      renderTopics();
    });
  });
}

function getFilteredTopics() {
  return allTopics.filter((t) => {
    if (activeCategory !== "alle" && t.category !== activeCategory) return false;
    if (activeTag && t.tag !== activeTag) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const inTitle = (t.title || "").toLowerCase().includes(q);
      const inContent = (t.content || "").toLowerCase().includes(q);
      if (!inTitle && !inContent) return false;
    }
    return true;
  });
}

function renderTopics() {
  const list = $("topic-list");
  if (!list) return;

  const filtered = getFilteredTopics();
  const totalPages = Math.max(1, Math.ceil(filtered.length / TOPICS_PER_PAGE));
  if (currentPage > totalPages) currentPage = totalPages;

  const start = (currentPage - 1) * TOPICS_PER_PAGE;
  const pageTopics = filtered.slice(start, start + TOPICS_PER_PAGE);

  const emptyState = $("empty-state");
  if (emptyState) emptyState.classList.toggle("hidden", filtered.length > 0);

  const countEl = $("topic-count");
  if (countEl) {
    countEl.textContent =
      filtered.length === 1 ? "1 Thema" : `${filtered.length} Themen`;
  }

  const titleEl = $("content-title");
  if (titleEl) {
    titleEl.textContent =
      activeCategory === "alle"
        ? "Alle Themen"
        : CATEGORIES[activeCategory]
          ? CATEGORIES[activeCategory].name
          : "Alle Themen";
  }

  list.innerHTML = pageTopics
    .map((t) => {
      const author = profileOf(t.authorUid);
      const authorName = author ? author.username : t.authorName || "Unbekannt";
      const authorPoints = author ? author.points : 0;
      const authorIsAdmin = author ? author.isAdmin : false;
      const catName = CATEGORIES[t.category] ? CATEGORIES[t.category].name : t.category;
      const replies = t.replyCount || 0;

      return `
        <article class="topic-card" data-topic-id="${escapeHTML(t.id)}" role="link" tabindex="0"
                 aria-label="Thema öffnen: ${escapeHTML(t.title)}">
          <img class="avatar" src="${avatarURL(author ? author.avatarSeed : t.authorUid)}" alt="" aria-hidden="true" />
          <div class="topic-card-body">
            <h3 class="topic-card-title">${escapeHTML(t.title)}</h3>
            <div class="topic-card-meta">
              <span class="badge badge-category">${escapeHTML(catName)}</span>
              <span class="badge badge-tag">${escapeHTML(t.tag || "")}</span>
              <span>${escapeHTML(authorName)}</span>
              ${rankBadgeHTML(authorPoints, authorIsAdmin)}
              <span>${formatDate(t.createdAt)}</span>
            </div>
          </div>
          <div class="topic-card-stats">
            <i data-lucide="message-circle"></i>
            <span>${replies}</span>
          </div>
        </article>
      `;
    })
    .join("");

  list.querySelectorAll(".topic-card").forEach((card) => {
    const go = () => {
      window.location.href = `topic.html?id=${encodeURIComponent(card.getAttribute("data-topic-id"))}`;
    };
    card.addEventListener("click", go);
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        go();
      }
    });
  });

  renderPagination(totalPages);
  refreshIcons();
}

function renderPagination(totalPages) {
  const nav = $("pagination");
  if (!nav) return;

  if (totalPages <= 1) {
    nav.innerHTML = "";
    return;
  }

  let html = `<button class="page-btn" data-page="prev" ${currentPage === 1 ? "disabled" : ""} aria-label="Vorherige Seite">‹</button>`;
  for (let p = 1; p <= totalPages; p++) {
    html += `<button class="page-btn ${p === currentPage ? "active" : ""}" data-page="${p}" aria-label="Seite ${p}" ${p === currentPage ? 'aria-current="page"' : ""}>${p}</button>`;
  }
  html += `<button class="page-btn" data-page="next" ${currentPage === totalPages ? "disabled" : ""} aria-label="Nächste Seite">›</button>`;
  nav.innerHTML = html;

  nav.querySelectorAll(".page-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const val = btn.getAttribute("data-page");
      if (val === "prev" && currentPage > 1) currentPage--;
      else if (val === "next" && currentPage < totalPages) currentPage++;
      else if (val !== "prev" && val !== "next") currentPage = Number(val);
      renderTopics();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  });
}

function watchTopics() {
  onValue(ref(db, "topics"), (snapshot) => {
    const data = snapshot.val() || {};
    allTopics = Object.entries(data)
      .map(([id, t]) => ({ id, ...t }))
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    renderTopics();
  });
}

function initSearch() {
  const input = $("search-input");
  if (!input) return;
  input.addEventListener("input", () => {
    searchQuery = input.value.trim();
    currentPage = 1;
    renderTopics();
  });
}

// =====================================================
// Neues Thema erstellen
// =====================================================
function initNewTopic() {
  const openBtn = $("btn-new-topic");
  const form = $("topic-form");
  if (!openBtn || !form) return;

  // Kategorie-/Tag-Auswahl befüllen
  const catSelect = $("topic-category");
  const tagSelect = $("topic-tag");

  function fillTags(categoryKey) {
    const cat = CATEGORIES[categoryKey];
    tagSelect.innerHTML = (cat ? cat.tags : [])
      .map((t) => `<option value="${escapeHTML(t)}">${escapeHTML(t)}</option>`)
      .join("");
  }

  catSelect.innerHTML = Object.entries(CATEGORIES)
    .map(([key, cat]) => `<option value="${key}">${escapeHTML(cat.name)}</option>`)
    .join("");
  fillTags(Object.keys(CATEGORIES)[0]);

  catSelect.addEventListener("change", () => fillTags(catSelect.value));

  openBtn.addEventListener("click", () => {
    if (!currentUser) {
      showToast("Bitte melde dich zuerst an, um ein Thema zu erstellen.", true);
      const tabLogin = $("tab-login");
      if (tabLogin) tabLogin.click();
      openModal("auth-modal");
      return;
    }
    openModal("topic-modal");
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    hideFormError("topic-error");

    if (!currentUser || !currentProfile) {
      showFormError("topic-error", "Du musst angemeldet sein, um ein Thema zu erstellen.");
      return;
    }
    if (!topicTurnstileToken) {
      showFormError("topic-error", "Bitte bestätige zuerst die Sicherheitsprüfung (Turnstile).");
      return;
    }

    const title = $("topic-title").value.trim();
    const content = $("topic-content").value.trim();
    const category = catSelect.value;
    const tag = tagSelect.value;

    if (title.length < 5) {
      showFormError("topic-error", "Der Titel muss mindestens 5 Zeichen lang sein.");
      return;
    }
    if (content.length < 10) {
      showFormError("topic-error", "Der Inhalt muss mindestens 10 Zeichen lang sein.");
      return;
    }

    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;

    try {
      const topicRef = push(ref(db, "topics"));
      await set(topicRef, {
        title,
        content,
        category,
        tag,
        authorUid: currentUser.uid,
        authorName: currentProfile.username || "Mitglied",
        replyCount: 0,
        createdAt: Date.now(),
      });

      // +10 Punkte für das Erstellen eines Themas
      await addPoints(currentUser.uid, 10);

      form.reset();
      fillTags(catSelect.value);
      topicTurnstileToken = null;
      if (window.turnstile) window.turnstile.reset();

      closeModal("topic-modal");
      showToast("Dein Thema wurde veröffentlicht! (+10 Punkte)");
      window.location.href = `topic.html?id=${encodeURIComponent(topicRef.key)}`;
    } catch (error) {
      console.log("[v0] Fehler beim Erstellen des Themas:", error);
      showFormError("topic-error", "Das Thema konnte nicht erstellt werden. Bitte versuche es erneut.");
    } finally {
      submitBtn.disabled = false;
    }
  });
}

// =====================================================
// THEMENSEITE: Detail + verschachtelte Kommentare
// =====================================================
let loadedTopicId = null;
let loadedTopic = null;
let loadedComments = {}; // commentId -> Kommentar

function getTopicIdFromURL() {
  const params = new URLSearchParams(window.location.search);
  return params.get("id");
}

function renderTopicPage() {
  if (!loadedTopic) return;

  const author = profileOf(loadedTopic.authorUid);
  const authorName = author ? author.username : loadedTopic.authorName || "Unbekannt";

  document.title = `${loadedTopic.title} – Higum Forum`;

  const catName = CATEGORIES[loadedTopic.category]
    ? CATEGORIES[loadedTopic.category].name
    : loadedTopic.category;

  $("topic-category-badge").textContent = catName;
  $("topic-tag-badge").textContent = loadedTopic.tag || "";
  $("topic-title").textContent = loadedTopic.title;
  $("topic-content").textContent = loadedTopic.content;
  $("topic-date").textContent = formatDate(loadedTopic.createdAt);
  $("topic-author-name").textContent = authorName;
  $("topic-author-avatar").src = avatarURL(author ? author.avatarSeed : loadedTopic.authorUid);
  $("topic-author-avatar").alt = `Profilbild von ${authorName}`;

  const rankEl = $("topic-author-rank");
  const rank = getRank(author ? author.points : 0, author ? author.isAdmin : false);
  rankEl.classList.toggle("rank-admin", rank.isAdmin);
  rankEl.innerHTML = rank.isAdmin
    ? `<i data-lucide="shield-check"></i>${escapeHTML(rank.name)}`
    : `<i data-lucide="medal"></i>${escapeHTML(rank.name)}`;

  renderComments();
  refreshIcons();
}

function buildCommentTree() {
  const roots = [];
  const byId = {};

  for (const [id, c] of Object.entries(loadedComments)) {
    byId[id] = { id, ...c, children: [] };
  }
  for (const node of Object.values(byId)) {
    if (node.parentId && byId[node.parentId]) {
      byId[node.parentId].children.push(node);
    } else {
      roots.push(node);
    }
  }

  const sortRec = (nodes) => {
    nodes.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    nodes.forEach((n) => sortRec(n.children));
  };
  sortRec(roots);
  return roots;
}

function commentHTML(node, depth) {
  const author = profileOf(node.authorUid);
  const authorName = author ? author.username : node.authorName || "Unbekannt";
  const points = author ? author.points : 0;
  const isAdmin = author ? author.isAdmin : false;

  const childrenHTML = node.children.length
    ? `<div class="comment-children">${node.children.map((c) => commentHTML(c, depth + 1)).join("")}</div>`
    : "";

  return `
    <div class="comment" data-comment-id="${escapeHTML(node.id)}">
      <div class="comment-header">
        <img class="avatar avatar-xs" src="${avatarURL(author ? author.avatarSeed : node.authorUid)}" alt="" aria-hidden="true" />
        <span class="comment-author">${escapeHTML(authorName)}</span>
        ${rankBadgeHTML(points, isAdmin)}
        <time class="comment-date">${formatDate(node.createdAt)}</time>
      </div>
      <div class="comment-body">${escapeHTML(node.content)}</div>
      <div class="comment-actions">
        <button class="comment-reply-btn" data-reply-to="${escapeHTML(node.id)}">
          <i data-lucide="corner-down-right"></i>
          Antworten
        </button>
      </div>
      <div class="inline-reply-slot"></div>
      ${childrenHTML}
    </div>
  `;
}

function renderComments() {
  const tree = $("comments-tree");
  if (!tree) return;

  const roots = buildCommentTree();
  const total = Object.keys(loadedComments).length;

  const countEl = $("comments-count");
  if (countEl) {
    countEl.textContent = total === 1 ? "1 Antwort" : `${total} Antworten`;
  }

  tree.innerHTML = roots.map((r) => commentHTML(r, 0)).join("");

  // "Antworten"-Buttons: Inline-Formular ein-/ausblenden
  tree.querySelectorAll(".comment-reply-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!currentUser) {
        showToast("Bitte melde dich an, um zu antworten.", true);
        return;
      }
      const parentId = btn.getAttribute("data-reply-to");
      const comment = tree.querySelector(`.comment[data-comment-id="${CSS.escape(parentId)}"]`);
      if (!comment) return;
      const slot = comment.querySelector(":scope > .inline-reply-slot");
      if (!slot) return;

      // Bereits geöffnetes Formular schließen (Toggle)
      if (slot.querySelector("form")) {
        slot.innerHTML = "";
        return;
      }

      // Alle anderen Inline-Formulare schließen
      tree.querySelectorAll(".inline-reply-slot").forEach((s) => (s.innerHTML = ""));

      slot.innerHTML = `
        <form class="inline-reply-form">
          <textarea required minlength="2" rows="3" placeholder="Deine Antwort…" aria-label="Deine Antwort"></textarea>
          <div class="inline-reply-actions">
            <button type="button" class="btn btn-ghost btn-cancel">Abbrechen</button>
            <button type="submit" class="btn btn-primary">Antworten</button>
          </div>
        </form>
      `;

      const form = slot.querySelector("form");
      const textarea = form.querySelector("textarea");
      textarea.focus();

      form.querySelector(".btn-cancel").addEventListener("click", () => (slot.innerHTML = ""));
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const content = textarea.value.trim();
        if (content.length < 2) return;
        const ok = await submitComment(content, parentId);
        if (ok) slot.innerHTML = "";
      });
    });
  });

  refreshIcons();
}

async function submitComment(content, parentId) {
  if (!currentUser || !currentProfile || !loadedTopicId) {
    showToast("Bitte melde dich an, um zu antworten.", true);
    return false;
  }

  try {
    const commentRef = push(ref(db, `comments/${loadedTopicId}`));
    await set(commentRef, {
      content,
      parentId: parentId || null,
      authorUid: currentUser.uid,
      authorName: currentProfile.username || "Mitglied",
      createdAt: Date.now(),
    });

    // Antwortzähler des Themas atomar erhöhen
    await runTransaction(ref(db, `topics/${loadedTopicId}/replyCount`), (current) => {
      return (Number(current) || 0) + 1;
    });

    // +5 Punkte für einen Kommentar
    await addPoints(currentUser.uid, 5);

    showToast("Deine Antwort wurde veröffentlicht! (+5 Punkte)");
    return true;
  } catch (error) {
    console.log("[v0] Fehler beim Speichern der Antwort:", error);
    showToast("Deine Antwort konnte nicht gespeichert werden.", true);
    return false;
  }
}

function initTopicPage() {
  loadedTopicId = getTopicIdFromURL();

  const loading = $("topic-loading");
  const notFound = $("topic-not-found");
  const detail = $("topic-detail");
  const commentsSection = $("comments-section");

  if (!loadedTopicId) {
    loading.classList.add("hidden");
    notFound.classList.remove("hidden");
    refreshIcons();
    return;
  }

  // Thema in Echtzeit beobachten
  onValue(ref(db, `topics/${loadedTopicId}`), (snapshot) => {
    loading.classList.add("hidden");
    if (!snapshot.exists()) {
      notFound.classList.remove("hidden");
      detail.classList.add("hidden");
      commentsSection.classList.add("hidden");
      refreshIcons();
      return;
    }
    loadedTopic = snapshot.val();
    notFound.classList.add("hidden");
    detail.classList.remove("hidden");
    commentsSection.classList.remove("hidden");
    renderTopicPage();
  });

  // Kommentare in Echtzeit beobachten
  onValue(ref(db, `comments/${loadedTopicId}`), (snapshot) => {
    loadedComments = snapshot.val() || {};
    if (loadedTopic) renderComments();
  });

  // Haupt-Antwortformular
  const replyForm = $("reply-form");
  if (replyForm) {
    replyForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      hideFormError("reply-error");
      const textarea = $("reply-content");
      const content = textarea.value.trim();
      if (content.length < 2) {
        showFormError("reply-error", "Deine Antwort muss mindestens 2 Zeichen lang sein.");
        return;
      }
      const submitBtn = replyForm.querySelector('button[type="submit"]');
      submitBtn.disabled = true;
      const ok = await submitComment(content, null);
      submitBtn.disabled = false;
      if (ok) textarea.value = "";
    });
  }
}

// =====================================================
// Initialisierung
// =====================================================
document.addEventListener("DOMContentLoaded", () => {
  // EmailJS initialisieren (nur wenn das SDK geladen wurde)
  if (window.emailjs) {
    window.emailjs.init(EMAILJS_PUBLIC_KEY);
  }

  refreshIcons();
  initAuthState();
  initModals();
  initLogin();
  initRegister();
  initOTP();
  watchUsers();

  const isTopicPage = Boolean($("topic-detail"));
  if (isTopicPage) {
    initTopicPage();
  } else {
    renderCategories();
    renderTags();
    initSearch();
    initNewTopic();
    watchTopics();
  }
});
