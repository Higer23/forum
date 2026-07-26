/**
 * Higum Forum - Main Application
 * Enterprise Grade Forum Platform
 * Version: 2.0.0
 */

import { auth, database } from "./firebase-config.js";
import { 
    createUserWithEmailAndPassword, 
    signInWithEmailAndPassword, 
    onAuthStateChanged, 
    signOut,
    signInWithPopup,
    GoogleAuthProvider,
    sendEmailVerification,
    reload
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { 
    ref, set, get, push, onValue, update, query, orderByChild, limitToLast 
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";

// =========================================
// CONFIGURATION
// =========================================
const CONFIG = {
    TURNSTILE_SITEKEY: "0x4AAAAAAD80pv0OMAdNnE2Q",
    RESEND_COOLDOWN_SECONDS: 60,
    TOPICS_PER_PAGE: 10,
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
// STATE MANAGEMENT
// =========================================
const state = {
    pendingVerificationUser: null,
    resendCooldownInterval: null,
    allTopics: [],
    currentFilter: { category: 'all', search: '', sort: 'newest', tag: null },
    currentPage: 1,
    likedReplies: new Set(), // Track liked replies in session
    isOnline: navigator.onLine
};

// =========================================
// UTILITY FUNCTIONS
// =========================================

/**
 * Escape HTML to prevent XSS attacks
 */
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Sanitize user input
 */
function sanitizeInput(text, maxLength = 5000) {
    if (!text) return '';
    return text.trim().substring(0, maxLength);
}

/**
 * Validate email format
 */
function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * Validate username format
 */
function isValidUsername(username) {
    return /^[a-zA-Z0-9_]{3,30}$/.test(username);
}

/**
 * Debounce function for search input
 */
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

/**
 * Show toast notification
 */
export function showToast(message, type = 'success') {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.setAttribute('role', 'alert');
    
    const icons = {
        success: 'check-circle',
        error: 'alert-circle',
        warning: 'alert-triangle',
        info: 'info'
    };
    
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

/**
 * Close modal with cleanup
 */
window.closeModal = function(id) {
    const modal = document.getElementById(id);
    if (!modal) return;
    
    modal.classList.remove('active');
    
    // Clear resend cooldown interval if closing verification modal
    if (id === 'otpModal' && state.resendCooldownInterval) {
        clearInterval(state.resendCooldownInterval);
        state.resendCooldownInterval = null;
    }
    
    // Reset turnstile if present
    const turnstile = modal.querySelector('.cf-turnstile');
    if (turnstile && window.turnstile) {
        window.turnstile.reset(turnstile);
    }
};

function openModal(id) {
    const modal = document.getElementById(id);
    if (modal) modal.classList.add('active');
}

/**
 * Show/hide loading state on button
 */
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

/**
 * Get user rank based on points
 */
export function getRank(points, isAdmin = false) {
    if (isAdmin) return { name: "General (Admin)", class: "admin" };
    
    for (let i = CONFIG.RANKS.length - 1; i >= 0; i--) {
        if (points >= CONFIG.RANKS[i].threshold) {
            return CONFIG.RANKS[i];
        }
    }
    return CONFIG.RANKS[0];
}

/**
 * Format timestamp to German locale
 */
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

/**
 * Get category display name
 */
function getCategoryLabel(category) {
    const labels = {
        general: 'Allgemein',
        announcements: 'Ankündigungen',
        help: 'Hilfe & Support',
        feedback: 'Feedback'
    };
    return labels[category] || category;
}

/**
 * Show confirmation dialog
 */
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

// =========================================
// RESEND COOLDOWN TIMER (for verification email)
// =========================================
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
// PAGINATION
// =========================================
function renderPagination(totalItems, currentPage, itemsPerPage) {
    const container = document.getElementById('pagination');
    if (!container) return;
    
    const totalPages = Math.ceil(totalItems / itemsPerPage);
    
    if (totalPages <= 1) {
        container.innerHTML = '';
        return;
    }
    
    let html = '';
    
    // Previous button
    html += `<button class="pagination-btn" ${currentPage === 1 ? 'disabled' : ''} onclick="changePage(${currentPage - 1})" aria-label="Vorherige Seite">
        <i data-lucide="chevron-left"></i>
    </button>`;
    
    // Page numbers
    const maxVisible = 5;
    let startPage = Math.max(1, currentPage - Math.floor(maxVisible / 2));
    let endPage = Math.min(totalPages, startPage + maxVisible - 1);
    
    if (endPage - startPage < maxVisible - 1) {
        startPage = Math.max(1, endPage - maxVisible + 1);
    }
    
    if (startPage > 1) {
        html += `<button class="pagination-btn" onclick="changePage(1)">1</button>`;
        if (startPage > 2) html += `<span class="pagination-ellipsis">...</span>`;
    }
    
    for (let i = startPage; i <= endPage; i++) {
        html += `<button class="pagination-btn ${i === currentPage ? 'active' : ''}" onclick="changePage(${i})">${i}</button>`;
    }
    
    if (endPage < totalPages) {
        if (endPage < totalPages - 1) html += `<span class="pagination-ellipsis">...</span>`;
        html += `<button class="pagination-btn" onclick="changePage(${totalPages})">${totalPages}</button>`;
    }
    
    // Next button
    html += `<button class="pagination-btn" ${currentPage === totalPages ? 'disabled' : ''} onclick="changePage(${currentPage + 1})" aria-label="Nächste Seite">
        <i data-lucide="chevron-right"></i>
    </button>`;
    
    container.innerHTML = html;
    if (window.lucide) window.lucide.createIcons();
}

window.changePage = function(page) {
    state.currentPage = page;
    renderFilteredTopics();
    document.querySelector('.topics-content')?.scrollIntoView({ behavior: 'smooth' });
};

// =========================================
// TAGS
// =========================================
async function loadPopularTags() {
    const tagsList = document.getElementById('tagsList');
    if (!tagsList) return;
    
    try {
        const snapshot = await get(ref(database, 'topics'));
        if (!snapshot.exists()) {
            tagsList.innerHTML = '<span class="tag-badge">Keine Tags</span>';
            return;
        }
        
        const tagCounts = {};
        snapshot.forEach(child => {
            const topic = child.val();
            if (topic.tags && Array.isArray(topic.tags)) {
                topic.tags.forEach(tag => {
                    const normalized = tag.trim().toLowerCase();
                    if (normalized) {
                        tagCounts[normalized] = (tagCounts[normalized] || 0) + 1;
                    }
                });
            }
        });
        
        const sortedTags = Object.entries(tagCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 15);
        
        if (sortedTags.length === 0) {
            tagsList.innerHTML = '<span class="tag-badge">Keine Tags</span>';
            return;
        }
        
        tagsList.innerHTML = sortedTags.map(([tag, count]) => 
            `<span class="tag-badge ${state.currentFilter.tag === tag ? 'active' : ''}" 
                   onclick="filterByTag('${escapeHtml(tag)}')" 
                   role="button" tabindex="0">${escapeHtml(tag)} (${count})</span>`
        ).join('');
        
    } catch (error) {
        console.error('Error loading tags:', error);
        tagsList.innerHTML = '<span class="tag-badge">Fehler beim Laden</span>';
    }
}

window.filterByTag = function(tag) {
    state.currentFilter.tag = state.currentFilter.tag === tag ? null : tag;
    state.currentPage = 1;
    renderFilteredTopics();
    loadPopularTags(); // Refresh to update active state
};

// =========================================
// MAIN INITIALIZATION
// =========================================

document.addEventListener('DOMContentLoaded', () => {
    if (window.lucide) {
        window.lucide.createIcons();
    }

    // Setup character counters
    setupCharCounter('topicDescription', 'descCharCounter', 5000);

    // Navbar Buttons & Auth State
    const loginBtn = document.getElementById('loginBtn');
    const newTopicBtn = document.getElementById('newTopicBtn');
    
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
            document.querySelectorAll('.tab-btn').forEach(b => {
                b.classList.remove('active');
                b.setAttribute('aria-selected', 'false');
            });
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            e.target.classList.add('active');
            e.target.setAttribute('aria-selected', 'true');
            document.getElementById(tabId + 'Tab').classList.add('active');
        });
    });

    // Escape key to close modals
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            document.querySelectorAll('.modal.active').forEach(modal => {
                window.closeModal(modal.id);
            });
        }
    });

    // =========================================
    // LOGIN
    // =========================================
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

    // =========================================
    // GOOGLE LOGIN
    // =========================================
    const googleLoginBtn = document.getElementById('googleLoginBtn');
    googleLoginBtn?.addEventListener('click', async () => {
        if (googleLoginBtn.disabled) return;
        const provider = new GoogleAuthProvider();
        const originalHtml = googleLoginBtn.innerHTML;
        googleLoginBtn.disabled = true;
        googleLoginBtn.innerHTML = '<span class="spinner"></span> <span class="btn-text">Bitte warten...</span>';

        try {
            const result = await signInWithPopup(auth, provider);
            const user = result.user;

            // Kullanıcı ilk kez giriş yapıyorsa users/ altında kayıt oluştur
            const userRef = ref(database, 'users/' + user.uid);
            const userSnapshot = await get(userRef);

            if (!userSnapshot.exists()) {
                await set(userRef, {
                    username: user.displayName || user.email.split('@')[0],
                    email: user.email,
                    points: 0,
                    isAdmin: false,
                    avatar: user.photoURL || `https://api.dicebear.com/10.x/notionists-neutral/svg?seed=${user.uid}`,
                    createdAt: Date.now(),
                    emailVerified: true
                });
            }

            window.closeModal('authModal');
            showToast('Erfolgreich mit Google angemeldet!', 'success');

        } catch (error) {
            console.error('Google giriş hatası:', error.code, error.message);
            if (error.code !== 'auth/popup-closed-by-user' && error.code !== 'auth/cancelled-popup-request') {
                showToast(getFirebaseErrorMessage(error.code), 'error');
            }
        } finally {
            googleLoginBtn.disabled = false;
            googleLoginBtn.innerHTML = originalHtml;
        }
    });

    // =========================================
    // REGISTRATION & OTP
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

            // Check if email already exists
            setButtonLoading('registerSubmitBtn', true);

            try {
                // Check existing users by email
                let usersSnapshot;
                try {
                    usersSnapshot = await get(ref(database, 'users'));
                } catch (dbError) {
                    console.error('Datenbankfehler:', dbError);
                    showToast('Datenbankverbindung fehlgeschlagen. Bitte databaseURL / Firebase-Regeln prüfen.', 'error');
                    setButtonLoading('registerSubmitBtn', false);
                    return;
                }

                let emailExists = false;
                usersSnapshot.forEach(child => {
                    if (child.val().email === email) emailExists = true;
                });
                
                if (emailExists) {
                    showToast('Diese E-Mail wird bereits verwendet.', 'error');
                    setButtonLoading('registerSubmitBtn', false);
                    return;
                }

                // Create the Firebase Auth account directly
                const userCredential = await createUserWithEmailAndPassword(auth, email, password);
                const user = userCredential.user;

                // Save user profile in Realtime Database
                await set(ref(database, 'users/' + user.uid), {
                    username,
                    email,
                    points: 0,
                    isAdmin: false,
                    avatar: `https://api.dicebear.com/10.x/notionists-neutral/svg?seed=${user.uid}`,
                    createdAt: Date.now()
                });

                // Send Firebase's own verification email
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

    // =========================================
    // EMAIL VERIFICATION MODAL HELPERS
    // =========================================
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
        });
    }

    // =========================================
    // NEW TOPIC CREATION
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
            const title = sanitizeInput(document.getElementById('topicTitle').value, 200);
            const description = sanitizeInput(document.getElementById('topicDescription').value, 5000);
            const tagsInput = sanitizeInput(document.getElementById('topicTags').value, 100);
            const tags = tagsInput.split(',').map(tag => tag.trim().toLowerCase()).filter(tag => tag !== '');

            if (!category) {
                showToast('Bitte wähle eine Kategorie.', 'error');
                return;
            }

            if (title.length < 5) {
                showToast('Der Titel muss mindestens 5 Zeichen lang sein.', 'error');
                return;
            }

            const uid = auth.currentUser?.uid;
            if (!uid) {
                showToast('Du musst angemeldet sein.', 'error');
                return;
            }

            setButtonLoading('topicSubmitBtn', true);

            try {
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

                // Update user points (+10)
                const userRef = ref(database, 'users/' + uid);
                const userSnapshot = await get(userRef);
                if (userSnapshot.exists()) {
                    const currentPoints = userSnapshot.val().points || 0;
                    await update(userRef, { points: currentPoints + 10 });
                }

                window.closeModal('newTopicModal');
                showToast('Thema erfolgreich erstellt!', 'success');
                newTopicForm.reset();
                document.getElementById('descCharCounter').textContent = '0 / 5000';
                if (window.turnstile) window.turnstile.reset();

            } catch (error) {
                showToast('Fehler beim Erstellen des Themas.', 'error');
                console.error(error);
            } finally {
                setButtonLoading('topicSubmitBtn', false);
            }
        });
    }

    // =========================================
    // LOAD TOPICS (moved to top level)
    // =========================================
    loadTopics();
    loadPopularTags();

    // =========================================
    // CATEGORY FILTER
    // =========================================
    const categoryItems = document.querySelectorAll('.category-item');
    categoryItems.forEach(item => {
        item.addEventListener('click', () => {
            categoryItems.forEach(i => i.classList.remove('active'));
            item.classList.add('active');
            
            const selectedCategory = item.getAttribute('data-category');
            state.currentFilter.category = selectedCategory;
            state.currentPage = 1;
            renderFilteredTopics();
        });
        
        item.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                item.click();
            }
        });
    });

    // =========================================
    // SEARCH (with debounce)
    // =========================================
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        const debouncedSearch = debounce((value) => {
            state.currentFilter.search = value.toLowerCase();
            state.currentPage = 1;
            renderFilteredTopics();
        }, 300);
        
        searchInput.addEventListener('input', (e) => {
            debouncedSearch(e.target.value);
        });
    }

    // =========================================
    // SORT
    // =========================================
    const sortSelect = document.getElementById('sortSelect');
    if (sortSelect) {
        sortSelect.addEventListener('change', (e) => {
            state.currentFilter.sort = e.target.value;
            renderFilteredTopics();
        });
    }
});

