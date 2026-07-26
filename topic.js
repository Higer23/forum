/**
 * Higum Forum - Topic Page
 * Version: 3.0.0 - Complete Rewrite
 */

import { auth, database } from "./firebase-config.js";
import {
    onAuthStateChanged,
    signOut,
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    sendEmailVerification,
    reload
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import {
    ref, set, get, push, onValue, update, remove
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";

// =========================================
// KONFIGURASYON
// =========================================
const CONFIG = {
    TURNSTILE_SITEKEY: "0x4AAAAAAD80pv0OMAdNnE2Q",
    RESEND_COOLDOWN_SECONDS: 60,
    MAX_NESTED_DEPTH: 5,
    RANKS: [
        { threshold: 0, name: "Rekrut", class: "" },
        { threshold: 21, name: "Unteroffizier", class: "" },
        { threshold: 101, name: "Leutnant", class: "" },
        { threshold: 251, name: "Hauptmann", class: "" },
        { threshold: 501, name: "Major", class: "" }
    ]
};

// =========================================
// DURUM YÖNETİMİ
// =========================================
const state = {
    currentTopic: null,
    currentUser: null,
    topicId: null,
    parentReplyId: null,
    pendingVerificationUser: null,
    resendCooldownInterval: null,
    likedReplies: new Set(),
    allReplies: [],
    isOnline: navigator.onLine
};

// =========================================
// YARDIMCI FONKSİYONLAR
// =========================================

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function sanitizeInput(text, maxLength = 5000) {
    if (!text) return '';
    return text.trim().substring(0, maxLength);
}

function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidUsername(username) {
    return /^[a-zA-Z0-9_]{3,30}$/.test(username);
}

function formatDate(timestamp) {
    if (!timestamp) return 'Unbekannt';
    try {
        const date = new Date(timestamp);
        return date.toLocaleDateString('de-DE', {
            day: '2-digit', month: 'short', year: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });
    } catch (e) {
        return 'Ungültiges Datum';
    }
}

function getRank(points, isAdmin = false) {
    if (isAdmin) return { name: "General (Admin)", class: "admin" };
    for (let i = CONFIG.RANKS.length - 1; i >= 0; i--) {
        if (points >= CONFIG.RANKS[i].threshold) {
            return CONFIG.RANKS[i];
        }
    }
    return CONFIG.RANKS[0];
}

function getCategoryLabel(category) {
    const labels = {
        general: 'Allgemein',
        announcements: 'Ankündigungen',
        help: 'Hilfe & Support',
        feedback: 'Feedback'
    };
    return labels[category] || category;
}

function getFirebaseErrorMessage(code) {
    const messages = {
        'auth/invalid-credential': 'Falsche E-Mail oder Passwort.',
        'auth/email-already-in-use': 'Diese E-Mail wird bereits verwendet.',
        'auth/weak-password': 'Das Passwort muss mindestens 6 Zeichen lang sein.',
        'auth/invalid-email': 'Ungültige E-Mail-Adresse.',
        'auth/user-disabled': 'Dieser Account wurde deaktiviert.',
        'auth/user-not-found': 'Kein Account mit dieser E-Mail gefunden.',
        'auth/wrong-password': 'Falsches Passwort.',
        'auth/too-many-requests': 'Zu viele Versuche. Bitte versuche es später.',
        'auth/network-request-failed': 'Netzwerkfehler. Bitte prüfe deine Verbindung.'
    };
    return messages[code] || 'Ein unerwarteter Fehler ist aufgetreten.';
}

function showToast(message, type = 'success') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const icons = {
        success: 'check-circle',
        error: 'alert-circle',
        warning: 'alert-triangle',
        info: 'info'
    };

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.setAttribute('role', 'alert');
    toast.innerHTML = `
        <i data-lucide="${icons[type] || icons.info}"></i>
        <span>${escapeHtml(message)}</span>
    `;

    container.appendChild(toast);
    if (window.lucide) window.lucide.createIcons();

    setTimeout(() => {
        toast.classList.add('hiding');
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

function setButtonLoading(buttonId, loading) {
    const btn = document.getElementById(buttonId);
    if (!btn) return;

    const textSpan = btn.querySelector('.btn-text');
    const originalText = btn.dataset.originalText || textSpan?.textContent;

    if (loading) {
        btn.dataset.originalText = originalText;
        btn.disabled = true;
        if (textSpan) textSpan.innerHTML = '<span class="spinner"></span> Bitte warten...';
    } else {
        btn.disabled = false;
        if (textSpan) textSpan.textContent = originalText || 'Absenden';
    }
}

function openModal(id) {
    const modal = document.getElementById(id);
    if (modal) modal.classList.add('active');
}

window.closeModal = function(id) {
    const modal = document.getElementById(id);
    if (!modal) return;

    modal.classList.remove('active');

    if (id === 'otpModal' && state.resendCooldownInterval) {
        clearInterval(state.resendCooldownInterval);
        state.resendCooldownInterval = null;
    }

    const turnstile = modal.querySelector('.cf-turnstile');
    if (turnstile && window.turnstile) {
        window.turnstile.reset(turnstile);
    }
};

function showConfirm(message, onConfirm, onCancel) {
    const existing = document.querySelector('.confirm-dialog-backdrop');
    if (existing) existing.remove();

    const backdrop = document.createElement('div');
    backdrop.className = 'confirm-dialog-backdrop';
    backdrop.innerHTML = `
        <div class="confirm-dialog">
            <h3>Bestätigung</h3>
            <p>${escapeHtml(message)}</p>
            <div class="confirm-dialog-actions">
                <button class="btn-secondary" id="confirmCancel">Abbrechen</button>
                <button class="btn-danger" id="confirmOk">Bestätigen</button>
            </div>
        </div>
    `;

    document.body.appendChild(backdrop);

    backdrop.querySelector('#confirmCancel').addEventListener('click', () => {
        backdrop.remove();
        if (onCancel) onCancel();
    });

    backdrop.querySelector('#confirmOk').addEventListener('click', () => {
        backdrop.remove();
        if (onConfirm) onConfirm();
    });

    backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) {
            backdrop.remove();
            if (onCancel) onCancel();
        }
    });
}

function setupCharCounter(inputId, counterId, maxLength) {
    const input = document.getElementById(inputId);
    const counter = document.getElementById(counterId);
    if (!input || !counter) return;

    input.addEventListener('input', () => {
        const length = input.value.length;
        counter.textContent = `${length} / ${maxLength}`;
        counter.classList.remove('warning', 'danger');
        if (length > maxLength * 0.9) {
            counter.classList.add('danger');
        } else if (length > maxLength * 0.8) {
            counter.classList.add('warning');
        }
    });
}

function startResendCooldown() {
    clearInterval(state.resendCooldownInterval);
    let timeLeft = CONFIG.RESEND_COOLDOWN_SECONDS;
    const resendBtn = document.getElementById('resendVerificationBtn');
    const cooldownText = document.getElementById('resendCooldownText');
    const cooldownSpan = document.getElementById('resendCooldown');

    if (resendBtn) resendBtn.disabled = true;
    if (cooldownText) cooldownText.style.display = 'block';
    if (cooldownSpan) cooldownSpan.textContent = timeLeft;

    state.resendCooldownInterval = setInterval(() => {
        timeLeft--;
        if (cooldownSpan) cooldownSpan.textContent = timeLeft;

        if (timeLeft <= 0) {
            clearInterval(state.resendCooldownInterval);
            state.resendCooldownInterval = null;
            if (resendBtn) resendBtn.disabled = false;
            if (cooldownText) cooldownText.style.display = 'none';
        }
    }, 1000);
}

// =========================================
// AUTH İŞLEMLERİ
// =========================================

function initAuth() {
    const loginBtn = document.getElementById('loginBtn');
    if (loginBtn) {
        loginBtn.addEventListener('click', () => {
            if (auth.currentUser) {
                showConfirm('Möchtest du dich wirklich abmelden?', () => {
                    signOut(auth).then(() => showToast('Erfolgreich abgemeldet!', 'success'));
                });
            } else {
                openModal('authModal');
            }
        });
    }

    onAuthStateChanged(auth, (user) => {
        state.currentUser = user;
        if (loginBtn) {
            if (user) {
                loginBtn.innerHTML = '<i data-lucide="log-out"></i> Abmelden';
                loginBtn.classList.replace('btn-outline', 'btn-secondary');
            } else {
                loginBtn.innerHTML = 'Anmelden';
                loginBtn.classList.replace('btn-secondary', 'btn-outline');
            }
            if (window.lucide) window.lucide.createIcons();
        }
        updateReplyFormVisibility();
    });

    // Tab geçişleri
    const tabBtns = document.querySelectorAll('.tab-btn');
    tabBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            const tabId = e.target.getAttribute('data-tab');
            document.querySelectorAll('.tab-btn').forEach(b => {
                b.classList.remove('active');
                b.setAttribute('aria-selected', 'false');
            });
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            e.target.classList.add('active');
            e.target.setAttribute('aria-selected', 'true');
            const tabContent = document.getElementById(tabId + 'Tab');
            if (tabContent) tabContent.classList.add('active');
        });
    });

    // Escape tuşu
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            document.querySelectorAll('.modal.active').forEach(modal => {
                window.closeModal(modal.id);
            });
        }
    });

    // Login form
    const loginForm = document.getElementById('loginForm');
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const email = sanitizeInput(document.getElementById('loginEmail').value, 254);
            const password = document.getElementById('loginPassword').value;

            if (!isValidEmail(email)) {
                showToast('Bitte gib eine gültige E-Mail-Adresse ein.', 'error');
                return;
            }

            setButtonLoading('loginSubmitBtn', true);

            try {
                const userCredential = await signInWithEmailAndPassword(auth, email, password);
                await reload(userCredential.user);

                if (!userCredential.user.emailVerified) {
                    window.closeModal('authModal');
                    showVerificationModal(userCredential.user);
                    showToast('Bitte bestätige zuerst deine E-Mail-Adresse.', 'warning');
                    setButtonLoading('loginSubmitBtn', false);
                    return;
                }

                window.closeModal('authModal');
                showToast('Erfolgreich angemeldet!', 'success');
                loginForm.reset();
            } catch (error) {
                const message = getFirebaseErrorMessage(error.code);
                showToast(message, 'error');
                console.error(error);
            } finally {
                setButtonLoading('loginSubmitBtn', false);
            }
        });
    }

    // Register form
    const registerForm = document.getElementById('registerForm');
    if (registerForm) {
        registerForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const turnstileResponse = new FormData(registerForm).get('cf-turnstile-response');
            if (!turnstileResponse) {
                showToast('Bitte bestätige, dass du ein Mensch bist.', 'error');
                return;
            }

            const username = sanitizeInput(document.getElementById('registerUsername').value, 30);
            const email = sanitizeInput(document.getElementById('registerEmail').value, 254);
            const password = document.getElementById('registerPassword').value;
            const passwordConfirm = document.getElementById('registerPasswordConfirm').value;

            if (!isValidUsername(username)) {
                showToast('Benutzername: 3-30 Zeichen, nur Buchstaben, Zahlen und Unterstrich.', 'error');
                return;
            }

            if (!isValidEmail(email)) {
                showToast('Bitte gib eine gültige E-Mail-Adresse ein.', 'error');
                return;
            }

            if (password !== passwordConfirm) {
                showToast('Die Passwörter stimmen nicht überein.', 'error');
                return;
            }

            if (password.length < 6) {
                showToast('Das Passwort muss mindestens 6 Zeichen lang sein.', 'error');
                return;
            }

            setButtonLoading('registerSubmitBtn', true);

            try {
                const usersSnapshot = await get(ref(database, 'users'));
                let emailExists = false;
                if (usersSnapshot.exists()) {
                    usersSnapshot.forEach(child => {
                        if (child.val().email === email) emailExists = true;
                    });
                }

                if (emailExists) {
                    showToast('Diese E-Mail wird bereits verwendet.', 'error');
                    setButtonLoading('registerSubmitBtn', false);
                    return;
                }

                const userCredential = await createUserWithEmailAndPassword(auth, email, password);
                const user = userCredential.user;

                await set(ref(database, 'users/' + user.uid), {
                    username,
                    email,
                    points: 0,
                    isAdmin: false,
                    avatar: `https://api.dicebear.com/10.x/notionists-neutral/svg?seed=${user.uid}`,
                    createdAt: Date.now()
                });

                await sendEmailVerification(user);

                window.closeModal('authModal');
                showVerificationModal(user);
                showToast('Registrierung erfolgreich! Bitte bestätige deine E-Mail.', 'success');
                registerForm.reset();
                if (window.turnstile) window.turnstile.reset();

            } catch (error) {
                console.error('Registrierungsfehler:', error);
                if (error.code === 'PERMISSION_DENIED' || (error.message && error.message.includes('permission_denied'))) {
                    showToast('Datenbankzugriff verweigert. Bitte Firebase-Regeln prüfen.', 'error');
                } else {
                    showToast(getFirebaseErrorMessage(error.code) || ('Fehler: ' + error.message), 'error');
                }
            } finally {
                setButtonLoading('registerSubmitBtn', false);
            }
        });
    }

    // Email verification modal helpers
    function showVerificationModal(user) {
        state.pendingVerificationUser = user;
        const emailSpan = document.getElementById('verifyEmailAddress');
        if (emailSpan) emailSpan.textContent = user.email;
        openModal('otpModal');
        startResendCooldown();
    }

    const checkVerifiedBtn = document.getElementById('checkVerifiedBtn');
    checkVerifiedBtn?.addEventListener('click', async () => {
        if (!state.pendingVerificationUser) {
            window.closeModal('otpModal');
            return;
        }

        setButtonLoading('checkVerifiedBtn', true);
        try {
            await reload(state.pendingVerificationUser);
            if (state.pendingVerificationUser.emailVerified) {
                window.closeModal('otpModal');
                showToast('E-Mail bestätigt! Willkommen!', 'success');
                state.pendingVerificationUser = null;
            } else {
                showToast('Noch nicht bestätigt. Bitte prüfe dein Postfach (auch Spam-Ordner).', 'warning');
            }
        } catch (error) {
            console.error(error);
            showToast('Fehler beim Prüfen des Status.', 'error');
        } finally {
            setButtonLoading('checkVerifiedBtn', false);
        }
    });

    const resendVerificationBtn = document.getElementById('resendVerificationBtn');
    resendVerificationBtn?.addEventListener('click', async () => {
        if (!state.pendingVerificationUser || resendVerificationBtn.disabled) return;

        setButtonLoading('resendVerificationBtn', true);
        try {
            await sendEmailVerification(state.pendingVerificationUser);
            showToast('Bestätigungs-E-Mail erneut gesendet!', 'success');
            startResendCooldown();
        } catch (error) {
            console.error(error);
            if (error.code === 'auth/too-many-requests') {
                showToast('Zu viele Versuche. Bitte warte einen Moment.', 'error');
            } else {
                showToast('Fehler beim Senden der E-Mail.', 'error');
            }
        } finally {
            setButtonLoading('resendVerificationBtn', false);
        }
    });
}

