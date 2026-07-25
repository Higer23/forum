// app.js
import { auth, database } from "./firebase-config.js";
import { 
    createUserWithEmailAndPassword, 
    signInWithEmailAndPassword, 
    onAuthStateChanged, 
    signOut 
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { 
    ref, set, get, push, onValue, update 
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";

// Globaler Status für die Registrierung
let tempRegistrationData = null;
let currentOTP = null;
let otpTimerInterval = null;

// =========================================
// HILFSFUNKTIONEN (TOAST, MODALS, RÄNGE)
// =========================================

export function showToast(message, type = 'success') {
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

export function getRank(points, isAdmin = false) {
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

// =========================================
// OTP TIMER - EKSIK FONKSİYON EKLENDI
// =========================================
function startOtpTimer() {
    clearInterval(otpTimerInterval);
    let timeLeft = 300;
    const timerElement = document.getElementById('otpTimer');
    
    otpTimerInterval = setInterval(() => {
        timeLeft--;
        if (timerElement) timerElement.textContent = timeLeft;
        
        if (timeLeft <= 0) {
            clearInterval(otpTimerInterval);
            showToast('Code verfallen. Bitte versuchen Sie es erneut.', 'error');
            window.closeModal('otpModal');
        }
    }, 1000);
}

// =========================================
// HAUPT-INITIALISIERUNG
// =========================================

document.addEventListener('DOMContentLoaded', () => {
    // EmailJS Initialisierung
    if (window.emailjs) {
        window.emailjs.init("F5cGGWMEHBUJTYWe_");
    }

    if (window.lucide) {
        window.lucide.createIcons();
    }

    // Navbar Buttons & Auth State
    const loginBtn = document.getElementById('loginBtn');
    const newTopicBtn = document.getElementById('newTopicBtn');
    const authModal = document.getElementById('authModal');
    
    if (loginBtn) {
        loginBtn.addEventListener('click', () => {
            if (auth.currentUser) {
                signOut(auth).then(() => showToast('Erfolgreich abgemeldet!', 'success'));
            } else {
                openModal('authModal');
            }
        });
    }

    if (newTopicBtn) {
        newTopicBtn.addEventListener('click', () => {
            if (!auth.currentUser) {
                showToast('Du musst angemeldet sein, um ein Thema zu erstellen.', 'error');
                openModal('authModal');
                return;
            }
            openModal('newTopicModal');
        });
    }

    onAuthStateChanged(auth, async (user) => {
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
    });

    // Modal Tabs Logic
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
    // LOGIN - EKSIK FONKSİYON EKLENDI
    // =========================================
    const loginForm = document.getElementById('loginForm');
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const email = document.getElementById('loginEmail').value.trim();
            const password = document.getElementById('loginPassword').value;

            try {
                await signInWithEmailAndPassword(auth, email, password);
                window.closeModal('authModal');
                showToast('Erfolgreich angemeldet!', 'success');
                loginForm.reset();
            } catch (error) {
                showToast('Anmeldung fehlgeschlagen: ' + error.message, 'error');
                console.error(error);
            }
        });
    }

    // =========================================
    // REGISTRIERUNG & OTP
    // =========================================
    const registerForm = document.getElementById('registerForm');
    if (registerForm) {
        registerForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const turnstileResponse = new FormData(registerForm).get('cf-turnstile-response');
            if (!turnstileResponse) {
                showToast('Bitte bestätige, dass du ein Mensch bist.', 'error');
                return;
            }

            const username = document.getElementById('registerUsername').value.trim();
            const email = document.getElementById('registerEmail').value.trim();
            const password = document.getElementById('registerPassword').value;
            const passwordConfirm = document.getElementById('registerPasswordConfirm').value;

            if (password !== passwordConfirm) {
                showToast('Die Passwörter stimmen nicht überein.', 'error');
                return;
            }

            if (password.length < 6) {
                showToast('Das Passwort muss mindestens 6 Zeichen lang sein.', 'error');
                return;
            }

            // Generate OTP
            currentOTP = Math.floor(100000 + Math.random() * 900000).toString();
            tempRegistrationData = { username, email, password };

            try {
                await window.emailjs.send("service_rs96mwp", "template_uvj39wr", {
                    passcode: currentOTP,
                    time: "5 Minuten",
                    to_email: email
                });

                window.closeModal('authModal');
                openModal('otpModal');
                startOtpTimer();
                showToast('Bestätigungscode wurde gesendet!', 'success');
            } catch (error) {
                showToast('Fehler beim Senden der E-Mail.', 'error');
                console.error(error);
            }
        });
    }

    // OTP Inputs Logic
    const otpInputs = document.querySelectorAll('.otp-input');
    otpInputs.forEach((input, index) => {
        input.addEventListener('input', (e) => {
            if (e.target.value.length > 0 && index < otpInputs.length - 1) {
                otpInputs[index + 1].focus();
            }
        });
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Backspace' && e.target.value === '' && index > 0) {
                otpInputs[index - 1].focus();
            }
        });
    });

    const otpForm = document.getElementById('otpForm');
    if (otpForm) {
        otpForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            let enteredOTP = Array.from(otpInputs).map(input => input.value).join('');
            if (enteredOTP !== currentOTP) {
                showToast('Der eingegebene Code ist falsch.', 'error');
                return;
            }

            try {
                const userCredential = await createUserWithEmailAndPassword(auth, tempRegistrationData.email, tempRegistrationData.password);
                const user = userCredential.user;

                await set(ref(database, 'users/' + user.uid), {
                    username: tempRegistrationData.username,
                    email: tempRegistrationData.email,
                    points: 0,
                    isAdmin: false,
                    avatar: `https://api.dicebear.com/10.x/notionists-neutral/svg?seed=${user.uid}`,
                    createdAt: Date.now()
                });

                window.closeModal('otpModal');
                clearInterval(otpTimerInterval);
                showToast('Registrierung erfolgreich! Willkommen!', 'success');
                otpForm.reset();
                if (window.turnstile) window.turnstile.reset();

            } catch (error) {
                showToast('Fehler bei der Registrierung: ' + error.message, 'error');
                console.error(error);
            }
        });
    }

    // =========================================
    // NEUES THEMA ERSTELLEN
    // =========================================
    const newTopicForm = document.getElementById('newTopicForm');
    if (newTopicForm) {
        newTopicForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const turnstileResponse = new FormData(newTopicForm).get('cf-turnstile-response');
            if (!turnstileResponse) {
                showToast('Bitte bestätige, dass du ein Mensch bist.', 'error');
                return;
            }

            const category = document.getElementById('topicCategory').value;
            const title = document.getElementById('topicTitle').value;
            const description = document.getElementById('topicDescription').value;
            const tagsInput = document.getElementById('topicTags').value;
            const tags = tagsInput.split(',').map(tag => tag.trim()).filter(tag => tag !== '');

            if (!category || !title.trim()) {
                showToast('Kategorie und Titel sind erforderlich.', 'error');
                return;
            }

            const uid = auth.currentUser.uid;
            
            try {
                // Neues Thema in DB eintragen
                const topicRef = push(ref(database, 'topics'));
                await set(topicRef, {
                    title,
                    description,
                    category,
                    tags,
                    authorId: uid,
                    createdAt: Date.now(),
                    views: 0,
                    replyCount: 0
                });

                // Punkte aktualisieren (+10)
                const userRef = ref(database, 'users/' + uid);
                const userSnapshot = await get(userRef);
                if (userSnapshot.exists()) {
                    const currentPoints = userSnapshot.val().points || 0;
                    await update(userRef, { points: currentPoints + 10 });
                }

                window.closeModal('newTopicModal');
                showToast('Thema erfolgreich erstellt!', 'success');
                newTopicForm.reset();
                if (window.turnstile) window.turnstile.reset();

            } catch (error) {
                showToast('Fehler beim Erstellen des Themas.', 'error');
                console.error(error);
            }
        });

        // Themen aus der Datenbank laden
        loadTopics();

        // =========================================
        // KATEGORIEN FILTER
        // =========================================
        const categoryItems = document.querySelectorAll('.category-item');
        categoryItems.forEach(item => {
            item.addEventListener('click', () => {
                // Entferne active von allen
                categoryItems.forEach(i => i.classList.remove('active'));
                // Füge active zur geklickten hinzu
                item.classList.add('active');
                
                const selectedCategory = item.getAttribute('data-category');
                filterTopicsByCategory(selectedCategory);
            });
        });

        // =========================================
        // SEARCH FUNKTION
        // =========================================
        const searchInput = document.getElementById('searchInput');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                const searchTerm = e.target.value.toLowerCase();
                filterTopicsBySearch(searchTerm);
            });
        }

        // =========================================
        // SORT FUNKTION
        // =========================================
        const sortSelect = document.getElementById('sortSelect');
        if (sortSelect) {
            sortSelect.addEventListener('change', (e) => {
                const sortMethod = e.target.value;
                sortTopics(sortMethod);
            });
        }
    }
});