// =========================================
// CHARACTER COUNTER
// =========================================
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

// =========================================
// FIREBASE ERROR MESSAGES
// =========================================
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
        'auth/network-request-failed': 'Netzwerkfehler. Bitte prüfe deine Verbindung.',
        'auth/popup-blocked': 'Popup wurde vom Browser blockiert. Bitte Popups erlauben.',
        'auth/popup-closed-by-user': 'Anmeldefenster wurde geschlossen.',
        'auth/cancelled-popup-request': 'Anmeldung wurde abgebrochen.',
        'auth/unauthorized-domain': 'Diese Domain ist nicht für Google-Anmeldung autorisiert. Bitte in der Firebase Console unter Authentication > Settings > Authorized domains hinzufügen.',
        'auth/account-exists-with-different-credential': 'Diese E-Mail ist bereits mit einer anderen Anmeldemethode verknüpft.'
    };
    return messages[code] || ('Unbekannter Fehler (' + (code || 'kein Code') + ').');
}

// =========================================
// TOPIC LOADING & RENDERING
// =========================================

function loadTopics() {
    const topicsList = document.getElementById('topicsList');
    if (!topicsList) return;

    onValue(ref(database, 'topics'), async (snapshot) => {
        if (!snapshot.exists()) {
            topicsList.innerHTML = `
                <div class="empty-state">
                    <i data-lucide="inbox" class="empty-state-icon"></i>
                    <h3>Noch keine Themen</h3>
                    <p>Sei der Erste und erstelle ein neues Thema!</p>
                </div>
            `;
            if (window.lucide) window.lucide.createIcons();
            document.getElementById('topicCount').innerText = '0 Themen';
            return;
        }

        state.allTopics = [];
        snapshot.forEach(childSnapshot => {
            state.allTopics.push({ id: childSnapshot.key, ...childSnapshot.val() });
        });

        renderFilteredTopics();
    });
}