function updateReplyFormVisibility() {
    const replyFormWrapper = document.getElementById('replyFormWrapper');
    const authPromptReply = document.getElementById('authPromptReply');
    const replyForm = document.getElementById('replyForm');

    if (!replyFormWrapper) return;

    if (state.currentUser) {
        if (replyForm) replyForm.style.display = 'block';
        if (authPromptReply) authPromptReply.style.display = 'none';
    } else {
        if (replyForm) replyForm.style.display = 'none';
        if (authPromptReply) authPromptReply.style.display = 'block';

        const loginPromptReply = document.getElementById('loginPromptReply');
        if (loginPromptReply) {
            loginPromptReply.addEventListener('click', () => openModal('authModal'));
        }
    }
}

// =========================================
// TOPİC VERİLERİ
// =========================================

async function loadTopicData() {
    try {
        const topicRef = ref(database, 'topics/' + state.topicId);
        const topicSnapshot = await get(topicRef);

        if (!topicSnapshot.exists()) {
            document.body.innerHTML = `
                <div style="text-align: center; margin-top: 100px; color: var(--danger);">
                    <h1>404 - Topic nicht gefunden</h1>
                    <p>Das gesuchte Thema existiert nicht oder wurde gelöscht.</p>
                    <a href="index.html" style="margin-top: 20px; display: inline-block;">Zurück zum Forum</a>
                </div>
            `;
            return;
        }

        state.currentTopic = { id: state.topicId, ...topicSnapshot.val() };

        // Views arttır
        await update(topicRef, { views: (state.currentTopic.views || 0) + 1 });
        state.currentTopic.views = (state.currentTopic.views || 0) + 1;

        await renderTopicData();
        loadReplies();

    } catch (error) {
        console.error('Fehler beim Laden des Topics:', error);
        showToast('Fehler beim Laden des Themas.', 'error');
    }
}

