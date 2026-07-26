// firebase-config.js
// Higum Forum - Firebase Configuration
// WARNING: Restrict API key in Firebase Console > API & Services > Credentials

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";

const firebaseConfig = {
    apiKey: "AIzaSyCp2pvN0b_NS2PYc8c9QeafbhMpju78RKc",
    authDomain: "higforum.firebaseapp.com",
    databaseURL: "https://higforum-default-rtdb.europe-west1.firebasedatabase.app",
    projectId: "higforum",
    storageBucket: "higforum.firebasestorage.app",
    messagingSenderId: "1012623822096",
    appId: "1:1012623822096:web:acf978b88f36e1b2e7e995",
    measurementId: "G-C7Q164NQY6"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const database = getDatabase(app);

export { app, auth, database };
