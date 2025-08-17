// MÓDulos E CONFIGURAÇÃO INICIAL
// =====================================================================
const express = require('express');
const https = require('https'); // MUDANÇA: Usar o módulo HTTPS
const fs = require('fs'); // MUDANÇA: Módulo File System para ler os certificados
const { Server } = require("socket.io");
const { Client, LocalAuth } = require('whatsapp-web.js');
const cors = require('cors');
const path = require('path');

// Manipulador para erros não capturados, evitando que o servidor caia
process.on('uncaughtException', (err) => {
    console.error('[ERRO FATAL NÃO CAPTURADO]', err);
});

const app = express();

// MUDANÇA: Configuração do SSL
const sslOptions = {
    key: fs.readFileSync(path.join(__dirname, 'key.pem')), // Caminho para sua chave
    cert: fs.readFileSync(path.join(__dirname, 'cert.pem')) // Caminho para seu certificado
};

const httpsServer = https.createServer(sslOptions, app); // MUDANÇA: Criar um servidor HTTPS

const io = new Server(httpsServer, {
  allowEIO3: true, // Mantém a compatibilidade
  cors: {
    origin: "*", // A configuração mais permissiva possível para o teste
    methods: ["GET", "POST"],
    credentials: true
  }
});

app.use(cors());
app.use(express.json());

const REMINDERS_DB_PATH = path.join(__dirname, 'reminders.json');

// =====================================================================
// O RESTANTE DO SEU CÓDIGO (FUNÇÕES, GERENCIADOR DE BOTS, ENDPOINTS)
// PERMANECE EXATAMENTE O MESMO. COLE-O AQUI.
// ... (todo o resto do seu server.js a partir da linha "FUNÇÕES AUXILIARES") ...
// =====================================================================

// =====================================================================
// FUNÇÕES AUXILIARES PARA PERSISTÊNCIA DE LEMBRETES
// =====================================================================

function readRemindersFromDB() {
    try {
        if (fs.existsSync(REMINDERS_DB_PATH)) {
            const data = fs.readFileSync(REMINDERS_DB_PATH, 'utf8');
            return JSON.parse(data);
        }
        return [];
    } catch (error) {
        console.error('[DB] Erro ao ler o arquivo de lembretes:', error);
        return [];
    }
}

function writeRemindersToDB(reminders) {
    try {
        fs.writeFileSync(REMINDERS_DB_PATH, JSON.stringify(reminders, null, 2), 'utf8');
    } catch (error) {
        console.error('[DB] Erro ao escrever no arquivo de lembretes:', error);
    }
}

// =====================================================================
// GERENCIADOR DE BOTS (MULTI-USUÁRIO)
// =====================================================================

const clients = new Map();

function createWhatsappClient(userId) {
    if (clients.has(userId)) {
        console.log(`[MANAGER] Instância já existe para o usuário: ${userId}`);
        return clients.get(userId).client;
    }

    console.log(`[MANAGER] Criando nova instância de cliente para o usuário: ${userId}`);
    
    const client = new Client({
        authStrategy: new LocalAuth({ 
            clientId: userId,
            dataPath: path.join(__dirname, 'sessions')
        }), 
        puppeteer: { 
            headless: true, 
            args: ['--no-sandbox', '--disable-setuid-sandbox'] 
        } 
    });

    clients.set(userId, { client, status: 'Inicializando...', qr: null });

    client.on('qr', (qr) => {
        console.log(`[EVENT] QR Code gerado para: ${userId}`);
        const session = clients.get(userId);
        session.status = 'Aguardando QR Code';
        session.qr = qr;
        io.to(userId).emit('status_update', { status: session.status, qr: session.qr });
    });

    client.on('ready', () => {
        console.log(`[EVENT] Cliente pronto para: ${userId}`);
        const session = clients.get(userId);
        session.status = 'Conectado';
        session.qr = null;
        io.to(userId).emit('status_update', { status: session.status });
    });

    client.on('disconnected', async (reason) => {
        console.log(`[EVENT] Cliente desconectado para ${userId}. Motivo: ${reason}`);
        await destroyClient(userId);
        io.to(userId).emit('status_update', { status: 'Desconectado', message: 'A conexão foi perdida.' });
    });

    client.initialize().catch(err => {
        console.error(`[ERRO CRÍTICO] Falha ao inicializar cliente para ${userId}:`, err.message);
        destroyClient(userId);
    });

    return client;
}

async function destroyClient(userId) {
    if (clients.has(userId)) {
        const { client } = clients.get(userId);
        try {
            await client.destroy();
        } catch (e) {
            console.error(`Erro ao destruir cliente para ${userId}:`, e.message);
        }
        clients.delete(userId);
        console.log(`[MANAGER] Instância para o usuário ${userId} destruída e removida.`);
    }
}

// =====================================================================
// LÓGICA DO SOCKET.IO
// =====================================================================

