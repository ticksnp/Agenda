// =====================================================================
// MÓDulos E CONFIGURAÇÃO INICIAL
// =====================================================================
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const { Client, LocalAuth } = require('whatsapp-web.js');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

// Manipulador para erros não capturados, evitando que o servidor caia
process.on('uncaughtException', (err) => {
    console.error('[ERRO FATAL NÃO CAPTURADO]', err);
});

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

app.use(cors());
app.use(express.json());

const REMINDERS_DB_PATH = path.join(__dirname, 'reminders.json');

// =====================================================================
// FUNÇÕES AUXILIARES PARA PERSISTÊNCIA DE LEMBRETES
// =====================================================================

/**
 * **[FUNÇÃO ADICIONADA]**
 * Lê e parseia o arquivo JSON de lembretes de forma segura.
 * @returns {Array} Um array de objetos de lembrete.
 */
function readRemindersFromDB() {
    try {
        if (fs.existsSync(REMINDERS_DB_PATH)) {
            const data = fs.readFileSync(REMINDERS_DB_PATH, 'utf8');
            return JSON.parse(data);
        }
        return [];
    } catch (error) {
        console.error('[DB] Erro ao ler o arquivo de lembretes:', error);
        return []; // Retorna um array vazio em caso de erro
    }
}

/**
 * **[FUNÇÃO ADICIONADA]**
 * Escreve o array de lembretes no arquivo JSON.
 * @param {Array} reminders - O array de lembretes a ser salvo.
 */
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

const clients = new Map(); // Armazena as instâncias: { userId => { client, status, qr } }

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
    const userId = socket.handshake.query.userId;
    if (!userId) {
        console.log('[SOCKET] Conexão sem userId. Desconectando.');
        return socket.disconnect();
    }
    
    console.log(`[SOCKET] Usuário ${userId} conectou-se com socket ID: ${socket.id}`);
    socket.join(userId);

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
// VERIFICADOR E ENVIADOR DE LEMBRETES (SCHEDULER)
// =====================================================================

/**
 * **[FUNÇÃO CORRIGIDA]**
 * Verifica periodicamente os lembretes e os envia usando o bot do usuário correto.
 */
const checkAndSendReminders = async () => {
    const allReminders = readRemindersFromDB();
    const now = new Date();
    let remindersModified = false;

    const dueReminders = allReminders.filter(r => r && r.status === 'agendado' && new Date(r.sendAt) <= now);

    for (const reminder of dueReminders) {
        const { userId, number, message, id } = reminder;
        
        // **LÓGICA CENTRAL CORRIGIDA**: Verifica se o bot do usuário específico do lembrete está conectado.
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

// Inicia o verificador de lembretes a cada 30 segundos
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
        // Apenas cancela se o ID do lembrete E o ID do usuário baterem
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
            // **VALIDAÇÃO REFORÇADA**: Garante que o userId está presente
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

            // O novo lembrete agora inclui o userId
            const newReminder = { id, userId, number, message, sendAt, status: 'agendado' };
            const existingIndex = allReminders.findIndex(r => r && r.id === id);

            if (existingIndex > -1) {
                // Garante que não está sobrescrevendo um lembrete de outro usuário
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
httpServer.listen(PORT, () => {
    console.log(`Servidor gerenciador de bots rodando na porta ${PORT}`);
});