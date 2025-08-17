// MUDANÇA CRÍTICA: A URL AGORA DEVE USAR "https://"
// =================================================================================
// ATENÇÃO: Verifique se o IP local do seu servidor ainda é o mesmo.
// A mudança principal aqui é usar "https" em vez de "http".
// =================================================================================
const WHATSAPP_SERVER_URL = 'https://9c8f1f2153b9.ngrok-free.app';


// O restante do código permanece o mesmo.
import QRCode from 'https://esm.sh/qrcode';

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
            Swal.close();
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
                Swal.close();
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
        updateWhatsappUI({ status: 'Offline', message: 'Não foi possível conectar ao servidor. Verifique se o IP está correto e se o servidor está rodando.' });
    });

    socket.on('disconnect', () => {
        console.warn('Desconectado do servidor de sockets.');
        updateWhatsappUI({ status: 'Desconectado', message: 'A conexão em tempo real foi perdida.' });
    });
}

export async function connectWhatsapp(userId) {
    try {
        await fetch(`${WHATSAPP_SERVER_URL}/connect`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId }),
        });
    } catch (error) {
        console.error('Erro ao solicitar conexão:', error);
        Swal.fire('Erro', 'Não foi possível solicitar a conexão com o servidor local. Verifique o IP e se o firewall não está bloqueando a porta 3000.', 'error');
    }
}

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
        return [];
    }
}