// =====================================================================
// MÓDULOS E CONFIGURAÇÃO INICIAL
// =====================================================================
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const { Client, LocalAuth } = require('whatsapp-web.js'); // Voltamos para LocalAuth
const qrcode = require('qrcode-terminal');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

process.on('uncaughtException', (err) => {
    console.error('[ERRO FATAL NÃO CAPTURADO]', err);
});

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "*", methods: ["GET", "POST"] } // Permite qualquer origem localmente
});

app.use(cors());
app.use(express.json());

const REMINDERS_DB_PATH = path.join(__dirname, 'reminders.json');

// =====================================================================
// GERENCIADOR DE BOTS (A MUDANÇA CENTRAL)
// =====================================================================

const clients = new Map(); // Armazena as instâncias: { userId => { client, status, qr } }

function createWhatsappClient(userId) {
    if (clients.has(userId)) {
        console.log(`[MANAGER] Instância já existe para o usuário: ${userId}`);
        return clients.get(userId).client;
    }

    console.log(`[MANAGER] Criando nova instância de cliente para o usuário: ${userId}`);
    
    const client = new Client({
        // MUDANÇA: A sessão agora é salva em uma pasta única para cada usuário
        authStrategy: new LocalAuth({ 
            clientId: userId,
            dataPath: path.join(__dirname, 'sessions') // Pasta principal para todas as sessões
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
    const userId = socket.handshake.query.userId;
    if (!userId) {
        return socket.disconnect();
    }
    
    console.log(`[SOCKET] Usuário ${userId} conectou-se com socket ID: ${socket.id}`);
    socket.join(userId); // Coloca o usuário em uma "sala" privada

    if (clients.has(userId)) {
        const { status, qr } = clients.get(userId);
        socket.emit('status_update', { status, qr });
    } else {
        socket.emit('status_update', { status: 'Desconectado', message: 'Clique em Conectar para iniciar.' });
    }

    socket.on('disconnect', () => {
        console.log(`[SOCKET] Usuário ${userId} desconectou-se.`);
    });
});

// =====================================================================
// ENDPOINTS DA API E LÓGICA DE LEMBRETES
// =====================================================================

// Endpoint para o front-end solicitar a inicialização do seu bot
app.post('/connect', (req, res) => {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ message: "userId é obrigatório." });

    createWhatsappClient(userId);
    res.status(200).json({ message: "Inicialização do cliente solicitada." });
});
const checkAndSendReminders = async () => {
    const allReminders = readRemindersFromDB();
    const now = new Date();
    let remindersModified = false;

    const dueReminders = allReminders.filter(r => r && r.status === 'agendado' && new Date(r.sendAt) <= now);

    for (const reminder of dueReminders) {
        const { userId, number, message, id } = reminder;
        
        // Verifica se o bot do usuário correspondente está conectado
        if (clients.has(userId) && clients.get(userId).status === 'Conectado') {
            try {
                const client = clients.get(userId).client;
                const chatId = `${number}@c.us`;
                await client.sendMessage(chatId, message);
                
                // Atualiza o status do lembrete
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
        }
    }

    if (remindersModified) {
        writeRemindersToDB(allReminders);
    }
};
setInterval(checkAndSendReminders, 30000);

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
httpServer.listen(PORT, () => {
    console.log(`Servidor gerenciador de bots rodando na porta ${PORT}`);
});