async function renderTopicData() {
    const topic = state.currentTopic;
    if (!topic) return;

    try {
        const authorSnapshot = await get(ref(database, 'users/' + topic.authorId));
        const author = authorSnapshot.val() || {
            username: 'Unbekannt',
            avatar: 'https://api.dicebear.com/10.x/notionists-neutral/svg?seed=unknown',
            points: 0,
            isAdmin: false
        };
        const rank = getRank(author.points, author.isAdmin);

        const catEl = document.getElementById('topicCategory');
        if (catEl) catEl.textContent = getCategoryLabel(topic.category);

        const titleEl = document.getElementById('topicTitle');
        if (titleEl) titleEl.textContent = topic.title;

        const avatarEl = document.getElementById('authorAvatar');
        if (avatarEl) {
            avatarEl.src = author.avatar;
            avatarEl.alt = author.username;
        }

        const usernameEl = document.getElementById('authorUsername');
        if (usernameEl) usernameEl.textContent = author.username;

        const rankEl = document.getElementById('authorRank');
        if (rankEl) {
            rankEl.textContent = rank.name;
            rankEl.className = `rank-badge ${rank.class}`;
        }

        const dateEl = document.getElementById('authorCreatedDate');
        if (dateEl) dateEl.textContent = formatDate(topic.createdAt);

        const pointsEl = document.getElementById('authorPoints');
        if (pointsEl) pointsEl.textContent = `${author.points} Punkte`;

        const replyCountEl = document.getElementById('replyCount');
        if (replyCountEl) replyCountEl.textContent = `${topic.replyCount || 0} Antworten`;

        const viewCountEl = document.getElementById('viewCount');
        if (viewCountEl) viewCountEl.textContent = `${topic.views} Ansichten`;

        const descEl = document.getElementById('topicDescription');
        if (descEl) descEl.textContent = topic.description || '';

        const tagsContainer = document.getElementById('topicTagsContainer');
        if (tagsContainer) {
            if (topic.tags && topic.tags.length > 0) {
                tagsContainer.innerHTML = topic.tags.map(tag =>
                    `<span class="tag-badge">${escapeHtml(tag)}</span>`
                ).join('');
            } else {
                tagsContainer.innerHTML = '';
            }
        }

        if (window.lucide) window.lucide.createIcons();

    } catch (error) {
        console.error('Fehler beim Rendern des Topics:', error);
    }
}

