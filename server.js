// =====================================================================
// MÓDULOS E CONFIGURAÇÃO INICIAL
// =====================================================================
const express = require('express');
const http = require('http'); // Módulo http nativo do Node
const { Server } = require("socket.io"); // Importa o Server do Socket.IO
const { Client, RemoteAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { MongoStore } = require('wwebjs-mongo');

// Captura de exceções não tratadas para log, mas evita que o servidor caia.
process.on('uncaughtException', (err) => {
    console.error('[ERRO FATAL NÃO CAPTURADO]', err);
});

const app = express();
const httpServer = http.createServer(app); // Cria um servidor http para o Express
const io = new Server(httpServer, { // Inicia o Socket.IO no mesmo servidor
  cors: {
    origin: "https://fsagenda.netlify.app", // Permite a conexão da sua agenda
    methods: ["GET", "POST"]
  }
});

app.use(cors({
  origin: 'https://fsagenda.netlify.app'
}));
app.use(express.json());

const REMINDERS_DB_PATH = path.join(__dirname, 'reminders.json');
const MONGODB_URI = process.env.MONGODB_URI; 

if (!MONGODB_URI) {
    console.error("[ERRO CRÍTICO] A variável de ambiente MONGODB_URI não está definida.");
    process.exit(1);
}

let store;
mongoose.connect(MONGODB_URI).then(() => {
    store = new MongoStore({ mongoose: mongoose });
    console.log("[MANAGER] Conectado ao MongoDB com sucesso para armazenar a sessão.");
    initializeClient(); // Inicia o cliente do WhatsApp SÓ DEPOIS de conectar ao BD
}).catch(err => {
    console.error("[ERRO CRÍTICO] Não foi possível conectar ao MongoDB.", err);
    process.exit(1);
});

// =====================================================================
// LÓGICA DO SOCKET.IO E ESTADO DO WHATSAPP
// =====================================================================

let whatsappState = { status: 'Inicializando...', qr: null, message: 'Servidor está inicializando e conectando ao banco de dados.' };

// Função central para enviar o status a todos os clientes conectados
function emitStatusUpdate() {
  io.emit('status_update', whatsappState);
  console.log(`[SOCKET] Status emitido: ${whatsappState.status}`);
}

io.on('connection', (socket) => {
  console.log('[SOCKET] Um usuário se conectou:', socket.id);
  // Envia o status atual assim que o usuário se conecta
  socket.emit('status_update', whatsappState);

  socket.on('disconnect', () => {
    console.log('[SOCKET] Um usuário se desconectou:', socket.id);
  });
});


// =====================================================================
// FUNÇÕES DO BANCO DE DADOS (reminders.json) - Sem alterações
// =====================================================================

function readRemindersFromDB() {
    if (!fs.existsSync(REMINDERS_DB_PATH)) {
        fs.writeFileSync(REMINDERS_DB_PATH, '[]', 'utf8');
        return [];
    }
    try {
        const data = fs.readFileSync(REMINDERS_DB_PATH, 'utf8');
        return data.trim() === '' ? [] : JSON.parse(data);
    } catch (e) {
        console.error("Erro ao ler reminders.json:", e);
        return [];
    }
}

function writeRemindersToDB(reminders) {
    try {
        fs.writeFileSync(REMINDERS_DB_PATH, JSON.stringify(reminders, null, 2), 'utf8');
    } catch (e) {
        console.error("Erro CRÍTICO ao salvar reminders.json:", e);
    }
}

let allReminders = readRemindersFromDB();

// =====================================================================
// AGENDADOR DE LEMBRETES (Scheduler) - Sem alterações
// =====================================================================
const checkAndSendReminders = async () => { /* ... sua função continua igual ... */ };
setInterval(checkAndSendReminders, 30000);

// =====================================================================
// GERENCIAMENTO DO CLIENTE WHATSAPP COM EMISSÃO DE STATUS
// =====================================================================
let client;
let isReconnecting = false;

function initializeClient() {
    if (client || !store) return;
    isReconnecting = false;

    console.log('[MANAGER] Inicializando o cliente WhatsApp...');
    client = new Client({
        authStrategy: new RemoteAuth({
            store: store,
            backupSyncIntervalMs: 300000
        }),
        puppeteer: {
            headless: true,
            args: [
                '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas', '--no-first-run', '--no-zygote',
                '--single-process', '--disable-gpu'
            ],
        },
    });

    client.on('qr', (qr) => { 
        qrcode.generate(qr, { small: true }); 
        whatsappState = { status: 'Aguardando QR Code', qr: qr, message: 'Escaneie o QR Code para conectar.' };
        emitStatusUpdate(); // Avisa a agenda sobre o novo QR Code
    });

    client.on('ready', () => { 
        console.log('[EVENT] Cliente do WhatsApp conectado e pronto!'); 
        whatsappState = { status: 'Conectado', qr: null, message: 'Cliente conectado com sucesso.' };
        emitStatusUpdate(); // Avisa a agenda que a conexão foi um sucesso
    });
    
    client.on('remote_session_saved', () => {
        console.log('[EVENT] Sessão salva remotamente no MongoDB.');
    });

    client.on('disconnected', (reason) => { 
        console.error(`[EVENT] Cliente desconectado. Motivo: ${reason}.`); 
        handleReconnection();
    });

    client.on('auth_failure', (msg) => { 
        console.error(`[EVENT] Falha de autenticação: ${msg}. A sessão é inválida e será removida.`);
        handleReconnection(true); 
    });

    client.initialize().catch(err => {
        console.error("[ERRO CRÍTICO] Falha ao inicializar o cliente:", err.message);
        handleReconnection();
    });
}

async function handleReconnection(removeSession = false) {
    if (isReconnecting) return;
    isReconnecting = true;
    
    whatsappState = { status: 'Reconectando...', qr: null, message: 'A conexão foi perdida. Tentando restabelecer...' };
    emitStatusUpdate(); // Avisa a agenda que está reconectando
    
    if (client) {
        try {
            await client.destroy();
            console.log('[MANAGER] Instância do cliente antigo destruída com sucesso.');
        } catch (e) {
            console.error('[MANAGER] Erro ao destruir o cliente antigo:', e.message);
        }
    }
    client = null;

    if (removeSession) {
        console.log('[MANAGER] Removendo sessão remota do MongoDB para forçar novo QR Code.');
        await store.delete({ session: "default" });
    }
    
    setTimeout(initializeClient, 5000);
}

// =====================================================================
// ENDPOINTS DA API
// =====================================================================
app.get('/status', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.status(200).json(whatsappState);
});