// Globale Topics Variable für Filtering
let allTopics = [];
let currentFilter = { category: 'all', search: '', sort: 'newest' };

function loadTopics() {
    const topicsList = document.getElementById('topicsList');
    const topicCount = document.getElementById('topicCount');
    if (!topicsList) return;

    onValue(ref(database, 'topics'), async (snapshot) => {
        topicsList.innerHTML = '';
        if (!snapshot.exists()) {
            topicsList.innerHTML = '<p style="color: var(--text-muted); text-align: center; padding: 20px;">Noch keine Themen vorhanden.</p>';
            if (topicCount) topicCount.innerText = '0 Themen';
            return;
        }

        allTopics = [];
        snapshot.forEach(childSnapshot => {
            allTopics.push({ id: childSnapshot.key, ...childSnapshot.val() });
        });

        // Initial render mit default filter
        renderFilteredTopics();
    });
}

async function renderFilteredTopics() {
    const topicsList = document.getElementById('topicsList');
    const topicCount = document.getElementById('topicCount');
    if (!topicsList) return;

    let filteredTopics = [...allTopics];

    // KATEGORIE FILTER
    if (currentFilter.category !== 'all') {
        filteredTopics = filteredTopics.filter(t => t.category === currentFilter.category);
    }

    // SEARCH FILTER
    if (currentFilter.search) {
        const search = currentFilter.search.toLowerCase();
        filteredTopics = filteredTopics.filter(t =>
            t.title.toLowerCase().includes(search) ||
            t.description.toLowerCase().includes(search) ||
            (t.tags && t.tags.some(tag => tag.toLowerCase().includes(search)))
        );
    }

    // SORTIERUNG
    if (currentFilter.sort === 'newest') {
        filteredTopics.sort((a, b) => b.createdAt - a.createdAt);
    } else if (currentFilter.sort === 'popular') {
        filteredTopics.sort((a, b) => (b.views || 0) - (a.views || 0));
    } else if (currentFilter.sort === 'active') {
        filteredTopics.sort((a, b) => (b.replyCount || 0) - (a.replyCount || 0));
    }

    topicsList.innerHTML = '';

    if (filteredTopics.length === 0) {
        topicsList.innerHTML = '<p style="color: var(--text-muted); text-align: center; padding: 20px;">Keine Themen gefunden.</p>';
        if (topicCount) topicCount.innerText = '0 Themen';
        return;
    }

    if (topicCount) topicCount.innerText = `${filteredTopics.length} Themen`;

    for (const topic of filteredTopics) {
        // Autor Daten abrufen
        const userSnapshot = await get(ref(database, 'users/' + topic.authorId));
        const author = userSnapshot.val() || { username: 'Unbekannt', avatar: '', points: 0, isAdmin: false };
        const rank = getRank(author.points, author.isAdmin);

        const card = document.createElement('a');
        card.href = `topic.html?id=${topic.id}`;
        card.className = 'topic-card';
        card.innerHTML = `
            <img src="${author.avatar}" alt="${author.username}" class="topic-card-avatar">
            <div class="topic-card-main">
                <span class="topic-card-title">${topic.title}</span>
                <div class="topic-card-meta">
                    <span>${author.username}</span>
                    <span class="rank-badge ${rank.class}">${rank.name}</span>
                    <span>•</span>
                    <span>${formatDate(topic.createdAt)}</span>
                    <span>•</span>
                    <span style="color: var(--accent);">${topic.category}</span>
                </div>
            </div>
            <div class="topic-card-stats">
                <div>
                    <strong>${topic.replyCount || 0}</strong>
                    <span>Antworten</span>
                </div>
                <div>
                    <strong>${topic.views || 0}</strong>
                    <span>Ansichten</span>
                </div>
            </div>
        `;
        topicsList.appendChild(card);
    }
}

function filterTopicsByCategory(category) {
    currentFilter.category = category;
    renderFilteredTopics();
}

function filterTopicsBySearch(searchTerm) {
    currentFilter.search = searchTerm;
    renderFilteredTopics();
}

function sortTopics(sortMethod) {
    currentFilter.sort = sortMethod;
    renderFilteredTopics();
}