// =========================================
// CEVAPLAR (REPLIES)
// =========================================

function loadReplies() {
    const repliesRef = ref(database, 'replies');
    onValue(repliesRef, async (snapshot) => {
        const repliesContainer = document.getElementById('repliesContainer');
        if (!repliesContainer) return;

        repliesContainer.innerHTML = '';

        if (!snapshot.exists()) {
            repliesContainer.innerHTML = `
                <div class="empty-state">
                    <i data-lucide="message-circle" class="empty-state-icon"></i>
                    <h3>Noch keine Antworten</h3>
                    <p>Sei der Erste und schreibe eine Antwort!</p>
                </div>
            `;
            if (window.lucide) window.lucide.createIcons();
            return;
        }

        state.allReplies = [];
        snapshot.forEach(childSnapshot => {
            state.allReplies.push({ id: childSnapshot.key, ...childSnapshot.val() });
        });

        const topicReplies = state.allReplies.filter(r => r.topicId === state.topicId && !r.parentReplyId);

        if (topicReplies.length === 0) {
            repliesContainer.innerHTML = `
                <div class="empty-state">
                    <i data-lucide="message-circle" class="empty-state-icon"></i>
                    <h3>Noch keine Antworten</h3>
                    <p>Sei der Erste und schreibe eine Antwort!</p>
                </div>
            `;
            if (window.lucide) window.lucide.createIcons();
            return;
        }

        topicReplies.sort((a, b) => b.createdAt - a.createdAt);

        for (const reply of topicReplies) {
            const replyElement = await createReplyElement(reply, 0);
            repliesContainer.appendChild(replyElement);
        }

        if (window.lucide) window.lucide.createIcons();
    });
}

