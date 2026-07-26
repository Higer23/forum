/**
 * Higum Forum - Firebase Configuration
 * Bu dosya tüm sayfalar (index.html, topic.html) tarafından ortak kullanılır.
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";

// Your web app's Firebase configuration
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

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Export auth and database instances so app.js / topic.js can reuse them
export const auth = getAuth(app);
export const database = getDatabase(app);
