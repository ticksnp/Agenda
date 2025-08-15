import QRCode from 'https://esm.sh/qrcode';

const WHATSAPP_SERVER_URL = 'http://localhost:3000';
let socket;

/**
 * Atualiza a interface do modal do WhatsApp.
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
            Swal.close(); // Fecha o popup de "Aguarde" se estiver aberto
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
                Swal.close(); // Fecha o popup para mostrar o QR code
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
// FUNÇÕES EXPORTADAS
// =====================================================================

/**
 * Inicia a conexão do socket para o usuário logado.
 * @param {string} userId - O UID do usuário do Firebase.
 */
export function initializeSocketConnection(userId) {
    if (socket) {
        socket.disconnect();
    }
    
    socket = io(WHATSAPP_SERVER_URL, {
        query: { userId }
    });

    socket.on('connect', () => {
        console.log(`Conectado ao servidor de sockets para o usuário ${userId}!`);
    });

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
 * Solicita ao servidor que inicie a instância do bot para o usuário.
 * @param {string} userId - O UID do usuário do Firebase.
 */
export async function connectWhatsapp(userId) {
    try {
        await fetch(`${WHATSAPP_SERVER_URL}/connect`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId }),
        });
    } catch (error) {
        console.error('Erro ao solicitar conexão:', error);
        Swal.fire('Erro', 'Não foi possível solicitar a conexão com o servidor local.', 'error');
    }
}

/**
 * Envia um lote de lembretes para serem agendados.
 * @param {Array} appointments - O array de objetos de agendamento.
 * @param {string} userId - O UID do usuário do Firebase que está agendando.
 */
export async function scheduleBatchWhatsappReminders(appointments, userId) {
    if (!appointments || appointments.length === 0 || !userId) return;

    const appointmentsWithUserId = appointments.map(apt => ({ ...apt, userId }));

    try {
        const response = await fetch(`${WHATSAPP_SERVER_URL}/batch-schedule-reminders`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(appointmentsWithUserId),
        });
        if (!response.ok) {
            throw new Error(`Servidor respondeu com status ${response.status}`);
        }
        console.log("Lote de lembretes enviado ao servidor com sucesso.");
    } catch (error) {
        console.error('Erro CRÍTICO ao enviar lote de lembretes para o servidor:', error);
        Swal.fire('Erro de Conexão', `Não foi possível agendar os lembretes no servidor. Detalhes: ${error.message}`, 'error');
    }
}

/**
 * **[FUNÇÃO CORRIGIDA E IMPLEMENTADA]**
 * Solicita o cancelamento de um lembrete específico para um usuário.
 * @param {string} reminderId - O ID do lembrete (geralmente o ID do agendamento).
 * @param {string} userId - O UID do usuário do Firebase.
 */
export async function cancelWhatsappReminder(reminderId, userId) {
    try {
        await fetch(`${WHATSAPP_SERVER_URL}/cancel-reminder`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: reminderId, userId: userId }),
        });
    } catch (error) {
        console.error('Erro ao cancelar lembrete:', error);
    }
}

/**
 * **[FUNÇÃO CORRIGIDA E IMPLEMENTADA]**
 * Busca a lista de lembretes de um usuário específico do servidor.
 * @param {string} userId - O UID do usuário do Firebase.
 * @returns {Promise<Array>} Uma promessa que resolve para um array de lembretes.
 */
export async function getWhatsappReminders(userId) {
    if (!userId) return [];
    try {
        const response = await fetch(`${WHATSAPP_SERVER_URL}/reminders?userId=${userId}`);
        if (!response.ok) {
            throw new Error('Falha ao buscar lembretes do servidor.');
        }
        return await response.json();
    } catch (error) {
        console.error('Erro ao buscar lembretes:', error);
        return []; // Retorna vazio em caso de erro
    }
}