async function createReplyElement(reply, depth) {
    const authorSnapshot = await get(ref(database, 'users/' + reply.authorId));
    const author = authorSnapshot.val() || {
        username: 'Unbekannt',
        avatar: 'https://api.dicebear.com/10.x/notionists-neutral/svg?seed=unknown',
        points: 0,
        isAdmin: false
    };
    const rank = getRank(author.points, author.isAdmin);

    const isLiked = state.likedReplies.has(reply.id);
    const isAuthor = state.currentUser && state.currentUser.uid === reply.authorId;
    const isAdmin = state.currentUser && authorSnapshot.val()?.isAdmin;

    const replyDiv = document.createElement('div');
    replyDiv.className = 'reply-card';
    replyDiv.dataset.replyId = reply.id;

    replyDiv.innerHTML = `
        <div class="reply-header">
            <div class="reply-author">
                <img src="${escapeHtml(author.avatar)}" alt="${escapeHtml(author.username)}" class="reply-avatar" loading="lazy">
                <div class="reply-author-info">
                    <div class="reply-author-name">
                        <strong>${escapeHtml(author.username)}</strong>
                        <span class="rank-badge ${escapeHtml(rank.class)}">${escapeHtml(rank.name)}</span>
                    </div>
                    <div class="reply-meta">${formatDate(reply.createdAt)}</div>
                </div>
            </div>
            ${isAuthor || isAdmin ? `
            <div class="reply-menu">
                <button class="btn-action reply-menu-btn" onclick="toggleReplyMenu('${reply.id}')">
                    <i data-lucide="more-vertical"></i>
                </button>
                <div class="reply-menu-dropdown" id="replyMenu-${reply.id}">
                    ${isAuthor ? `<button onclick="editReply('${reply.id}')" class="menu-item"><i data-lucide="edit-2"></i> Bearbeiten</button>` : ''}
                    <button onclick="deleteReply('${reply.id}')" class="menu-item danger"><i data-lucide="trash-2"></i> Löschen</button>
                </div>
            </div>
            ` : ''}
        </div>
        <div class="reply-content" id="replyContent-${reply.id}">${escapeHtml(reply.content)}</div>
        <div class="reply-actions">
            <button class="btn-action ${isLiked ? 'liked' : ''}" onclick="likeReply('${reply.id}')">
                <i data-lucide="heart"></i>
                <span>${reply.likes || 0}</span>
            </button>
            <button class="btn-action" onclick="openReplyToReplyModal('${reply.id}')">
                <i data-lucide="reply"></i>
                <span>Antworten</span>
            </button>
        </div>
    `;

    // İç içe cevaplar
    if (depth < CONFIG.MAX_NESTED_DEPTH) {
        const nestedReplies = state.allReplies.filter(r => r.parentReplyId === reply.id);
        if (nestedReplies.length > 0) {
            nestedReplies.sort((a, b) => a.createdAt - b.createdAt);
            const nestedContainer = document.createElement('div');
            nestedContainer.className = 'nested-replies';

            for (const nestedReply of nestedReplies) {
                const nestedElement = await createReplyElement(nestedReply, depth + 1);
                nestedContainer.appendChild(nestedElement);
            }

            replyDiv.appendChild(nestedContainer);
        }
    }

    return replyDiv;
}

