// topic.js
import { auth, database } from "./firebase-config.js";
import { 
    onAuthStateChanged, 
    signOut 
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { 
    ref, set, get, push, onValue, update 
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";

// Globale Variablen
let currentTopic = null;
let currentUser = null;
let topicId = null;
let parentReplyId = null;

// =========================================
// HILFSFUNKTIONEN
// =========================================

function showToast(message, type = 'success') {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    let icon = type === 'success' ? 'check-circle' : type === 'error' ? 'alert-circle' : 'info';
    toast.innerHTML = `<i data-lucide="${icon}"></i> <span>${message}</span>`;
    
    container.appendChild(toast);
    if (window.lucide) window.lucide.createIcons();
    
    setTimeout(() => {
        toast.classList.add('hiding');
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

window.closeModal = function(id) {
    const modal = document.getElementById(id);
    if (modal) modal.classList.remove('active');
};

function openModal(id) {
    const modal = document.getElementById(id);
    if (modal) modal.classList.add('active');
}

function getRank(points, isAdmin = false) {
    if (isAdmin) return { name: "General (Admin)", class: "admin" };
    if (points >= 501) return { name: "Major", class: "" };
    if (points >= 251) return { name: "Hauptmann", class: "" };
    if (points >= 101) return { name: "Leutnant", class: "" };
    if (points >= 21) return { name: "Unteroffizier", class: "" };
    return { name: "Rekrut", class: "" };
}

function formatDate(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleDateString('de-DE', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function getFirebaseErrorMessage(code) {
    switch(code) {
        case 'auth/invalid-credential': return 'Falsche E-Mail oder Passwort.';
        case 'auth/email-already-in-use': return 'Diese E-Mail wird bereits verwendet.';
        case 'auth/weak-password': return 'Das Passwort muss mindestens 6 Zeichen lang sein.';
        default: return 'Ein unerwarteter Fehler ist aufgetreten.';
    }
}

// =========================================
// HAUPTINITIALISIERUNG
// =========================================

document.addEventListener('DOMContentLoaded', () => {
    // EmailJS Initialisierung
    if (window.emailjs) {
        window.emailjs.init("F5cGGWMEHBUJTYWe_");
    }

    if (window.lucide) {
        window.lucide.createIcons();
    }

    // Topic ID aus URL abrufen
    const urlParams = new URLSearchParams(window.location.search);
    topicId = urlParams.get('id');

    if (!topicId) {
        document.body.innerHTML = '<p style="color: red; text-align: center; margin-top: 50px;">Fehler: Topic-ID nicht gefunden.</p>';
        return;
    }

    // Topic laden
    loadTopicData();

    // Auth State
    const loginBtn = document.getElementById('loginBtn');
    if (loginBtn) {
        loginBtn.addEventListener('click', () => {
            if (auth.currentUser) {
                signOut(auth).then(() => showToast('Erfolgreich abgemeldet!', 'success'));
            } else {
                openModal('authModal');
            }
        });
    }

    onAuthStateChanged(auth, (user) => {
        currentUser = user;
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

        // Reply Form Sichtbarkeit
        updateReplyFormVisibility();
    });

    // Modal Tabs
    const tabBtns = document.querySelectorAll('.tab-btn');
    tabBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            const tabId = e.target.getAttribute('data-tab');
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            e.target.classList.add('active');
            document.getElementById(tabId + 'Tab').classList.add('active');
        });
    });

    // =========================================
    // REPLY FORM HANDLING
    // =========================================
    const replyForm = document.getElementById('replyForm');
    if (replyForm) {
        replyForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            if (!currentUser) {
                showToast('Du musst angemeldet sein, um eine Antwort zu schreiben.', 'error');
                return;
            }

            const turnstileResponse = new FormData(replyForm).get('cf-turnstile-response');
            if (!turnstileResponse) {
                showToast('Bitte bestätige, dass du ein Mensch bist.', 'error');
                return;
            }

            const replyContent = document.getElementById('replyContent').value.trim();
            if (!replyContent) {
                showToast('Bitte gebe den Inhalt der Antwort ein.', 'error');
                return;
            }

            try {
                const repliesRef = ref(database, 'replies');
                const newReplyRef = push(repliesRef);
                await set(newReplyRef, {
                    topicId: topicId,
                    authorId: currentUser.uid,
                    content: replyContent,
                    createdAt: Date.now(),
                    likes: 0,
                    parentReplyId: null
                });

                // Topic replyCount erhöhen
                const topicRef = ref(database, 'topics/' + topicId);
                const topicSnapshot = await get(topicRef);
                if (topicSnapshot.exists()) {
                    const currentReplyCount = topicSnapshot.val().replyCount || 0;
                    await update(topicRef, { replyCount: currentReplyCount + 1 });
                }

                // User Points erhöhen (+5)
                const userRef = ref(database, 'users/' + currentUser.uid);
                const userSnapshot = await get(userRef);
                if (userSnapshot.exists()) {
                    const currentPoints = userSnapshot.val().points || 0;
                    await update(userRef, { points: currentPoints + 5 });
                }

                replyForm.reset();
                if (window.turnstile) window.turnstile.reset();
                showToast('Antwort erfolgreich erstellt!', 'success');

            } catch (error) {
                showToast('Fehler beim Erstellen der Antwort.', 'error');
                console.error(error);
            }
        });
    }

    // Reply to Reply Modal - EKSIK KISim TAMAMLANDI
    const replyToReplyForm = document.getElementById('replyToReplyForm');
    if (replyToReplyForm) {
        replyToReplyForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            if (!currentUser) {
                showToast('Du musst angemeldet sein.', 'error');
                return;
            }

            const turnstileResponse = new FormData(replyToReplyForm).get('cf-turnstile-response');
            if (!turnstileResponse) {
                showToast('Bitte bestätige, dass du ein Mensch bist.', 'error');
                return;
            }

            const nestedReplyContent = document.getElementById('nestedReplyContent').value.trim();
            if (!nestedReplyContent) {
                showToast('Bitte gebe den Inhalt der Antwort ein.', 'error');
                return;
            }

            try {
                const repliesRef = ref(database, 'replies');
                const newReplyRef = push(repliesRef);
                await set(newReplyRef, {
                    topicId: topicId,
                    authorId: currentUser.uid,
                    content: nestedReplyContent,
                    createdAt: Date.now(),
                    likes: 0,
                    parentReplyId: parentReplyId
                });

                // User Points erhöhen (+5)
                const userRef = ref(database, 'users/' + currentUser.uid);
                const userSnapshot = await get(userRef);
                if (userSnapshot.exists()) {
                    const currentPoints = userSnapshot.val().points || 0;
                    await update(userRef, { points: currentPoints + 5 });
                }

                window.closeModal('replyToReplyModal');
                replyToReplyForm.reset();
                if (window.turnstile) window.turnstile.reset();
                showToast('Antwort erfolgreich erstellt!', 'success');
                parentReplyId = null;

            } catch (error) {
                showToast('Fehler beim Erstellen der Antwort.', 'error');
                console.error(error);
            }
        });
    }
});