io.on('connection', (socket) => {
    console.log("\n=============================================");
    console.log("[SOCKET.IO] NOVA CONEXÃO DETECTADA!");
    console.log("=============================================");

    // Vamos inspecionar o handshake para ver o que está chegando
    console.log("[INFO] Handshake recebido:", JSON.stringify(socket.handshake, null, 2));

    const userId = socket.handshake.query.userId;
    console.log(`[INFO] Tentando conectar com userId: ${userId}`);

    if (!userId) {
        console.error('[ERRO] Conexão recebida sem userId! Desconectando o socket.');
        return socket.disconnect();
    }
    
    console.log(`[SUCESSO] Usuário ${userId} conectou-se com socket ID: ${socket.id}`);
    socket.join(userId);

    if (clients.has(userId)) {
        const { status, qr } = clients.get(userId);
        console.log(`[STATUS] Enviando status existente para ${userId}: ${status}`);
        socket.emit('status_update', { status, qr });
    } else {
        console.log(`[STATUS] Nenhuma sessão ativa. Enviando status 'Desconectado' para ${userId}.`);
        socket.emit('status_update', { status: 'Desconectado', message: 'Clique em Conectar para iniciar.' });
    }

    socket.on('disconnect', () => {
        console.log(`[SOCKET.IO] Usuário ${userId} desconectou-se.`);
    });
});

// Adicione um listener para erros de conexão também
io.on('connect_error', (err) => {
  console.error("[ERRO DE CONEXÃO DO SOCKET.IO]", err);
});
// =====================================================================
// VERIFICADOR E ENVIADOR DE LEMBRETES (SCHEDULER)
// =====================================================================

const checkAndSendReminders = async () => {
    const allReminders = readRemindersFromDB();
    const now = new Date();
    let remindersModified = false;

    const dueReminders = allReminders.filter(r => r && r.status === 'agended' && new Date(r.sendAt) <= now);

    for (const reminder of dueReminders) {
        const { userId, number, message, id } = reminder;
        
        if (clients.has(userId) && clients.get(userId).status === 'Conectado') {
            try {
                const client = clients.get(userId).client;
                const chatId = `${number}@c.us`;
                await client.sendMessage(chatId, message);
                console.log(`[SCHEDULER] Lembrete ${id} enviado para ${number} pelo usuário ${userId}`);
                
                const reminderIndex = allReminders.findIndex(r => r.id === id);
                if (reminderIndex > -1) {
                    allReminders[reminderIndex].status = 'enviado';
                    remindersModified = true;
                }
            } catch (error) {
                console.error(`[SCHEDULER] Falha ao enviar para ${number} do usuário ${userId}. Erro:`, error.message);
                const reminderIndex = allReminders.findIndex(r => r.id === id);
                if (reminderIndex > -1) {
                    allReminders[reminderIndex].status = 'falhou';
                    remindersModified = true;
                }
            }
        } else {
            console.warn(`[SCHEDULER] Lembrete ${id} para o usuário ${userId} não pode ser enviado. Cliente não está conectado.`);
        }
    }

    if (remindersModified) {
        writeRemindersToDB(allReminders);
    }
};

setInterval(checkAndSendReminders, 30000);


// =====================================================================
// ENDPOINTS DA API
// =====================================================================

app.post('/connect', (req, res) => {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ message: "userId é obrigatório." });

    createWhatsappClient(userId);
    res.status(200).json({ message: "Inicialização do cliente solicitada." });
});

app.get('/reminders', (req, res) => {
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ message: "userId é obrigatório." });
    
    const allReminders = readRemindersFromDB();
    const userReminders = allReminders.filter(r => r.userId === userId);
    res.status(200).json(userReminders);
});

app.post('/cancel-reminder', (req, res) => {
    const { id, userId } = req.body;
    if (!id || !userId) return res.status(400).json({ message: 'ID do lembrete e userId são obrigatórios.' });
    
    const allReminders = readRemindersFromDB();
    let reminderFound = false;
    
    const updatedReminders = allReminders.map(r => {
        if (r && r.id === id && r.userId === userId && r.status === 'agendado') {
            reminderFound = true;
            return { ...r, status: 'cancelado' };
        }
        return r;
    });

    if (reminderFound) {
        writeRemindersToDB(updatedReminders);
        res.status(200).json({ message: 'Lembrete cancelado.' });
    } else {
        res.status(404).json({ message: 'Lembrete não encontrado, já processado, ou não pertence a este usuário.' });
    }
});

app.post('/batch-schedule-reminders', (req, res) => {
    try {
        const appointments = req.body;
        if (!Array.isArray(appointments)) {
            return res.status(400).json({ message: 'Payload deve ser um array.' });
        }
        
        const allReminders = readRemindersFromDB();
        let remindersWereModified = false;
        
        for (const apt of appointments) {
            if (!apt?.id || !apt.cellphone || !apt.whatsappReminder || apt.whatsappReminder === 'Sem lembrete' || !apt.date || !apt.startHour || !apt.message || !apt.userId) {
                continue; 
            }
            
            const { id, cellphone, whatsappReminder, date, startHour, message, userId } = apt;
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

            const newReminder = { id, userId, number, message, sendAt, status: 'agendado' };
            const existingIndex = allReminders.findIndex(r => r && r.id === id);

            if (existingIndex > -1) {
                if (allReminders[existingIndex].userId === userId) {
                    allReminders[existingIndex] = newReminder;
                    remindersWereModified = true;
                }
            } else {
                allReminders.push(newReminder);
                remindersWereModified = true;
            }
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
httpsServer.listen(PORT, () => { // MUDANÇA: Iniciar o servidor HTTPS
    console.log(`Servidor gerenciador de bots rodando em HTTPS na porta ${PORT}`);
});