async function renderFilteredTopics() {
    const topicsList = document.getElementById('topicsList');
    const topicCount = document.getElementById('topicCount');
    if (!topicsList) return;

    let filteredTopics = [...state.allTopics];

    // Category filter
    if (state.currentFilter.category !== 'all') {
        filteredTopics = filteredTopics.filter(t => t.category === state.currentFilter.category);
    }

    // Tag filter
    if (state.currentFilter.tag) {
        filteredTopics = filteredTopics.filter(t => 
            t.tags && t.tags.some(tag => tag.toLowerCase() === state.currentFilter.tag)
        );
    }

    // Search filter
    if (state.currentFilter.search) {
        const search = state.currentFilter.search;
        filteredTopics = filteredTopics.filter(t =>
            (t.title && t.title.toLowerCase().includes(search)) ||
            (t.description && t.description.toLowerCase().includes(search)) ||
            (t.tags && t.tags.some(tag => tag.toLowerCase().includes(search)))
        );
    }

    // Sorting
    if (state.currentFilter.sort === 'newest') {
        filteredTopics.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    } else if (state.currentFilter.sort === 'popular') {
        filteredTopics.sort((a, b) => (b.views || 0) - (a.views || 0));
    } else if (state.currentFilter.sort === 'active') {
        filteredTopics.sort((a, b) => (b.replyCount || 0) - (a.replyCount || 0));
    }

    topicsList.innerHTML = '';

    if (filteredTopics.length === 0) {
        topicsList.innerHTML = `
            <div class="empty-state">
                <i data-lucide="search-x" class="empty-state-icon"></i>
                <h3>Keine Themen gefunden</h3>
                <p>Probiere eine andere Suche oder Kategorie.</p>
            </div>
        `;
        if (window.lucide) window.lucide.createIcons();
        if (topicCount) topicCount.innerText = '0 Themen';
        document.getElementById('pagination').innerHTML = '';
        return;
    }

    if (topicCount) topicCount.innerText = `${filteredTopics.length} Themen`;

    // Pagination
    const totalPages = Math.ceil(filteredTopics.length / CONFIG.TOPICS_PER_PAGE);
    const startIndex = (state.currentPage - 1) * CONFIG.TOPICS_PER_PAGE;
    const paginatedTopics = filteredTopics.slice(startIndex, startIndex + CONFIG.TOPICS_PER_PAGE);

    renderPagination(filteredTopics.length, state.currentPage, CONFIG.TOPICS_PER_PAGE);

    for (const topic of paginatedTopics) {
        try {
            const userSnapshot = await get(ref(database, 'users/' + topic.authorId));
            const author = userSnapshot.val() || { 
                username: 'Unbekannt', 
                avatar: 'https://api.dicebear.com/10.x/notionists-neutral/svg?seed=unknown', 
                points: 0, 
                isAdmin: false 
            };
            const rank = getRank(author.points, author.isAdmin);

            const card = document.createElement('a');
            card.href = `topic.html?id=${encodeURIComponent(topic.id)}`;
            card.className = 'topic-card';
            card.innerHTML = `
                <img src="${escapeHtml(author.avatar)}" alt="${escapeHtml(author.username)}" class="topic-card-avatar" loading="lazy">
                <div class="topic-card-main">
                    <span class="topic-card-title">${escapeHtml(topic.title)}</span>
                    <div class="topic-card-meta">
                        <span>${escapeHtml(author.username)}</span>
                        <span class="rank-badge ${escapeHtml(rank.class)}">${escapeHtml(rank.name)}</span>
                        <span>•</span>
                        <span>${formatDate(topic.createdAt)}</span>
                        <span>•</span>
                        <span style="color: var(--accent);">${escapeHtml(getCategoryLabel(topic.category))}</span>
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
        } catch (error) {
            console.error('Error rendering topic:', error);
        }
    }
    
    if (window.lucide) window.lucide.createIcons();
}