function updateReplyFormVisibility() {
    const replyFormWrapper = document.getElementById('replyFormWrapper');
    const authPromptReply = document.getElementById('authPromptReply');

    if (!replyFormWrapper) return;

    if (currentUser) {
        replyFormWrapper.querySelector('form').style.display = 'block';
        authPromptReply.style.display = 'none';
    } else {
        replyFormWrapper.querySelector('form').style.display = 'none';
        authPromptReply.style.display = 'block';

        const loginPromptReply = document.getElementById('loginPromptReply');
        if (loginPromptReply) {
            loginPromptReply.addEventListener('click', () => openModal('authModal'));
        }
    }
}

// =========================================
// TOPIC DATEN LADEN
// =========================================

async function loadTopicData() {
    try {
        const topicRef = ref(database, 'topics/' + topicId);
        const topicSnapshot = await get(topicRef);

        if (!topicSnapshot.exists()) {
            document.body.innerHTML = '<p style="color: red; text-align: center; margin-top: 50px;">Topic nicht gefunden.</p>';
            return;
        }

        currentTopic = { id: topicId, ...topicSnapshot.val() };

        // Topic Views erhöhen
        await update(topicRef, { views: (currentTopic.views || 0) + 1 });
        currentTopic.views = (currentTopic.views || 0) + 1;

        // Topic Daten rendern
        renderTopicData();

        // Replies laden
        loadReplies();

    } catch (error) {
        console.error('Fehler beim Laden des Topics:', error);
    }
}

async function renderTopicData() {
    // Author daten
    const authorSnapshot = await get(ref(database, 'users/' + currentTopic.authorId));
    const author = authorSnapshot.val() || { username: 'Unbekannt', avatar: '', points: 0, isAdmin: false };
    const rank = getRank(author.points, author.isAdmin);

    // Breadcrumb & Title
    document.getElementById('topicCategory').textContent = currentTopic.category;
    document.getElementById('topicTitle').textContent = currentTopic.title;

    // Author Info
    document.getElementById('authorAvatar').src = author.avatar;
    document.getElementById('authorUsername').textContent = author.username;
    document.getElementById('authorRank').textContent = rank.name;
    document.getElementById('authorCreatedDate').textContent = formatDate(currentTopic.createdAt);
    document.getElementById('authorPoints').textContent = `${author.points} Punkte`;

    // Stats
    document.getElementById('replyCount').textContent = `${currentTopic.replyCount || 0} Antworten`;
    document.getElementById('viewCount').textContent = `${currentTopic.views} Ansichten`;

    // Content
    document.getElementById('topicDescription').textContent = currentTopic.description;

    // Tags
    if (currentTopic.tags && currentTopic.tags.length > 0) {
        const tagsContainer = document.getElementById('topicTagsContainer');
        tagsContainer.innerHTML = currentTopic.tags.map(tag => 
            `<span class="tag-badge">${tag}</span>`
        ).join('');
    }

    if (window.lucide) {
        window.lucide.createIcons();
    }
}