// =========================================
// CEVAP İŞLEMLERİ
// =========================================

function initReplyForms() {
    // Ana cevap formu
    const replyForm = document.getElementById('replyForm');
    if (replyForm) {
        replyForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            if (!state.currentUser) {
                showToast('Du musst angemeldet sein, um eine Antwort zu schreiben.', 'error');
                openModal('authModal');
                return;
            }

            const turnstileResponse = new FormData(replyForm).get('cf-turnstile-response');
            if (!turnstileResponse) {
                showToast('Bitte bestätige, dass du ein Mensch bist.', 'error');
                return;
            }

            const replyContent = sanitizeInput(document.getElementById('replyContent').value, 5000);
            if (!replyContent || replyContent.length < 2) {
                showToast('Bitte gebe den Inhalt der Antwort ein (mindestens 2 Zeichen).', 'error');
                return;
            }

            setButtonLoading('replySubmitBtn', true);

            try {
                const repliesRef = ref(database, 'replies');
                const newReplyRef = push(repliesRef);
                await set(newReplyRef, {
                    topicId: state.topicId,
                    authorId: state.currentUser.uid,
                    content: replyContent,
                    createdAt: Date.now(),
                    likes: 0,
                    parentReplyId: null
                });

                // Topic replyCount arttır
                const topicRef = ref(database, 'topics/' + state.topicId);
                const topicSnapshot = await get(topicRef);
                if (topicSnapshot.exists()) {
                    const currentReplyCount = topicSnapshot.val().replyCount || 0;
                    await update(topicRef, { replyCount: currentReplyCount + 1 });
                }

                // Kullanıcı puanı +5
                const userRef = ref(database, 'users/' + state.currentUser.uid);
                const userSnapshot = await get(userRef);
                if (userSnapshot.exists()) {
                    const currentPoints = userSnapshot.val().points || 0;
                    await update(userRef, { points: currentPoints + 5 });
                }

                replyForm.reset();
                document.getElementById('replyCharCounter').textContent = '0 / 5000';
                if (window.turnstile) window.turnstile.reset();
                showToast('Antwort erfolgreich erstellt!', 'success');

            } catch (error) {
                showToast('Fehler beim Erstellen der Antwort.', 'error');
                console.error(error);
            } finally {
                setButtonLoading('replySubmitBtn', false);
            }
        });
    }

    // İç içe cevap formu
    const replyToReplyForm = document.getElementById('replyToReplyForm');
    if (replyToReplyForm) {
        replyToReplyForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            if (!state.currentUser) {
                showToast('Du musst angemeldet sein.', 'error');
                return;
            }

            const turnstileResponse = new FormData(replyToReplyForm).get('cf-turnstile-response');
            if (!turnstileResponse) {
                showToast('Bitte bestätige, dass du ein Mensch bist.', 'error');
                return;
            }

            const nestedReplyContent = sanitizeInput(document.getElementById('nestedReplyContent').value, 5000);
            if (!nestedReplyContent || nestedReplyContent.length < 2) {
                showToast('Bitte gebe den Inhalt der Antwort ein (mindestens 2 Zeichen).', 'error');
                return;
            }

            setButtonLoading('nestedReplySubmitBtn', true);

            try {
                const repliesRef = ref(database, 'replies');
                const newReplyRef = push(repliesRef);
                await set(newReplyRef, {
                    topicId: state.topicId,
                    authorId: state.currentUser.uid,
                    content: nestedReplyContent,
                    createdAt: Date.now(),
                    likes: 0,
                    parentReplyId: state.parentReplyId
                });

                // Kullanıcı puanı +5
                const userRef = ref(database, 'users/' + state.currentUser.uid);
                const userSnapshot = await get(userRef);
                if (userSnapshot.exists()) {
                    const currentPoints = userSnapshot.val().points || 0;
                    await update(userRef, { points: currentPoints + 5 });
                }

                window.closeModal('replyToReplyModal');
                replyToReplyForm.reset();
                document.getElementById('nestedReplyCharCounter').textContent = '0 / 5000';
                if (window.turnstile) window.turnstile.reset();
                showToast('Antwort erfolgreich erstellt!', 'success');
                state.parentReplyId = null;

            } catch (error) {
                showToast('Fehler beim Erstellen der Antwort.', 'error');
                console.error(error);
            } finally {
                setButtonLoading('nestedReplySubmitBtn', false);
            }
        });
    }
}