app.post('/reconnect', async (req, res) => {
    if (isReconnecting) {
        return res.status(409).json({ message: 'Processo de reconexão já está em andamento.' });
    }
    console.log('[API] Recebida solicitação do usuário para forçar reconexão.');
    res.status(202).json({ message: 'Processo de reconexão iniciado. Aguarde um novo QR Code se necessário.' });
    await handleReconnection(true);
});

app.get('/reminders', (req, res) => res.status(200).json(allReminders));

app.post('/cancel-reminder', (req, res) => {
    const { id } = req.body;
    if (!id) return res.status(400).json({ message: 'ID é obrigatório.' });
    
    let reminderFound = false;
    allReminders = allReminders.map(r => {
        if (r && r.id === id && r.status === 'agended') {
            reminderFound = true;
            return { ...r, status: 'cancelado' };
        }
        return r;
    });

    if (reminderFound) {
        writeRemindersToDB(allReminders);
        res.status(200).json({ message: 'Lembrete cancelado.' });
    } else {
        res.status(404).json({ message: 'Lembrete não encontrado ou já processado.' });
    }
});

app.post('/batch-schedule-reminders', (req, res) => {
    try {
        const appointments = req.body;
        if (!Array.isArray(appointments)) {
            return res.status(400).json({ message: 'Payload deve ser um array.' });
        }
        
        let remindersWereModified = false;
        for (const apt of appointments) {
            if (!apt?.id || !apt.cellphone || !apt.whatsappReminder || apt.whatsappReminder === 'Sem lembrete' || !apt.date || !apt.startHour || !apt.message) {
                continue; 
            }
            
            const { id, cellphone, whatsappReminder, date, startHour, message } = apt;
            const number = `55${String(cellphone).replace(/\D/g, '')}`;

            let sendAt;
            if (whatsappReminder === 'Enviar agora') {
                sendAt = new Date().toISOString();
            } else {
                const hoursToSubtract = parseInt(whatsappReminder.split(' ')[0], 10);
                if (isNaN(hoursToSubtract)) continue;
                const appointmentDateTime = new Date(`${date}T${startHour}`);
                appointmentDateTime.setHours(appointmentDateTime.getHours() - hoursToSubtract);
                sendAt = appointmentDateTime.toISOString();
            }

            const newReminder = { id, number, message, sendAt, status: 'agended' };
            const existingIndex = allReminders.findIndex(r => r && r.id === id);

            if (existingIndex > -1) {
                allReminders[existingIndex] = newReminder;
            } else {
                allReminders.push(newReminder);
            }
            
            remindersWereModified = true;
        }
        
        if (remindersWereModified) {
            writeRemindersToDB(allReminders);
        }
        
        res.status(200).json({ message: 'Lote de lembretes processado.' });
    } catch (error) {
        console.error('[ERRO NO ENDPOINT /batch-schedule-reminders]:', error);
        res.status(500).json({ message: 'Erro interno no servidor.' });
    }
});

// =====================================================================
// INICIALIZAÇÃO DO SERVIDOR
// =====================================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor de lembretes rodando na porta ${PORT}`);
    // A inicialização do cliente agora acontece após a conexão com o BD ser estabelecida.
});