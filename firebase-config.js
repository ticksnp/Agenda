// firebase-config.js

// Importa as funções necessárias do SDK do Firebase
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.4.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.4.0/firebase-firestore.js";
import { getAuth, setPersistence, browserLocalPersistence } from "https://www.gstatic.com/firebasejs/10.4.0/firebase-auth.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/10.4.0/firebase-analytics.js";

// =================================================================================
// ATENÇÃO: SUBSTITUA TODO O CONTEÚDO DESTE OBJETO 'firebaseConfig'
// PELO OBJETO FORNECIDO NAS CONFIGURAÇÕES DO SEU PROJETO FIREBASE.
// ISSO É CRUCIAL PARA A CONEXÃO FUNCIONAR CORRETAMENTE.
// =================================================================================
const firebaseConfig = {
  apiKey: "AIzaSyAq3CHTkncNaMlkNUo7X_RrnLGjk8DDQ7o",
  authDomain: "agenda-pwa-36581.firebaseapp.com",
  projectId: "agenda-pwa-36581",
  storageBucket: "agenda-pwa-36581.firebasestorage.app",
  messagingSenderId: "898799966920",
  appId: "1:898799966920:web:0dbe7392acf3fe101ba3fd",
  measurementId: "G-6S92B8HZRT"
};


// Inicializa os serviços do Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const analytics = getAnalytics(app);

// Configura a persistência da autenticação
setPersistence(auth, browserLocalPersistence)
    .then(() => {
        console.log("Persistência da autenticação do Firebase definida como LOCAL.");
    })
    .catch((error) => {
        console.error("Erro ao configurar a persistência da autenticação do Firebase:", error);
    });

// Exporta as instâncias dos serviços para serem usadas em outros arquivos
export { db, auth, analytics };