window.likeReply = async function(replyId) {
    if (!state.currentUser) {
        showToast('Du musst angemeldet sein, um zu liken.', 'error');
        openModal('authModal');
        return;
    }

    if (state.likedReplies.has(replyId)) {
        showToast('Du hast diesen Beitrag bereits geliked.', 'warning');
        return;
    }

    try {
        const replyRef = ref(database, 'replies/' + replyId);
        const replySnapshot = await get(replyRef);
        if (replySnapshot.exists()) {
            const currentLikes = replySnapshot.val().likes || 0;
            await update(replyRef, { likes: currentLikes + 1 });
            state.likedReplies.add(replyId);
            showToast('Liked!', 'success');
        }
    } catch (error) {
        showToast('Fehler beim Liken.', 'error');
        console.error(error);
    }
};

window.openReplyToReplyModal = function(replyId) {
    if (!state.currentUser) {
        showToast('Du musst angemeldet sein, um zu antworten.', 'error');
        openModal('authModal');
        return;
    }

    state.parentReplyId = replyId;

    const quoteSection = document.getElementById('quoteSection');
    if (quoteSection) {
        // Cevabı bul ve alıntı yap
        const reply = state.allReplies.find(r => r.id === replyId);
        if (reply) {
            const truncatedContent = reply.content.length > 150
                ? reply.content.substring(0, 150) + '...'
                : reply.content;
            quoteSection.innerHTML = `
                <div class="quote-author">Antwort auf:</div>
                <div class="quote-content">${escapeHtml(truncatedContent)}</div>
            `;
        } else {
            quoteSection.innerHTML = `<div class="quote-author">Antwort auf Reply #${replyId.substring(0, 8)}</div>`;
        }
    }

    openModal('replyToReplyModal');
};

