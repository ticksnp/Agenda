import QRCode from 'https://esm.sh/qrcode';

const WHATSAPP_SERVER_URL = 'https://agenda-43p2.onrender.com';

// Função que atualiza a interface do modal do WhatsApp
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
                         console.error(error);
                         qrCodeContainer.innerHTML = '<p class="text-danger">Erro ao renderizar QR Code.</p>';
                    }
                });
                qrCodeContainer.dataset.qr = data.qr;
            }
            break;
        default:
            statusEl.className = 'badge bg-danger';
            qrCodeContainer.innerHTML = `<p class="text-center text-muted p-3">${data.message || 'O cliente não está conectado ou está inicializando.'}</p>`;
            qrCodeContainer.dataset.qr = '';
            break;
    }
}

// =====================================================================
// FUNÇÕES EXPORTADAS (Usadas pelo app.js)
// =====================================================================

/**
 * Inicia e gerencia a conexão do socket em tempo real.
 * ESTA FUNÇÃO PRECISA SER EXPORTADA.
 */
export function initializeSocketConnection() {
    const socket = io(WHATSAPP_SERVER_URL);

    socket.on('connect', () => {
        console.log('Conectado ao servidor de sockets com sucesso!');
    });

    socket.on('status_update', (newState) => {
        console.log('Novo status recebido do servidor:', newState.status);
        updateWhatsappUI(newState);
    });

    socket.on('connect_error', (error) => {
        console.error('Erro de conexão com o socket:', error);
        updateWhatsappUI({ status: 'Offline', message: 'Não foi possível conectar ao servidor de lembretes em tempo real.' });
    });

    socket.on('disconnect', () => {
        console.warn('Desconectado do servidor de sockets.');
        updateWhatsappUI({ status: 'Desconectado', message: 'A conexão em tempo real foi perdida. Tentando reconectar...' });
    });
}

/**
 * Função de fallback para o botão "Verificar Status", usa fetch.
 */
export async function checkWhatsappStatus() {
    try {
        const response = await fetch(`${WHATSAPP_SERVER_URL}/status`, { cache: 'no-cache' });
        if (!response.ok) throw new Error(`Servidor respondeu com status ${response.status}`);
        const data = await response.json();
        updateWhatsappUI(data);
    } catch (error) {
        updateWhatsappUI({ status: 'Offline', message: 'Não foi possível conectar ao servidor de lembretes. Verifique se ele está em execução.' });
    }
}

// As funções abaixo continuam como antes
export async function scheduleBatchWhatsappReminders(appointments) {
    if (!appointments || appointments.length === 0) return;
    try {
        await fetch(`${WHATSAPP_SERVER_URL}/batch-schedule-reminders`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(appointments),
        });
        console.log("Lote de lembretes enviado ao servidor com sucesso.");
    } catch (error) {
        console.error('Erro CRÍTICO ao enviar lote de lembretes para o servidor:', error);
        Swal.fire('Erro de Conexão', `Não foi possível agendar os lembretes no servidor. Detalhes: ${error.message}`, 'error');
    }
}

export async function cancelWhatsappReminder(id) {
    if (!id) return;
    try {
        await fetch(`${WHATSAPP_SERVER_URL}/cancel-reminder`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id }),
        });
        console.log(`Solicitação de cancelamento para o lembrete ID ${id} enviada.`);
    } catch (error) {
        console.error(`Erro ao solicitar cancelamento do lembrete ID ${id}:`, error);
    }
}

export async function reconnectWhatsapp() {
    try {
        await fetch(`${WHATSAPP_SERVER_URL}/reconnect`, { method: 'POST' });
    } catch (error) {
        console.error('Erro ao tentar reconectar:', error);
        throw error;
    }
}

export async function getWhatsappReminders() {
    try {
        const response = await fetch(`${WHATSAPP_SERVER_URL}/reminders`);
        if (!response.ok) {
            throw new Error(`O servidor respondeu com status: ${response.status}`);
        }
        const data = await response.json();
        return Array.isArray(data) ? data : [];
    } catch (error) {
        console.error("Falha CRÍTICA ao buscar lembretes do servidor.", error);
        Swal.fire('Erro de Conexão', `Não foi possível buscar a lista de lembretes. Detalhes: ${error.message}`, 'error');
        return [];
    }
}