// =========================================
// REPLIES LADEN & RENDERN
// =========================================

function loadReplies() {
    const repliesRef = ref(database, 'replies');
    onValue(repliesRef, async (snapshot) => {
        const repliesContainer = document.getElementById('repliesContainer');
        repliesContainer.innerHTML = '';

        if (!snapshot.exists()) {
            repliesContainer.innerHTML = '<p style="color: var(--text-muted); text-align: center; padding: 20px;">Noch keine Antworten.</p>';
            return;
        }

        const allReplies = [];
        snapshot.forEach(childSnapshot => {
            allReplies.push({ id: childSnapshot.key, ...childSnapshot.val() });
        });

        // Nur Replies für diese Topic laden
        const topicReplies = allReplies.filter(r => r.topicId === topicId && !r.parentReplyId);

        if (topicReplies.length === 0) {
            repliesContainer.innerHTML = '<p style="color: var(--text-muted); text-align: center; padding: 20px;">Noch keine Antworten.</p>';
            return;
        }

        // Sortierung (neueste zuerst)
        topicReplies.sort((a, b) => b.createdAt - a.createdAt);

        for (const reply of topicReplies) {
            const replyElement = await createReplyElement(reply, allReplies);
            repliesContainer.appendChild(replyElement);
        }

        if (window.lucide) {
            window.lucide.createIcons();
        }
    });
}

async function createReplyElement(reply, allReplies) {
    const authorSnapshot = await get(ref(database, 'users/' + reply.authorId));
    const author = authorSnapshot.val() || { username: 'Unbekannt', avatar: '', points: 0, isAdmin: false };
    const rank = getRank(author.points, author.isAdmin);

    const replyDiv = document.createElement('div');
    replyDiv.className = 'reply-card';
    replyDiv.innerHTML = `
        <div class="reply-header">
            <div class="reply-author">
                <img src="${author.avatar}" alt="${author.username}" class="reply-avatar">
                <div>
                    <strong>${author.username}</strong>
                    <span class="rank-badge ${rank.class}">${rank.name}</span>
                    <div class="reply-meta" style="font-size: 0.8rem; color: var(--text-muted);">
                        ${formatDate(reply.createdAt)}
                    </div>
                </div>
            </div>
        </div>
        <div class="reply-content">${reply.content}</div>
        <div class="reply-actions">
            <button class="btn-action" onclick="likeReply('${reply.id}')">
                <i data-lucide="heart"></i>
                <span>${reply.likes || 0}</span>
            </button>
            <button class="btn-action" onclick="openReplyToReplyModal('${reply.id}')">
                <i data-lucide="reply"></i>
                <span>Antworten</span>
            </button>
        </div>
    `;

    // Nested Replies laden
    const nestedReplies = allReplies.filter(r => r.parentReplyId === reply.id);
    if (nestedReplies.length > 0) {
        nestedReplies.sort((a, b) => a.createdAt - b.createdAt);
        const nestedContainer = document.createElement('div');
        nestedContainer.className = 'nested-replies';

        for (const nestedReply of nestedReplies) {
            const nestedElement = await createReplyElement(nestedReply, allReplies);
            nestedContainer.appendChild(nestedElement);
        }

        replyDiv.appendChild(nestedContainer);
    }

    return replyDiv;
}

window.likeReply = async function(replyId) {
    if (!currentUser) {
        showToast('Du musst angemeldet sein, um zu liken.', 'error');
        return;
    }

    try {
        const replyRef = ref(database, 'replies/' + replyId);
        const replySnapshot = await get(replyRef);
        if (replySnapshot.exists()) {
            const currentLikes = replySnapshot.val().likes || 0;
            await update(replyRef, { likes: currentLikes + 1 });
            showToast('Liked!', 'success');
        }
    } catch (error) {
        showToast('Fehler beim Liken.', 'error');
    }
};

window.openReplyToReplyModal = function(replyId) {
    if (!currentUser) {
        showToast('Du musst angemeldet sein, um zu antworten.', 'error');
        return;
    }

    parentReplyId = replyId;
    
    // Quote anzeigen (optional: Author-Name abrufen und anzeigen)
    const quoteSection = document.getElementById('quoteSection');
    quoteSection.innerHTML = `<p><strong>Antwort auf Reply #${replyId.substring(0, 6)}</strong></p>`;
    
    openModal('replyToReplyModal');
};