window.toggleReplyMenu = function(replyId) {
    const menu = document.getElementById('replyMenu-' + replyId);
    if (!menu) return;

    const isVisible = menu.classList.contains('active');

    // Tüm menüleri kapat
    document.querySelectorAll('.reply-menu-dropdown').forEach(m => m.classList.remove('active'));

    if (!isVisible) {
        menu.classList.add('active');
    }
};

// Menü dışına tıklayınca kapat
document.addEventListener('click', (e) => {
    if (!e.target.closest('.reply-menu')) {
        document.querySelectorAll('.reply-menu-dropdown').forEach(m => m.classList.remove('active'));
    }
});

window.editReply = async function(replyId) {
    const reply = state.allReplies.find(r => r.id === replyId);
    if (!reply) return;

    if (!state.currentUser || state.currentUser.uid !== reply.authorId) {
        showToast('Du kannst nur deine eigenen Antworten bearbeiten.', 'error');
        return;
    }

    const newContent = prompt('Antwort bearbeiten:', reply.content);
    if (newContent === null) return;

    const sanitizedContent = sanitizeInput(newContent, 5000);
    if (!sanitizedContent || sanitizedContent.length < 2) {
        showToast('Der Inhalt muss mindestens 2 Zeichen lang sein.', 'error');
        return;
    }

    try {
        await update(ref(database, 'replies/' + replyId), {
            content: sanitizedContent,
            editedAt: Date.now()
        });
        showToast('Antwort erfolgreich bearbeitet!', 'success');
    } catch (error) {
        showToast('Fehler beim Bearbeiten.', 'error');
        console.error(error);
    }
};

window.deleteReply = async function(replyId) {
    const reply = state.allReplies.find(r => r.id === replyId);
    if (!reply) return;

    if (!state.currentUser || state.currentUser.uid !== reply.authorId) {
        showToast('Du kannst nur deine eigenen Antworten löschen.', 'error');
        return;
    }

    showConfirm('Möchtest du diese Antwort wirklich löschen?', async () => {
        try {
            await remove(ref(database, 'replies/' + replyId));

            // İç içe cevapları da sil
            const nestedReplies = state.allReplies.filter(r => r.parentReplyId === replyId);
            for (const nested of nestedReplies) {
                await remove(ref(database, 'replies/' + nested.id));
            }

            // Topic replyCount güncelle
            const topicRef = ref(database, 'topics/' + state.topicId);
            const topicSnapshot = await get(topicRef);
            if (topicSnapshot.exists()) {
                const currentReplyCount = topicSnapshot.val().replyCount || 0;
                const deletedCount = 1 + nestedReplies.length;
                await update(topicRef, { replyCount: Math.max(0, currentReplyCount - deletedCount) });
            }

            showToast('Antwort erfolgreich gelöscht!', 'success');
        } catch (error) {
            showToast('Fehler beim Löschen.', 'error');
            console.error(error);
        }
    });
};

// =========================================
// ANA BAŞLATMA
// =========================================

document.addEventListener('DOMContentLoaded', () => {
    if (window.lucide) {
        window.lucide.createIcons();
    }

    // Topic ID
    const urlParams = new URLSearchParams(window.location.search);
    state.topicId = urlParams.get('id');

    if (!state.topicId) {
        document.body.innerHTML = `
            <div style="text-align: center; margin-top: 100px; color: var(--danger);">
                <h1>Fehler</h1>
                <p>Topic-ID nicht gefunden.</p>
                <a href="index.html" style="margin-top: 20px; display: inline-block;">Zurück zum Forum</a>
            </div>
        `;
        return;
    }

    // Karakter sayaçları
    setupCharCounter('replyContent', 'replyCharCounter', 5000);
    setupCharCounter('nestedReplyContent', 'nestedReplyCharCounter', 5000);

    // Auth başlat
    initAuth();

    // Cevap formlarını başlat
    initReplyForms();

    // Topic verilerini yükle
    loadTopicData();
});
