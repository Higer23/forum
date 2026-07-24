// =============================================================
// Higum Forum – Firebase v9+ Modular Konfiguration
// Exportiert: app, db (Realtime Database), auth (Authentication)
// =============================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyCp2pvN0b_NS2PYc8c9QeafbhMpju78RKc",
  authDomain: "higforum.firebaseapp.com",
  databaseURL: "https://higforum-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "higforum",
  storageBucket: "higforum.firebasestorage.app",
  messagingSenderId: "1012623822096",
  appId: "1:1012623822096:web:acf978b88f36e1b2e7e995",
  measurementId: "G-C7Q164NQY6",
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const auth = getAuth(app);

export { app, db, auth };
