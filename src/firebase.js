import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// ── PASTE YOUR FIREBASE CONFIG HERE ──────────────────────────────────────────
// Get this from: Firebase Console → Project Settings → Your Apps → Web App
const firebaseConfig = {
  apiKey: "AIzaSyCUV_8Bx7xl-6gtSiRHQepkOkZ0eIwCZ7U",
  authDomain: "iron-log-127cb.firebaseapp.com",
  projectId: "iron-log-127cb",
  storageBucket: "iron-log-127cb.firebasestorage.app",
  messagingSenderId: "890714032308",
  appId: "1:890714032308:web:1ec1ec44010ac5b0ba2fe1"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
