// =====================================================================
// MÓDULOS E CONFIGURAÇÃO INICIAL
// =====================================================================
const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

// Captura de exceções não tratadas para log, mas evita que o servidor caia.
process.on('uncaughtException', (err) => {
    console.error('[ERRO FATAL NÃO CAPTURADO]', err);
});

const app = express();
app.use(cors());
app.use(express.json());

const REMINDERS_DB_PATH = path.join(__dirname, 'reminders.json');
const SESSION_PATH = './.wwebjs_auth';

// =====================================================================
// FUNÇÕES DO BANCO DE DADOS (reminders.json)
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
// AGENDADOR DE LEMBRETES (Scheduler)
// =====================================================================

const checkAndSendReminders = async () => {
    if (whatsappState.status !== 'Conectado' || !client) {
        return;
    }

    const now = new Date();
    let remindersModified = false;

    const dueReminders = allReminders.filter(reminder => 
        reminder && reminder.status === 'agendado' && new Date(reminder.sendAt) <= now
    );

    for (const reminder of dueReminders) {
        try {
            const chatId = `${reminder.number}@c.us`;
            await client.sendMessage(chatId, reminder.message);
            
            const reminderIndex = allReminders.findIndex(r => r.id === reminder.id);
            if (reminderIndex > -1) {
                allReminders[reminderIndex].status = 'enviado';
                remindersModified = true;
            }
        } catch (error) {
            console.error(`[SCHEDULER] Falha ao enviar para ${reminder.number}. Erro:`, error.message);
            const reminderIndex = allReminders.findIndex(r => r.id === reminder.id);
             if (reminderIndex > -1) {
                allReminders[reminderIndex].status = 'falhou';
                remindersModified = true;
            }
        }
    }

    if (remindersModified) {
        writeRemindersToDB(allReminders);
    }
};

setInterval(checkAndSendReminders, 30000);

// =====================================================================
// GERENCIAMENTO DO CICLO DE VIDA DO CLIENTE WHATSAPP
// =====================================================================

let whatsappState = { status: 'Inicializando...', qr: null, message: 'Servidor está inicializando.' };
let client;
let isReconnecting = false;

function initializeClient() {
    if (client) return;
    isReconnecting = false;

    console.log('[MANAGER] Inicializando o cliente WhatsApp...');
    client = new Client({ 
        authStrategy: new LocalAuth({ dataPath: SESSION_PATH }), 
        puppeteer: { 
            headless: true, 
            args: ['--no-sandbox', '--disable-setuid-sandbox'] 
        } 
    });

    client.on('qr', (qr) => { 
        qrcode.generate(qr, { small: true }); 
        whatsappState = { status: 'Aguardando QR Code', qr: qr, message: 'Escaneie o QR Code para conectar.' }; 
    });

    client.on('ready', () => { 
        console.log('[EVENT] Cliente do WhatsApp conectado e pronto!'); 
        whatsappState = { status: 'Conectado', qr: null, message: 'Cliente conectado com sucesso.' }; 
    });

    client.on('disconnected', (reason) => { 
        console.error(`[EVENT] Cliente desconectado. Motivo: ${reason}. Iniciando processo de reconexão automática.`); 
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
    console.log('[MANAGER] Iniciando processo de reconexão...');

    if (client) {
        try {
            await client.destroy();
            console.log('[MANAGER] Instância do cliente antigo destruída com sucesso.');
        } catch (e) {
            console.error('[MANAGER] Erro ao destruir o cliente antigo:', e.message);
        }
    }
    client = null;

    if (removeSession && fs.existsSync(SESSION_PATH)) {
        console.log('[MANAGER] Removendo pasta de sessão antiga para forçar novo QR Code.');
        fs.rmSync(SESSION_PATH, { recursive: true, force: true });
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
        if (r && r.id === id && r.status === 'agendado') {
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

            const newReminder = { id, number, message, sendAt, status: 'agendado' };
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
    initializeClient();
});