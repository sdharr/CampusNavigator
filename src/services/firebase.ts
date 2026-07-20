import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyD2E5vWB3EzOJRuG9ERHQeGDFdXgLy7rnI",
  authDomain: "campus-navigator01.firebaseapp.com",
  projectId: "campus-navigator01",
  storageBucket: "campus-navigator01.firebasestorage.app",
  messagingSenderId: "808314954845",
  appId: "1:808314954845:web:abf008a2e17bf5b65399b4",
};

const app = initializeApp(firebaseConfig);

export const db = getFirestore(app);