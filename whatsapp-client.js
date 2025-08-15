import QRCode from 'https://esm.sh/qrcode';

// =================================================================================
// ATENÇÃO: SUBSTITUA ESTA URL PELA URL PÚBLICA DO SEU SERVIDOR QUANDO ESTIVER ONLINE
// Exemplo: 'https://meu-bot-agenda.onrender.com'
// =================================================================================
const WHATSAPP_SERVER_URL = 'https://agenda-43p2.onrender.com';

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
            // Garante que o QR code só seja renderizado se for diferente do anterior
            if (data.qr && qrCodeContainer.dataset.qr !== data.qr) {
                qrCodeContainer.innerHTML = ''; // Limpa o conteúdo
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
            qrCodeContainer.dataset.qr = ''; // Limpa o QR code antigo
            break;
    }
}

// Função que inicia e gerencia a conexão do socket em tempo real
export function initializeSocketConnection() {
    // A variável `io` está disponível globalmente por causa do script que adicionamos no HTML
    const socket = io(WHATSAPP_SERVER_URL);

    socket.on('connect', () => {
        console.log('Conectado ao servidor de sockets com sucesso!');
    });

    // Ouve pelo evento 'status_update' que o servidor envia
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

// Funções auxiliares não exportadas (usadas apenas dentro deste arquivo)
async function sendWhatsappReminder(number, message) {
    try {
        const response = await fetch(`${WHATSAPP_SERVER_URL}/send-reminder`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ number, message }),
        });
        if (!response.ok) throw new Error('Erro do servidor.');
        Swal.fire('Sucesso!', 'Lembrete do WhatsApp enviado!', 'success');
    } catch (error) {
        Swal.fire('Erro de Conexão', `Não foi possível enviar o lembrete. Detalhes: ${error.message}`, 'error');
    }
}

async function scheduleWhatsappReminder(id, number, message, sendAt) {
    try {
        // Esta função está sendo substituída pela versão em lote, mas mantida para referência
        await fetch(`${WHATSAPP_SERVER_URL}/schedule-reminder`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, number, message, sendAt, status: 'agended' }),
        });
    } catch (error) {
        console.error(`Erro ao agendar lembrete para o ID ${id}:`, error);
    }
}

// =====================================================================
// FUNÇÕES EXPORTADAS (Usadas pelo app.js)
// =====================================================================

export async function scheduleBatchWhatsappReminders(appointments) {
    if (!appointments || appointments.length === 0) {
        console.log("Nenhum lembrete para enviar em lote.");
        return;
    }
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

export async function handleWhatsappLogic(appointmentData, appointmentId) {
    const { whatsappReminder, cellphone, patient, professional, date, startHour } = appointmentData;
    
    // Se não há celular ou lembrete definido, cancela qualquer lembrete agendado para este ID
    if (!cellphone || whatsappReminder === 'Sem lembrete') {
        await cancelWhatsappReminder(appointmentId);
        return;
    }

    // A lógica de agendamento agora é centralizada no `app.js` através da função de lote.
    // Esta função `handleWhatsappLogic` torna-se obsoleta para o agendamento,
    // mas a mantemos caso seja usada para envios imediatos ou cancelamentos.
    // O agendamento principal ocorre no submit do formulário em `app.js`.
}

export async function checkWhatsappStatus() {
    try {
        const response = await fetch(`${WHATSAPP_SERVER_URL}/status`, { cache: 'no-cache' });
        if (!response.ok) throw new Error(`Servidor respondeu com status ${response.status}`);
        const data = await response.json();
        updateWhatsappUI(data);
    } catch (error) {
        updateWhatsappUI({ status: 'Offline', message: 'Não foi possível conectar ao servidor de lembretes. Verifique se ele está em execução.' });
    }

    const statusEl = document.getElementById('whatsapp-status');
    const qrCodeContainer = document.getElementById('whatsapp-qr-code');
    
    if (!statusEl || !qrCodeContainer) return;

    try {
        const response = await fetch(`${WHATSAPP_SERVER_URL}/status`, { cache: 'no-cache' });
        if (!response.ok) throw new Error(`Servidor respondeu com status ${response.status}`);
        const data = await response.json();
        
        statusEl.textContent = data.status || 'Desconhecido';

        switch (data.status) {
            case 'Conectado':
                statusEl.className = 'badge bg-success';
                qrCodeContainer.innerHTML = '<div class="text-center p-3"><i class="fas fa-check-circle fa-3x text-success"></i><p class="mt-2">Dispositivo conectado!</p></div>';
                break;
            case 'Aguardando QR Code':
                statusEl.className = 'badge bg-warning text-dark';
                if (data.qr && qrCodeContainer.dataset.qr !== data.qr) {
                    qrCodeContainer.innerHTML = ''; // Limpa o conteúdo anterior
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
                qrCodeContainer.dataset.qr = ''; // Limpa o QR code antigo
                break;
        }
    } catch (error) {
        statusEl.textContent = 'Offline';
        statusEl.className = 'badge bg-danger';
        qrCodeContainer.innerHTML = '<p class="text-center text-danger p-3">Não foi possível conectar ao servidor de lembretes. Verifique se ele está em execução.</p>';
        qrCodeContainer.dataset.qr = '';
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
    console.log("Buscando lembretes do servidor...");
    try {
        const response = await fetch(`${WHATSAPP_SERVER_URL}/reminders`);
        
        if (!response.ok) {
            throw new Error(`O servidor respondeu com status: ${response.status}`);
        }
        const data = await response.json();
        // Garante que sempre retornará um array, mesmo que a resposta seja malformada
        return Array.isArray(data) ? data : [];
    } catch (error) {
        console.error("Falha CRÍTICA ao buscar lembretes do servidor.", error);
        Swal.fire('Erro de Conexão', `Não foi possível buscar a lista de lembretes. Detalhes: ${error.message}`, 'error');
        return [];
    }
}