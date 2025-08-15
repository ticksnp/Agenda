import QRCode from 'https://esm.sh/qrcode';

// Aponta para o seu servidor local que você inicia com PM2
const WHATSAPP_SERVER_URL = 'http://localhost:3000';

// Mantém a instância do socket ativa para evitar múltiplas conexões
let socket;

/**
 * Função interna que atualiza a interface do modal do WhatsApp (status, QR code, etc.).
 * @param {object} data - O objeto de status recebido do servidor.
 */
function updateWhatsappUI(data) {
    const statusEl = document.getElementById('whatsapp-status');
    const qrCodeContainer = document.getElementById('whatsapp-qr-code');
    
    if (!statusEl || !qrCodeContainer) return;

    statusEl.textContent = data.status || 'Desconhecido';

    switch (data.status) {
        case 'Conectado':
            statusEl.className = 'badge bg-success';
            qrCodeContainer.innerHTML = '<div class="text-center p-3"><i class="fas fa-check-circle fa-3x text-success"></i><p class="mt-2">Dispositivo conectado!</p></div>';
            break;
        case 'Aguardando QR Code':
            statusEl.className = 'badge bg-warning text-dark';
            if (data.qr && qrCodeContainer.dataset.qr !== data.qr) {
                qrCodeContainer.innerHTML = '';
                const canvas = document.createElement('canvas');
                qrCodeContainer.appendChild(canvas);
                QRCode.toCanvas(canvas, data.qr, { width: 256 }, (error) => {
                    if (error) {
                        console.error("Erro ao renderizar QR Code:", error);
                        qrCodeContainer.innerHTML = '<p class="text-danger">Erro ao renderizar QR Code.</p>';
                    }
                });
                qrCodeContainer.dataset.qr = data.qr;
            }
            break;
        default:
            statusEl.className = 'badge bg-danger';
            qrCodeContainer.innerHTML = `<p class="text-center text-muted p-3">${data.message || 'O cliente não está conectado.'}</p>`;
            qrCodeContainer.dataset.qr = '';
            break;
    }
}

// =====================================================================
// FUNÇÕES EXPORTADAS (A "API" para o app.js)
// =====================================================================

/**
 * Inicia a conexão do socket para o usuário logado, identificando-o pelo seu UID.
 * @param {string} userId - O UID do usuário do Firebase.
 */
export function initializeSocketConnection(userId) {
    // Desconecta qualquer socket antigo para garantir uma única conexão por vez
    if (socket) {
        socket.disconnect();
    }
    
    // Conecta-se ao servidor, enviando o ID do usuário para identificação
    socket = io(WHATSAPP_SERVER_URL, {
        query: { userId }
    });

    socket.on('connect', () => {
        console.log(`Conectado ao servidor de sockets para o usuário ${userId}!`);
    });

    // Ouve pelo evento 'status_update' que o servidor envia em tempo real
    socket.on('status_update', (newState) => {
        console.log('Novo status recebido:', newState.status);
        updateWhatsappUI(newState);
    });

    socket.on('connect_error', (error) => {
        console.error('Erro de conexão com o socket:', error);
        updateWhatsappUI({ status: 'Offline', message: 'Não foi possível conectar ao servidor.' });
    });

    socket.on('disconnect', () => {
        console.warn('Desconectado do servidor de sockets.');
        updateWhatsappUI({ status: 'Desconectado', message: 'A conexão em tempo real foi perdida.' });
    });
}

/**
 * Solicita ao servidor que inicie a instância do bot para o usuário especificado.
 * @param {string} userId - O UID do usuário do Firebase.
 */
export async function connectWhatsapp(userId) {
    try {
        await fetch(`${WHATSAPP_SERVER_URL}/connect`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId }),
        });
        // A UI será atualizada automaticamente via socket quando o QR code ou status de "pronto" chegar.
    } catch (error) {
        console.error('Erro ao solicitar conexão:', error);
        Swal.fire('Erro', 'Não foi possível solicitar a conexão com o servidor local.', 'error');
    }
}

/**
 * Envia um lote de lembretes para serem agendados, incluindo o UID do usuário.
 * @param {Array} appointments - O array de objetos de agendamento.
 * @param {string} userId - O UID do usuário do Firebase que está agendando.
 */
export async function scheduleBatchWhatsappReminders(appointments, userId) {
    if (!appointments || appointments.length === 0) return;

    // Adiciona o userId a cada lembrete para que o servidor saiba quem é o dono
    const appointmentsWithUserId = appointments.map(apt => ({ ...apt, userId }));

    try {
        await fetch(`${WHATSAPP_SERVER_URL}/batch-schedule-reminders`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(appointmentsWithUserId), // Envia o lote com os IDs
        });
        console.log("Lote de lembretes enviado ao servidor com sucesso.");
    } catch (error) {
        console.error('Erro CRÍTICO ao enviar lote de lembretes para o servidor:', error);
        Swal.fire('Erro de Conexão', `Não foi possível agendar os lembretes no servidor. Detalhes: ${error.message}`, 'error');
    }
}

// (As funções abaixo seriam adaptadas de forma similar, sempre passando o userId)

export async function cancelWhatsappReminder(reminderId, userId) {
    // A implementação no servidor precisaria ser ajustada para receber e usar o userId
    console.log(`Solicitando cancelamento para o lembrete ${reminderId} do usuário ${userId}`);
}

export async function getWhatsappReminders(userId) {
    // A implementação no servidor precisaria ser ajustada para retornar lembretes apenas para este userId
    console.log(`Buscando lembretes para o usuário ${userId}`);
    return []; // Retorna vazio por enquanto
}