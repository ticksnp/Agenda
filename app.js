// =====================================================================
// MÓDulos E CONFIGURAÇÃO INICIAL
// =====================================================================

// Importa os módulos do Firebase CDN
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.4.0/firebase-app.js";
import { getFirestore, collection, addDoc, getDocs, doc, getDoc, updateDoc, deleteDoc, query, where } from "https://www.gstatic.com/firebasejs/10.4.0/firebase-firestore.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.4.0/firebase-auth.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/10.4.0/firebase-analytics.js";

// Importa as funções de cliente do WhatsApp do arquivo separado
import { handleWhatsappLogic, checkWhatsappStatus, cancelWhatsappReminder, reconnectWhatsapp, getWhatsappReminders, scheduleBatchWhatsappReminders } from './whatsapp-client.js';

// Suas credenciais do Firebase
const firebaseConfig = {
    apiKey: "AIzaSyAq3CHTkncNaMlkNUo7X_RrnLGjk8DDQ7o",
    authDomain: "agenda-pwa-36581.firebaseapp.com",
    projectId: "agenda-pwa-36581",
    storageBucket: "agenda-pwa-36581.firebasestorage.app",
    messagingSenderId: "898799966920",
    appId: "1:898799966920:web:0dbe7392acf3fe101ba3fd",
    measurementId: "G-6S92B8HZRT"
};

// Inicializa o Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const analytics = getAnalytics(app);

// =====================================================================
// CONSTANTES E VARIÁVEIS GLOBAIS DA APLICAÇÃO
// =====================================================================

// Referências globais para elementos da UI
let mainSidebar, agendaSection, patientsSection, patientRecordSection, appointmentsOverviewSection, remindersSection;
let logoutBtn;
let eventTooltip, eventTooltipTimeout;

// Coleções do Firestore
const appointmentsCollection = collection(db, 'appointments');
const professionalsCollection = collection(db, 'professionals');
const evaluationsCollection = collection(db, 'evaluations');
const evolutionsCollection = collection(db, 'evolutions');
const patientsCollection = collection(db, 'patients');

// Opções para preenchimento de selects
const AGREEMENT_OPTIONS = ['Assoc. HSVP', 'BRF', 'Capasemu', 'Cassi', 'Particular', 'Social', 'Unimed'];
const PROCEDURE_OPTIONS = ['Avaliação', 'Psicoterapia'];
const STATUS_COLORS = {
    'Agendado': '#0000FF', 'Confirmado': '#ffc107', 'Cancelado': '#000000',
    'Atendido': '#3CB371', 'Bloqueado': '#6c757d', 'Faltou': '#DC143C',
    'Remarcar': '#888888', 'Não atendido (Sem cobrança)': '#6f42c1', 'Presença confirmada': '#17a2b8',
};

// Informações para documentos (PDFs)
const LETTERHEAD_INFO = {
    professionalName: 'Franciele Sauer', professionalTitle: 'NEUROPSICÓLOGA',
    phone: '(54) 99701-0769', instagram: '@fs_psicoterapia', email: 'contato@fspsicoterapia.com.br',
    address: 'Rua Coronel Chicuta, 575 (Sala 606, Ed. Novo Hamburgo) - Centro Passo Fundo/RS',
    logoBase64: 'COLE_SUA_STRING_BASE64_DO_LOGO_AQUI'
};

// Variáveis de estado, instâncias da UI e caches
const quillEditors = {};
let quillEvolutionContent = null;
const quillTextCache = {};
let calendar;
let currentPatientList = [];
let existingProfessionals = [];
let repeatConfig = null;

// Variáveis de estado para paginação
let currentPatientsPage = 1, patientsItemsPerPage = 10, allFilteredPatients = [];
let currentAppointmentsPage = 1, appointmentsItemsPerPage = 10, allFilteredAppointments = [];
let whatsappStatusInterval = null;


// =====================================================================
// FUNÇÕES DE LÓGICA DE NEGÓCIO (AGENDAMENTOS, PDFs, ETC.)
// =====================================================================

/**
 * **FUNÇÃO FINAL E CORRIGIDA**
 * Gera uma lista de datas de agendamentos repetidos com base em uma configuração.
 * Esta versão itera dia a dia para garantir precisão e a criação do número exato de sessões.
 * @param {string} baseDateStr - A data de início no formato 'YYYY-MM-DD'.
 * @param {object} config - O objeto de configuração da repetição.
 * @param {string} startHour - A hora de início.
 * @param {string} endHour - A hora de término.
 * @returns {Array} Uma lista de objetos de agendamento com { date, startHour, endHour }.
 */
function generateRepeatedAppointments(baseDateStr, config, startHour, endHour) {
    const dayMap = { "Dom": 0, "Seg": 1, "Ter": 2, "Qua": 3, "Qui": 4, "Sex": 5, "Sáb": 6 };
    const selectedDaysOfWeek = new Set(config.days.map(d => dayMap[d]));
    const { frequency, sessions } = config;
    
    const appointments = [];
    // Usar UTC para evitar problemas com fuso horário e horário de verão
    const baseDate = new Date(`${baseDateStr}T00:00:00Z`);
    
    // Define um ponto de referência estável para a frequência quinzenal: o início da semana da data base.
    const weekZeroStart = new Date(baseDate);
    weekZeroStart.setUTCDate(weekZeroStart.getUTCDate() - weekZeroStart.getUTCDay());

    let currentDate = new Date(baseDate);

    let safetyCounter = 0;
    const maxIterations = sessions * 400; // Um limite de segurança muito generoso

    while (appointments.length < sessions && safetyCounter < maxIterations) {
        // Começa a verificar a partir do dia SEGUINTE à data base
        currentDate.setUTCDate(currentDate.getUTCDate() + 1);
        safetyCounter++;

        const currentDayOfWeek = currentDate.getUTCDay();

        if (selectedDaysOfWeek.has(currentDayOfWeek)) {
            let isValid = false;

            if (frequency === 'Semanal') {
                isValid = true;
            } else if (frequency === 'Quinzenal') {
                // Calcula o início da semana da data atual
                const currentWeekStart = new Date(currentDate);
                currentWeekStart.setUTCDate(currentWeekStart.getUTCDate() - currentDayOfWeek);
                
                const diffTime = currentWeekStart.getTime() - weekZeroStart.getTime();
                // Calcula quantas semanas completas se passaram
                const diffWeeks = Math.round(diffTime / (1000 * 60 * 60 * 24 * 7));

                // É válido se a diferença de semanas for um número par (semana 0, 2, 4...)
                if (diffWeeks % 2 === 0) {
                    isValid = true;
                }
            } else if (frequency === 'Mensal') {
                const currentMonth = currentDate.getUTCMonth();
                const currentYear = currentDate.getUTCFullYear();
                
                // Verifica se já adicionamos um agendamento para este mês
                const alreadyHasAppointmentThisMonth = appointments.some(apt => {
                    const aptDate = new Date(`${apt.date}T00:00:00Z`);
                    return aptDate.getUTCMonth() === currentMonth && aptDate.getUTCFullYear() === currentYear;
                });
                
                if (!alreadyHasAppointmentThisMonth) {
                    isValid = true;
                }
            }
            
            if (isValid) {
                appointments.push({
                    date: currentDate.toISOString().split('T')[0],
                    startHour,
                    endHour
                });
            }
        }
    }

    return appointments;
}




// =====================================================================
// FUNÇÕES DE CONTROLE DA UI (NAVEGAÇÃO E EXIBIÇÃO DE SEÇÕES)
// =====================================================================

const showSection = (sectionElement) => {
    console.log(`showSection: Escondendo todas as seções e mostrando ${sectionElement.id}.`);
    // Esconde todas as seções principais
    [agendaSection, patientsSection, patientRecordSection, appointmentsOverviewSection, remindersSection].forEach(sec => sec.classList.add('d-none'));
    
    // Mostra a barra lateral
    mainSidebar.classList.remove('d-none');
    
    // Mostra a seção desejada
    sectionElement.classList.remove('d-none');
};

const showAgendaSection = () => {
    console.log("showAgendaSection: Exibindo Seção da Agenda.");
    showSection(agendaSection);
    if (calendar) {
        if (!calendar.isInitialized) {
            console.log("showAgendaSection: Renderizando FullCalendar pela primeira vez.");
            calendar.render();
        }
        console.log("showAgendaSection: Refetching eventos do FullCalendar.");
        calendar.refetchEvents();
    }
};

const showPatientsSection = async () => {
    console.log("showPatientsSection: Exibindo Seção de Pacientes.");
    showSection(patientsSection);
    const patientsData = await getPatientsFB();
    currentPatientsPage = 1;
    await populatePatientsTable(patientsData);
};

const showPatientRecordSection = async (patientId) => {
    console.log("showPatientRecordSection: Exibindo Seção de Prontuário do Paciente para ID:", patientId);
    showSection(patientRecordSection);
    await populatePatientRecord(patientId);
};

const showAppointmentsOverviewSection = async () => {
    console.log("showAppointmentsOverviewSection: Exibindo Seção de Visão Geral de Atendimentos.");
    showSection(appointmentsOverviewSection);
    const appointmentsData = await getAppointmentsFB();
    currentAppointmentsPage = 1;
    await populateAppointmentsTable(appointmentsData);
};

const showRemindersSection = async () => {
    console.log("showRemindersSection: Exibindo Seção de Lembretes.");
    showSection(remindersSection);
    const reminders = await getWhatsappReminders();
    populateRemindersTable(reminders); 
};


// =====================================================================
// FUNÇÕES DE CRUD (CREATE, READ, UPDATE, DELETE) NO FIRESTORE
// =====================================================================

const addAppointmentFB = async (appointment) => {
    try {
        if (!auth.currentUser) throw new Error("Usuário não autenticado.");
        const appointmentWithUserId = { ...appointment, userId: auth.currentUser.uid };
        const docRef = await addDoc(appointmentsCollection, appointmentWithUserId);
        return docRef.id;
    } catch (e) {
        console.error("Erro ao adicionar agendamento no Firestore: ", e);
        throw e;
    }
};

const getAppointmentsFB = async () => {
    try {
        if (!auth.currentUser) {
            return [];
        }
        const q = query(appointmentsCollection, where("userId", "==", auth.currentUser.uid));
        const querySnapshot = await getDocs(q);
        const appointments = [];
        querySnapshot.forEach((doc) => {
            appointments.push({ id: doc.id, ...doc.data() });
        });
        return appointments;
    } catch (e) {
        console.error("Erro ao obter agendamentos do Firestore: ", e);
        throw e;
    }
};

const getAppointmentByIdFB = async (id) => {
    try {
        const docRef = doc(db, 'appointments', id);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
            const data = docSnap.data();
            if (!auth.currentUser || data.userId !== auth.currentUser.uid) {
                throw new Error("Permissão negada ou documento não pertence ao usuário.");
            }
            return { id: docSnap.id, ...data };
        } else {
            return null;
        }
    } catch (e) {
        console.error("Erro ao obter agendamento por ID do Firestore: ", e);
        throw e;
    }
};

const updateAppointmentFB = async (id, appointment) => {
    try {
        const docRef = doc(db, 'appointments', id);
        await updateDoc(docRef, appointment);
        return true;
    } catch (e) {
        console.error("Erro ao atualizar agendamento no Firestore: ", e);
        throw e;
    }
};

const deleteAppointmentFB = async (id) => {
    try {
        const docRef = doc(db, 'appointments', id);
        await deleteDoc(docRef);
        await cancelWhatsappReminder(id); // Chama a função importada para cancelar qualquer lembrete agendado
        return true;
    } catch (e) {
        console.error("Erro ao deletar agendamento do Firestore: ", e);
        throw e;
    }
};

const addProfessionalFB = async (professional) => {
    try {
        if (!auth.currentUser) throw new Error("Usuário não autenticado.");
        const professionalWithUserId = { ...professional, userId: auth.currentUser.uid };
        const docRef = await addDoc(professionalsCollection, professionalWithUserId);
        return docRef.id;
    } catch (e) {
        console.error("Erro ao adicionar profissional no Firestore: ", e);
        throw e;
    }
};

const getProfessionalsFB = async () => {
    try {
        if (!auth.currentUser) {
            return [];
        }
        const q = query(professionalsCollection, where("userId", "==", auth.currentUser.uid));
        const querySnapshot = await getDocs(q);
        const professionals = [];
        querySnapshot.forEach((doc) => {
            professionals.push({ id: doc.id, ...doc.data() });
        });
        return professionals;
    } catch (e) {
        console.error("Erro ao obter profissionais do Firestore: ", e);
        throw e;
    }
};

const updateProfessionalFB = async (id, professional) => {
    try {
        const docRef = doc(db, 'professionals', id);
        await updateDoc(docRef, professional);
        return true;
    } catch (e) {
        console.error("Erro ao atualizar profissional no Firestore: ", e);
        throw e;
    }
};

const deleteProfessionalFB = async (id) => {
    try {
        const docRef = doc(db, 'professionals', id);
        await deleteDoc(docRef);
        return true;
    } catch (e) {
        console.error("Erro ao deletar profissional do Firestore: ", e);
        throw e;
    }
};

const addEvaluationFB = async (evaluation) => {
    try {
        if (!auth.currentUser) throw new Error("Usuário não autenticado.");
        const evaluationWithUserId = { ...evaluation, userId: auth.currentUser.uid };
        const docRef = await addDoc(evaluationsCollection, evaluationWithUserId);
        return docRef.id;
    }
    catch (e) {
        console.error("Erro ao adicionar avaliação no Firestore: ", e);
        throw e;
    }
};

const getEvaluationsFB = async () => {
    try {
        if (!auth.currentUser) {
            return [];
        }
        const q = query(evaluationsCollection, where("userId", "==", auth.currentUser.uid));
        const querySnapshot = await getDocs(q);
        const evaluations = [];
        querySnapshot.forEach((doc) => {
            evaluations.push({ id: doc.id, ...doc.data() });
        });
        return evaluations;
    } catch (e) {
        console.error("Erro ao obter avaliações do Firestore: ", e);
        throw e;
    }
};

const getEvaluationByIdFB = async (id) => {
    try {
        const docRef = doc(db, 'evaluations', id);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
            const data = docSnap.data();
            if (!auth.currentUser || data.userId !== auth.currentUser.uid) {
                throw new Error("Permissão negada ou documento não pertence ao usuário.");
            }
            return { id: docSnap.id, ...data };
        } else {
            return null;
        }
    } catch (e) {
        console.error("Erro ao obter avaliação por ID do Firestore: ", e);
        throw e;
    }
};

const updateEvaluationFB = async (id, evaluation) => {
    try {
        const docRef = doc(db, 'evaluations', id);
        await updateDoc(docRef, evaluation);
        return true;
    } catch (e) {
        console.error("Erro ao atualizar avaliação no Firestore: ", e);
        throw e;
    }
};

const deleteEvaluationFB = async (id) => {
    try {
        const docRef = doc(db, 'evaluations', id);
        await deleteDoc(docRef);
        return true;
    } catch (e) {
        console.error("Erro ao deletar avaliação do Firestore: ", e);
        throw e;
    }
};

const addEvolutionFB = async (evolution) => {
    try {
        if (!auth.currentUser) throw new Error("Usuário não autenticado.");
        const evolutionWithUserId = { ...evolution, userId: auth.currentUser.uid };
        const docRef = await addDoc(evolutionsCollection, evolutionWithUserId);
        return docRef.id;
    } catch (e) {
        console.error("Erro ao adicionar evolução no Firestore: ", e);
        throw e;
    }
};

const getEvolutionsFB = async () => {
    try {
        if (!auth.currentUser) {
            return [];
        }
        const q = query(evolutionsCollection, where("userId", "==", auth.currentUser.uid));
        const querySnapshot = await getDocs(q);
        const evolutions = [];
        querySnapshot.forEach((doc) => {
            evolutions.push({ id: doc.id, ...doc.data() });
        });
        return evolutions;
    } catch (e) {
        console.error("Erro ao obter evoluções do Firestore: ", e);
        throw e;
    }
};

const getEvolutionByIdFB = async (id) => {
    try {
        const docRef = doc(db, 'evolutions', id);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
            const data = docSnap.data();
            if (!auth.currentUser || data.userId !== auth.currentUser.uid) {
                throw new Error("Permissão negada ou documento não pertence ao usuário.");
            }
            return { id: docSnap.id, ...data };
        } else {
            return null;
        }
    } catch (e) {
        console.error("Erro ao obter evolução por ID do Firestore: ", e);
        throw e;
    }
};

const updateEvolutionFB = async (id, evolution) => {
    try {
        const docRef = doc(db, 'evolutions', id);
        await updateDoc(docRef, evolution);
        return true;
    } catch (e) {
        console.error("Erro ao atualizar evolução no Firestore: ", e);
        throw e;
    }
};

const deleteEvolutionFB = async (id) => {
    try {
        const docRef = doc(db, 'evolutions', id);
        await deleteDoc(docRef);
        return true;
    } catch (e) {
        console.error("Erro ao deletar evolução do Firestore: ", e);
        throw e;
    }
};

const addPatientFB = async (patient) => {
    try {
        if (!auth.currentUser) throw new Error("Usuário não autenticado.");
        const patientWithTimestampAndUserId = { ...patient, createdAt: new Date(), userId: auth.currentUser.uid };
        const docRef = await addDoc(patientsCollection, patientWithTimestampAndUserId);
        return docRef.id;
    } catch (e) {
        console.error("Erro ao adicionar paciente no Firestore: ", e);
        throw e;
    }
};

const getPatientsFB = async () => {
    try {
        if (!auth.currentUser) {
            return [];
        }
        const q = query(patientsCollection, where("userId", "==", auth.currentUser.uid));
        const querySnapshot = await getDocs(q);
        const patients = [];
        querySnapshot.forEach((doc) => {
            patients.push({ id: doc.id, ...doc.data() });
        });
        return patients;
    } catch (e) {
        console.error("Erro ao obter pacientes do Firestore: ", e);
        throw e;
    }
};

const getPatientByNameFB = async (name) => {
    try {
        if (!auth.currentUser) {
            return null;
        }
        const q = query(patientsCollection, where("name", "==", name), where("userId", "==", auth.currentUser.uid));
        const querySnapshot = await getDocs(q);
        if (!querySnapshot.empty) {
            const docSnap = querySnapshot.docs[0];
            const data = docSnap.data();
            return { id: docSnap.id, ...data };
        } else {
            return null;
        }
    } catch (e) {
        console.error("Erro ao obter paciente por nome do Firestore: ", e);
        throw e;
    }
};

const getPatientByIdFB = async (id) => {
    try {
        const docRef = doc(db, 'patients', id);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
            const data = docSnap.data();
            if (!auth.currentUser || data.userId !== auth.currentUser.uid) {
                throw new Error("Permissão negada ou documento não pertence ao usuário.");
            }
            return { id: docSnap.id, ...data };
        } else {
            return null;
        }
    } catch (e) {
        console.error("Erro ao obter paciente por ID do Firestore: ", e);
        throw e;
    }
};

const updatePatientFB = async (id, patient) => {
    try {
        const docRef = doc(db, 'patients', id);
        await updateDoc(docRef, patient);
        return true;
    } catch (e) {
        console.error("Erro ao atualizar paciente no Firestore: ", e);
        throw e;
    }
};

const deletePatientFB = async (id) => {
    try {
        const docRef = doc(db, 'patients', id);
        await deleteDoc(docRef);
        return true;
    } catch (e) {
        console.error("Erro ao deletar paciente do Firestore: ", e);
        throw e;
    }
};

// --- Funções de Geração de PDF ---

function getQuillPlainTextContent(deltaContent) {
    if (!deltaContent) return '';
    if (quillTextCache[deltaContent]) {
        return quillTextCache[deltaContent];
    }
    try {
        const tempDiv = document.createElement('div');
        const tempQuill = new Quill(tempDiv, { readOnly: true, theme: 'bubble', toolbar: false });
        tempQuill.setContents(JSON.parse(deltaContent));
        const plainText = tempQuill.getText();
        quillTextCache[deltaContent] = plainText;
        return plainText;
    } catch (e) {
        console.error("Erro ao converter Delta para texto puro:", e);
        return 'Conteúdo não carregado.';
    }
}


async function generateEvolutionPdf(evolution, appointment, patient) {
    Swal.fire({
        title: 'Gerando PDF...',
        text: 'Por favor, aguarde. Isso pode levar alguns segundos.',
        allowOutsideClick: false,
        didOpen: () => {
            Swal.showLoading();
        }
    });

    try {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF('p', 'mm', 'a4');

        const pageWidth = doc.internal.pageSize.getWidth();
        const pageHeight = doc.internal.pageSize.getHeight();
        const margin = 15;
        const lineSpacing = 5;


        const logoY = 10;
        const infoYStart = 45;
        let currentY = 0;

        if (LETTERHEAD_INFO.logoBase64 && LETTERHEAD_INFO.logoBase64 !== 'COLE_SUA_STRING_BASE64_DO_LOGO_AQUI') {
            const logoImg = new Image();
            logoImg.src = LETTERHEAD_INFO.logoBase64;

            await new Promise(resolve => {
                logoImg.onload = () => {
                    const logoWidth = 30;
                    const logoHeight = (logoImg.naturalHeight * logoWidth) / logoImg.naturalWidth;
                    const x = (pageWidth / 2) - (logoWidth / 2);
                    doc.addImage(logoImg, 'PNG', x, logoY, logoWidth, logoHeight);
                    resolve();
                };
                logoImg.onerror = (e) => {
                    console.error("Erro ao carregar o logo Base64:", e);
                    Swal.update({ text: 'Erro ao carregar o logo. Continuando sem ele.' });
                    resolve();
                };
            });
        }

        doc.setFontSize(10);
        doc.setTextColor(0);
        doc.text(LETTERHEAD_INFO.professionalTitle, pageWidth / 2, infoYStart, { align: 'center' });
        doc.text(LETTERHEAD_INFO.professionalName, pageWidth / 2, infoYStart + lineSpacing, { align: 'center' });
        doc.text(LETTERHEAD_INFO.phone, pageWidth / 2, infoYStart + (lineSpacing * 2), { align: 'center' });
        doc.text(LETTERHEAD_INFO.instagram, pageWidth / 2, infoYStart + (lineSpacing * 3), { align: 'center' });
        doc.text(LETTERHEAD_INFO.email, pageWidth / 2, infoYStart + (lineSpacing * 4), { align: 'center' });
        doc.text(LETTERHEAD_INFO.address, pageWidth / 2, infoYStart + (lineSpacing * 5), { align: 'center' });

        doc.setDrawColor(180);
        doc.setLineWidth(0.2);
        currentY = infoYStart + (lineSpacing * 6) + 5;
        doc.line(margin, currentY, pageWidth - margin, currentY);
        currentY += 10;


        doc.setFontSize(14);
        doc.text(`Detalhes da evolução de ${patient.name || 'Paciente'}`, margin, currentY);
        currentY += 10;

        doc.setFontSize(10);
        doc.text(`Data do atendimento: ${new Date(evolution.date).toLocaleDateString('pt-BR')} das ${evolution.startHour} até ${evolution.endHour || 'N/A'}`, margin, currentY);
        currentY += lineSpacing;
        doc.text(`Convênio: ${evolution.agreement || 'Não informado'}`, margin, currentY);
        currentY += lineSpacing;
        doc.text(`Profissional: ${appointment.professional || 'Não informado'}`, margin, currentY);
        currentY += lineSpacing;
        doc.text(`Procedimento: ${evolution.procedure || 'Não informado'}`, margin, currentY);
        currentY += lineSpacing + 5;

        doc.setFontSize(12);
        doc.text('Conteúdo da Evolução:', margin, currentY);
        currentY += lineSpacing + 2;

        doc.setFontSize(10);

        const evolutionPlainText = getQuillPlainTextContent(evolution.content);
        const textLines = doc.splitTextToSize(evolutionPlainText, pageWidth - (margin * 2));

        for (let i = 0; i < textLines.length; i++) {
            if (currentY + lineSpacing > pageHeight - margin) {
                doc.addPage();
                currentY = margin;
            }
            doc.text(textLines[i], margin, currentY);
            currentY += lineSpacing;
        }

        Swal.close();
        const fileName = `evolucao_${patient.name.replace(/\s/g, '_')}_${new Date().toISOString().substring(0, 10)}.pdf`;
        doc.save(fileName);
        Swal.fire('Sucesso!', 'PDF da evolução gerado!', 'success');

    } catch (error) {
        console.error("Erro ao gerar o PDF da evolução:", error);
        Swal.fire('Erro!', 'Não foi possível gerar o PDF da evolução. Verifique o console para detalhes.', 'error');
    }
}

// --- MODAIS DE VISUALIZAÇÃO E EDIÇÃO ---
const detailedEvaluationModalElement = document.getElementById('detailedEvaluationModal');
let detailedEvaluationModalInstance = null; 

async function openDetailedEvaluationModal(evaluationId, appointmentId, patientId) {
    if (!auth.currentUser) {
        Swal.fire('Acesso Negado', 'Você precisa estar logado para ver detalhes da avaliação.', 'warning');
        return;
    }
    if (!detailedEvaluationModalInstance) {
        Swal.fire('Erro!', 'O modal de detalhes da avaliação não está pronto.', 'error');
        return;
    }

    const evaluation = await getEvaluationByIdFB(evaluationId);
    const appointment = await getAppointmentByIdFB(appointmentId);
    const patient = await getPatientByIdFB(patientId);


    if (evaluation && appointment && patient) {
        detailedEvaluationModalElement.dataset.evaluationId = evaluation.id;
        detailedEvaluationModalElement.dataset.appointmentId = appointment.id;
        detailedEvaluationModalElement.dataset.patientId = patient.id;

        document.getElementById('detailedEvalPatientNameHeader').textContent = patient.name || 'Paciente';
        document.getElementById('detailedEvalPatientName').textContent = patient.name || 'Paciente';

        document.getElementById('detailedEvalPatientHistoryLink').onclick = () => {
            detailedEvaluationModalInstance.hide();
            showPatientRecordSection(patient.id);
        };

        const evaluationDate = new Date(evaluation.date);
        const formattedDate = evaluationDate.toLocaleDateString('pt-BR');
        document.getElementById('detailedEvalDateTime').textContent = `${formattedDate} das ${evaluation.startHour} até ${evaluation.endHour || 'N/A'}`;

        document.getElementById('detailedEvalBirthDate').textContent = patient.birthDate || 'Não informado';
        document.getElementById('detailedEvalGender').textContent = patient.gender || 'Não informado';
        document.getElementById('detailedEvalAddress').textContent = patient.address || 'Não informado';
        document.getElementById('detailedEvalCellphone').textContent = patient.cellphone || 'Não informado';

        document.getElementById('detailedEvalAgreement').textContent = evaluation.agreement || 'Não informado';
        document.getElementById('detailedEvalProfessional').textContent = appointment.professional || 'Não informado';
        document.getElementById('detailedEvalAuthCode').textContent = evaluation.authCode || 'Não informado';

        const detailedEvalContentDivs = {
            mainComplaint: document.getElementById('detailedEvalMainComplaint'),
            currentDiseaseHistory: document.getElementById('detailedEvalCurrentDiseaseHistory'),
            pastMedicalHistory: document.getElementById('detailedEvalPastMedicalHistory'),
            familyHistory: document.getElementById('detailedEvalFamilyHistory'),
            observations: document.getElementById('detailedEvalObservations')
        };

        for (const key in detailedEvalContentDivs) {
            if (detailedEvalContentDivs[key]) {
                detailedEvalContentDivs[key].innerHTML = '';
                const quillView = new Quill(detailedEvalContentDivs[key], { readOnly: true, theme: 'bubble', toolbar: false });
                try {
                    let contentToLoad = evaluation[key];
                    if (key === 'observations' && typeof evaluation.observations !== 'undefined') {
                        contentToLoad = evaluation.observations;
                    }
                    if (contentToLoad) {
                        quillView.setContents(JSON.parse(contentToLoad));
                    }
                } catch (e) {
                    console.error(`Erro ao carregar conteúdo Quill para visualização detalhada (${key}):`, e);
                    detailedEvalContentDivs[key].textContent = 'Erro ao carregar conteúdo.';
                }
            }
        }

        document.getElementById('detailedEvalGeneratePdfBtn').addEventListener('click', () => {
            if (!auth.currentUser) {
                Swal.fire('Acesso Negado', 'Você precisa estar logado para gerar PDF.', 'warning');
                return;
            }
            Swal.fire('Ação!', 'Gerar PDF desta avaliação (funcionalidade a ser implementada).', 'info');
        });

        detailedEvaluationModalInstance.show();
    } else {
        Swal.fire('Erro!', 'Detalhes da avaliação ou agendamento não encontrados.', 'error');
    }
}

const detailedEvolutionModalElement = document.getElementById('detailedEvolutionModal');
let detailedEvolutionModalInstance = null;

async function openDetailedEvolutionModal(evolutionId, appointmentId, patientId) {
    if (!auth.currentUser) {
        Swal.fire('Acesso Negado', 'Você precisa estar logado para ver detalhes da evolução.', 'warning');
        return;
    }
    if (!detailedEvolutionModalInstance) {
        Swal.fire('Erro!', 'O modal de evolução não está pronto.', 'error');
        return;
    }

    const evolution = await getEvolutionByIdFB(evolutionId);
    const appointment = await getAppointmentByIdFB(appointmentId);
    const patient = await getPatientByIdFB(patientId);


    if (evolution && appointment && patient) {
        detailedEvolutionModalElement.dataset.evolutionId = evolution.id;
        detailedEvolutionModalElement.dataset.appointmentId = appointment.id;
        detailedEvolutionModalElement.dataset.patientId = patient.id;

        document.getElementById('detailedEvolPatientNameHeader').textContent = patient.name || 'Paciente';
        document.getElementById('detailedEvolPatientName').textContent = patient.name || 'Paciente';

        document.getElementById('detailedEvolPatientHistoryLink').onclick = () => {
            detailedEvolutionModalInstance.hide();
            showPatientRecordSection(patient.id);
        };

        const evolutionDate = new Date(evolution.date);
        const formattedDate = evolutionDate.toLocaleDateString('pt-BR');
        document.getElementById('detailedEvolDateTime').textContent = `${formattedDate} das ${evolution.startHour} até ${evolution.endHour || 'N/A'}`;

        document.getElementById('detailedEvolAgreement').textContent = evolution.agreement || 'Não informado';
        document.getElementById('detailedEvolProfessional').textContent = appointment.professional || 'Não informado';
        document.getElementById('detailedEvolAuthCode').textContent = evolution.authCode || 'Não informado';
        document.getElementById('detailedEvolProcedure').textContent = evolution.procedure || 'Não informado';


        const detailedEvolContentDiv = document.getElementById('detailedEvolContent');
        detailedEvolContentDiv.innerHTML = '';

        const quillViewEvolutionContent = new Quill(detailedEvolContentDiv, { readOnly: true, theme: 'bubble', toolbar: false });
        try {
            quillViewEvolutionContent.setContents(JSON.parse(evolution.content || '[]'));
        } catch (e) {
            console.error('Erro ao carregar conteúdo Quill para visualização detalhada da evolução:', e);
            detailedEvolContentDiv.textContent = 'Erro ao carregar conteúdo da evolução.';
        }


        document.getElementById('detailedEvolEditBtn').onclick = async () => {
            if (!auth.currentUser) {
                Swal.fire('Acesso Negado', 'Você precisa estar logado para editar evoluções.', 'warning');
                return;
            }
            detailedEvolutionModalInstance.hide();
            await openEvolutionModal(appointment.id, patient.id, evolution.id);
        };

        document.getElementById('detailedEvolGeneratePdfBtn').onclick = async () => {
            if (!auth.currentUser) {
                Swal.fire('Acesso Negado', 'Você precisa estar logado para gerar PDF.', 'warning');
                return;
            }
            const evolId = detailedEvolutionModalElement.dataset.evolutionId;
            const aptId = detailedEvolutionModalElement.dataset.appointmentId;
            const patId = detailedEvolutionModalElement.dataset.patientId;

            if (evolId && aptId && patId) {
                const evolutionData = await getEvolutionByIdFB(evolId);
                const appointmentData = await getAppointmentByIdFB(aptId);
                const patientData = await getPatientByIdFB(patId);

                if (evolutionData && appointmentData && patientData) {
                    await generateEvolutionPdf(evolutionData, appointmentData, patientData);
                } else {
                    Swal.fire('Erro!', 'Dados da evolução, agendamento ou paciente não encontrados para gerar o PDF.', 'error');
                }
            } else {
                Swal.fire('Erro!', 'ID da evolução, agendamento ou paciente inválido para gerar o PDF.', 'error');
            }
        };

        detailedEvolutionModalInstance.show();
    } else {
        Swal.fire('Erro!', 'Detalhes da evolução, agendamento ou paciente não encontrados.', 'error');
    }
}

const evaluationModalElement = document.getElementById('evaluationModal');
let evaluationModalInstance = null; 
let evaluationForm = null;

function initializeQuillEditor(elementId) {
    const element = document.getElementById(elementId);
    if (element) {
        return new Quill(element, {
            theme: 'snow',
            modules: {
                toolbar: [
                    ['bold', 'italic', 'underline'],
                    [{ 'list': 'ordered' }, { 'list': 'bullet' }],
                    [{ 'align': [] }]
                ]
            }
        });
    }
    return null;
}

async function openEvaluationModal(appointmentId, patientId, evaluationId = null) {
    if (!auth.currentUser) {
        Swal.fire('Acesso Negado', 'Você precisa estar logado para acessar avaliações.', 'warning');
        return;
    }
    if (!evaluationModalInstance) {
        Swal.fire('Erro!', 'O modal de avaliação não está pronto.', 'error');
        return;
    }

    const patient = await getPatientByIdFB(patientId);
    if (!patient) {
        Swal.fire('Erro!', 'Paciente não encontrado para avaliação.', 'error');
        return;
    }

    document.getElementById('evaluationId').value = '';
    document.getElementById('evaluationAppointmentId').value = '';
    document.getElementById('evaluationDate').value = '';
    document.getElementById('evaluationStartHour').value = '';
    document.getElementById('evaluationEndHour').value = '';
    document.getElementById('evaluationAgreement').value = 'Particular';
    document.getElementById('evaluationAuthCode').value = '';
    document.getElementById('evaluationLaunchFinancial').checked = false;
    document.getElementById('evaluationProcedure').value = '';

    for (const key in quillEditors) {
        if (quillEditors[key]) {
            quillEditors[key].setContents([]);
        }
    }

    document.getElementById('evaluationPatientName').textContent = patient.name || 'Paciente';
    document.getElementById('evaluationPatientId').value = patient.id;


    if (evaluationId) {
        const existingEvaluation = await getEvaluationByIdFB(evaluationId);
        if (existingEvaluation) {
            document.getElementById('evaluationId').value = existingEvaluation.id;
            document.getElementById('evaluationAppointmentId').value = existingEvaluation.appointmentId || '';
            document.getElementById('evaluationDate').value = existingEvaluation.date;
            document.getElementById('evaluationStartHour').value = existingEvaluation.startHour;
            document.getElementById('evaluationEndHour').value = existingEvaluation.endHour || '';
            document.getElementById('evaluationAgreement').value = existingEvaluation.agreement || 'Particular';
            document.getElementById('evaluationAuthCode').value = existingEvaluation.authCode || '';
            document.getElementById('evaluationLaunchFinancial').checked = existingEvaluation.launchFinancial || false;
            document.getElementById('evaluationProcedure').value = existingEvaluation.procedure || '';
            try {
                if (quillEditors.mainComplaint) quillEditors.mainComplaint.setContents(JSON.parse(existingEvaluation.mainComplaint || '[]'));
                if (quillEditors.currentDiseaseHistory) quillEditors.currentDiseaseHistory.setContents(JSON.parse(existingEvaluation.currentDiseaseHistory || '[]'));
                if (quillEditors.pastMedicalHistory) quillEditors.pastMedicalHistory.setContents(JSON.parse(existingEvaluation.pastMedicalHistory || '[]'));
                if (quillEditors.familyHistory) quillEditors.familyHistory.setContents(JSON.parse(existingEvaluation.familyHistory || '[]'));
                if (quillEditors.evaluationObservations) quillEditors.evaluationObservations.setContents(JSON.parse(existingEvaluation.observations || '[]'));

            } catch (e) {
                console.error('Erro ao carregar conteúdo Quill do Firebase (edição de avaliação):', e);
                for (const key in quillEditors) {
                    if (quillEditors[key]) {
                        quillEditors[key].setContents([]);
                    }
                }
                Swal.fire('Erro!', 'Não foi possível carregar o conteúdo da avaliação. Detalhes: ' + e.message, 'error');
            }
        } else {
            Swal.fire('Erro!', 'Avaliação não encontrada para edição.', 'error');
            return;
        }
    } else if (appointmentId) {
        const appointment = await getAppointmentByIdFB(appointmentId);
        if (appointment) {
            document.getElementById('evaluationAppointmentId').value = appointment.id;
            document.getElementById('evaluationDate').value = appointment.date;
            document.getElementById('evaluationStartHour').value = appointment.startHour;
            document.getElementById('evaluationEndHour').value = appointment.endHour || '';
            document.getElementById('evaluationAgreement').value = appointment.agreement || 'Particular';
            document.getElementById('evaluationAuthCode').value = appointment.authCode || '';
            document.getElementById('evaluationLaunchFinancial').checked = appointment.launchFinancial || false;
            document.getElementById('evaluationProcedure').value = appointment.procedure || '';
        }
    }

    populateEvaluationAgreementsSelect();
    evaluationModalInstance.show();
}

const populateEvaluationAgreementsSelect = () => {
    const evaluationAgreementSelect = document.getElementById('evaluationAgreement');
    if (!evaluationAgreementSelect) {
        return;
    }
    evaluationAgreementSelect.innerHTML = '';
    AGREEMENT_OPTIONS.forEach(agreement => {
        const option = document.createElement('option');
        option.value = agreement;
        option.textContent = agreement;
        evaluationAgreementSelect.appendChild(option);
    });
};

const evolutionModalElement = document.getElementById('evolutionModal');
let evolutionModalInstance = null; 
let evolutionForm = null; 

async function openEvolutionModal(appointmentId = null, patientId, evolutionId = null) {
    if (!auth.currentUser) {
        Swal.fire('Acesso Negado', 'Você precisa estar logado para acessar evoluções.', 'warning');
        return;
    }
    if (!evolutionModalInstance) {
        Swal.fire('Erro!', 'O modal de evolução não está pronto.', 'error');
        return;
    }

    const patient = await getPatientByIdFB(patientId);
    if (!patient) {
        Swal.fire('Erro!', 'Paciente não encontrado para evolução.', 'error');
        return;
    }

    document.getElementById('evolutionId').value = '';
    document.getElementById('evolutionAppointmentId').value = '';
    document.getElementById('evolutionDate').value = '';
    document.getElementById('evolutionStartHour').value = '';
    document.getElementById('evolutionEndHour').value = '';
    document.getElementById('evolutionAgreement').value = 'Particular';
    document.getElementById('evolutionAuthCode').value = '';
    document.getElementById('evolutionLaunchFinancial').checked = false;
    document.getElementById('evolutionProcedure').value = '';
    if (quillEvolutionContent) quillEvolutionContent.setContents([]);
    const attachedFilesInput = document.getElementById('attachedFiles');
    if (attachedFilesInput) attachedFilesInput.value = '';


    document.getElementById('evolutionPatientName').textContent = patient.name || 'Paciente';
    document.getElementById('evolutionPatientId').value = patient.id;

    if (evolutionId) {
        const existingEvolution = await getEvolutionByIdFB(evolutionId);
        if (existingEvolution) {
            document.getElementById('evolutionId').value = existingEvolution.id;
            document.getElementById('evolutionAppointmentId').value = existingEvolution.appointmentId || '';
            document.getElementById('evolutionDate').value = existingEvolution.date;
            document.getElementById('evolutionStartHour').value = existingEvolution.startHour;
            document.getElementById('evolutionEndHour').value = existingEvolution.endHour || '';
            document.getElementById('evolutionAgreement').value = existingEvolution.agreement || 'Particular';
            document.getElementById('evolutionAuthCode').value = existingEvolution.authCode || '';
            document.getElementById('evolutionLaunchFinancial').checked = existingEvolution.launchFinancial || false;
            document.getElementById('evolutionProcedure').value = existingEvolution.procedure || '';
            try {
                if (quillEvolutionContent) quillEvolutionContent.setContents(JSON.parse(existingEvolution.content || '[]'));
            } catch (e) {
                console.error('Erro ao carregar conteúdo Quill da evolução do Firebase (edição de evolução):', e);
                if (quillEvolutionContent) quillEvolutionContent.setContents([]);
                Swal.fire('Erro!', 'Não foi possível carregar o conteúdo da evolução. Detalhes: ' + e.message, 'error');
            }
        } else {
            Swal.fire('Erro!', 'Evolução não encontrada para edição.', 'error');
            return;
        }
    } else if (appointmentId) {
        const appointment = await getAppointmentByIdFB(appointmentId);
        if (appointment) {
            document.getElementById('evolutionAppointmentId').value = appointment.id;
            document.getElementById('evolutionDate').value = appointment.date;
            document.getElementById('evolutionStartHour').value = appointment.startHour;
            document.getElementById('evolutionEndHour').value = appointment.endHour || '';
            document.getElementById('evolutionAgreement').value = appointment.agreement || 'Particular';
            document.getElementById('evolutionAuthCode').value = appointment.authCode || '';
            document.getElementById('evolutionLaunchFinancial').checked = appointment.launchFinancial || false;
            document.getElementById('evolutionProcedure').value = appointment.procedure || '';
        }
    }

    populateEvolutionAgreementsSelect();
    populateProcedureSelect(document.getElementById('evolutionProcedure'));

    evolutionModalInstance.show();
}

const populateEvolutionAgreementsSelect = () => {
    const evolutionAgreementSelect = document.getElementById('evolutionAgreement');
    if (!evolutionAgreementSelect) {
        return;
    }
    evolutionAgreementSelect.innerHTML = '';
    AGREEMENT_OPTIONS.forEach(agreement => {
        const option = document.createElement('option');
        option.value = agreement;
        option.textContent = agreement;
        evolutionAgreementSelect.appendChild(option);
    });
};

// --- Lógica para Popular e Gerenciar a Tabela de Pacientes ---
let patientListTableBody = null; 
let patientFormModalInstance = null;
let patientsPerPageSelect = null; 

async function populatePatientsTable(patientsToDisplay) {
    if (!auth.currentUser) {
        patientListTableBody.innerHTML = `<tr><td colspan="10" class="text-center text-muted">Faça login para ver a lista de pacientes.</td></tr>`;
        document.getElementById('paginationInfo').textContent = 'Mostrando 0 de 0 registros';
        document.getElementById('patientPagination').innerHTML = '';
        return;
    }

    const allRawPatients = patientsToDisplay || []; 
    
    const searchQuery = patientSearchInput.value.toLowerCase().trim();

    allFilteredPatients = allRawPatients.filter(patient => {
        return patient.name && patient.name.toLowerCase().includes(searchQuery);
    });

    if (allFilteredPatients.length === 0) {
        patientListTableBody.innerHTML = `<td colspan="10" class="text-center text-muted">Nenhum paciente encontrado com o termo de pesquisa.</td>`;
        document.getElementById('paginationInfo').textContent = 'Mostrando 0 de 0 registros';
        document.getElementById('patientPagination').innerHTML = '';
        return;
    }

    allFilteredPatients.sort((a, b) => {
        const nameA = a.name ? a.name.toLowerCase() : '';
        const nameB = b.name ? b.name.toLowerCase() : '';
        if (nameA < nameB) return -1;
        if (nameA > nameB) return 1;
        return 0;
    });

    patientsItemsPerPage = parseInt(patientsPerPageSelect.value);

    const totalPages = Math.ceil(allFilteredPatients.length / patientsItemsPerPage);
    if (currentPatientsPage > totalPages) {
        currentPatientsPage = totalPages > 0 ? totalPages : 1;
    }
    if (currentPatientsPage < 1 && totalPages > 0) {
        currentPatientsPage = 1;
    } else if (totalPages === 0) {
        currentPatientsPage = 1;
    }

    const renderPage = (page) => {
        patientListTableBody.innerHTML = '';
        const startIndex = (page - 1) * patientsItemsPerPage;
        const endIndex = Math.min(startIndex + patientsItemsPerPage, allFilteredPatients.length);
        const paginatedItems = allFilteredPatients.slice(startIndex, endIndex);

        if (paginatedItems.length === 0) {
             patientListTableBody.innerHTML = `<td colspan="10" class="text-center text-muted">Nenhum paciente encontrado nesta página.</td>`;
        }


        paginatedItems.forEach(patient => {
            const row = patientListTableBody.insertRow();
            const createdAtDate = patient.createdAt && patient.createdAt.toDate ? patient.createdAt.toDate().toLocaleDateString('pt-BR') : 'N/A';

            row.innerHTML = `
                <td><input type="checkbox" class="patient-checkbox" data-id="${patient.id}"></td>
                <td>${patient.name || 'Não informado'}</td>
                <td>${patient.cellphone || 'Não informado'}</td>
                <td>${patient.birthDate || 'Não registrada'}</td>
                <td>${patient.cpf || 'Não informado'}</td>
                <td>${patient.city || 'Não informado'}</td>
                <td>${patient.agreement || 'Não informado'}</td>
                <td>
                    <button type="button" class="btn btn-sm btn-success view-patient-history-btn" data-id="${patient.id}">
                        Ver histórico
                    </button>
                </td>
                <td>${createdAtDate}</td> <td>
                    <button type="button" class="btn btn-sm btn-primary edit-patient-btn" data-id="${patient.id}">
                        <i class="fas fa-edit"></i> Editar
                    </button>
                    <button type="button" class="btn btn-sm btn-warning archive-patient-btn" data-id="${patient.id}">
                        <i class="fas fa-archive"></i> ${patient.isArchived ? 'Desarquivar' : 'Arquivar/Desativar'}
                    </button>
                    <button type="button" class="btn btn-sm btn-danger delete-patient-btn" data-id="${patient.id}">
                        <i class="fas fa-trash"></i> Excluir
                    </button>
                </td>
            `;

            row.querySelector('.view-patient-history-btn').addEventListener('click', async (e) => {
                if (!auth.currentUser) {
                    Swal.fire('Acesso Negado', 'Você precisa estar logado para ver o histórico do paciente.', 'warning');
                    return;
                }
                const patientId = e.currentTarget.dataset.id;
                await showPatientRecordSection(patientId);
            });

            row.querySelector('.edit-patient-btn').addEventListener('click', async (e) => {
                if (!auth.currentUser) {
                    Swal.fire('Acesso Negado', 'Você precisa estar logado para editar pacientes.', 'warning');
                    return;
                }
                const patientId = e.currentTarget.dataset.id;
                const patientToEdit = await getPatientByIdFB(patientId);
                if (patientToEdit) {
                    document.getElementById('patientDetailsId').value = patientToEdit.id;
                    document.getElementById('patientDetailsName').value = patientToEdit.name || '';
                    document.getElementById('patientDetailsCellphone').value = patientToEdit.cellphone || '';
                    document.getElementById('patientDetailsBirthDate').value = patientToEdit.birthDate || '';
                    document.getElementById('patientDetailsCpf').value = patientToEdit.cpf || '';
                    document.getElementById('patientDetailsCity').value = patientToEdit.city || '';
                    document.getElementById('patientDetailsAgreement').value = patientToEdit.agreement || 'Particular';
                    document.getElementById('patientDetailsAddress').value = patientToEdit.address || '';
                    document.getElementById('patientDetailsObservations').value = patientToEdit.observations || '';
                    document.getElementById('patientDetailsIsArchived').checked = patientToEdit.isArchived || false;

                    document.getElementById('patientDetailsModalLabel').textContent = 'Editar Paciente';
                    patientFormModalInstance.show();
                } else {
                    Swal.fire('Erro!', 'Paciente não encontrado para edição.', 'error');
                }
            });

            row.querySelector('.archive-patient-btn').addEventListener('click', async (e) => {
                if (!auth.currentUser) {
                    Swal.fire('Acesso Negado', 'Você precisa estar logado para arquivar pacientes.', 'warning');
                    return;
                }
                const patientId = e.currentTarget.dataset.id;
                const patientToArchive = await getPatientByIdFB(patientId);
                if (patientToArchive) {
                    const newArchiveStatus = !patientToArchive.isArchived;
                    Swal.fire({
                        title: 'Confirmar Ação',
                        text: `Deseja ${newArchiveStatus ? 'arquivar/desativar' : 'desarquivar'} este paciente?`,
                        icon: 'warning',
                        showCancelButton: true,
                        confirmButtonColor: '#ffc107',
                        cancelButtonColor: '#3085d6',
                        confirmButtonText: `Sim, ${newArchiveStatus ? 'arquivar' : 'desarquivar'}!`,
                        cancelButtonText: 'Cancelar'
                    }).then(async (result) => {
                        if (result.isConfirmed) {
                            try {
                                await updatePatientFB(patientId, { isArchived: newArchiveStatus });
                                Swal.fire('Sucesso!', `Paciente ${newArchiveStatus ? 'arquivado' : 'desarquivado'} com sucesso!`, 'success');
                                const updatedPatients = await getPatientsFB();
                                populatePatientsTable(updatedPatients);
                            } catch (error) {
                                Swal.fire('Erro!', 'Não foi possível arquivar/desarquivar o paciente. Detalhes: ' + error.message, 'error');
                            }
                        }
                    });
                } else {
                    Swal.fire('Erro!', 'Paciente não encontrado para ação de arquivamento.', 'error');
                }
            });

            row.querySelector('.delete-patient-btn').addEventListener('click', async (e) => {
                if (!auth.currentUser) {
                    Swal.fire('Acesso Negado', 'Você precisa estar logado para excluir pacientes.', 'warning');
                    return;
                }
                const patientId = e.currentTarget.dataset.id;
                Swal.fire({
                    title: 'Tem certeza?',
                    text: "Você não poderá reverter isso! O paciente e seus históricos de avaliação/evolução não serão mais exibidos.",
                    icon: 'warning',
                    showCancelButton: true,
                    confirmButtonColor: '#d33',
                    cancelButtonColor: '#3085d6',
                    confirmButtonText: 'Sim, excluir!',
                    cancelButtonText: 'Cancelar'
                }).then(async (result) => {
                    if (result.isConfirmed) {
                        try {
                            await deletePatientFB(patientId);
                            Swal.fire('Excluído!', 'O paciente foi excluído.', 'success');
                            const updatedPatients = await getPatientsFB();
                            populatePatientsTable(updatedPatients);
                            loadPatientSuggestions(updatedPatients);
                            if (!appointmentsOverviewSection.classList.contains('d-none')) {
                                const updatedAppointments = await getAppointmentsFB();
                                await populateAppointmentsTable(updatedAppointments);
                            }
                        } catch (error) {
                            Swal.fire('Erro!', 'Não foi possível deletar o paciente. Detalhes: ' + error.message, 'error');
                        }
                    }
                });
            });
        });

        const currentDisplayedCount = paginatedItems.length;
        const totalFilteredCount = allFilteredPatients.length;
        document.getElementById('paginationInfo').textContent =
            `Mostrando de ${startIndex + 1} até ${startIndex + currentDisplayedCount} de ${totalFilteredCount} registros`;

        const paginationUl = document.getElementById('patientPagination');
        paginationUl.innerHTML = '';

        const prevPageLi = document.createElement('li');
        prevPageLi.classList.add('page-item');
        if (currentPatientsPage === 1) prevPageLi.classList.add('disabled');
        prevPageLi.innerHTML = `<a class="page-link" href="#" id="patientPrevPage">Anterior</a>`;
        paginationUl.appendChild(prevPageLi);
        if (currentPatientsPage > 1) {
            prevPageLi.addEventListener('click', (e) => {
                e.preventDefault();
                currentPatientsPage--;
                renderPage(currentPatientsPage);
            });
        }

        for (let i = 1; i <= totalPages; i++) {
            const pageLi = document.createElement('li');
            pageLi.classList.add('page-item');
            if (i === currentPatientsPage) pageLi.classList.add('active');
            pageLi.innerHTML = `<a class="page-link" href="#">${i}</a>`;
            pageLi.addEventListener('click', (e) => {
                e.preventDefault();
                currentPatientsPage = i;
                renderPage(currentPatientsPage);
            });
            paginationUl.appendChild(pageLi);
        }

        const nextPageLi = document.createElement('li');
        nextPageLi.classList.add('page-item');
        if (currentPatientsPage === totalPages) nextPageLi.classList.add('disabled');
        nextPageLi.innerHTML = `<a class="page-link" href="#" id="patientNextPage">Próximo</a>`;
        paginationUl.appendChild(nextPageLi);
        if (currentPatientsPage < totalPages) {
            nextPageLi.addEventListener('click', (e) => {
                e.preventDefault();
                currentPatientsPage++;
                renderPage(currentPatientsPage);
            });
        }
    };

    renderPage(currentPatientsPage);
}

// --- Lógica para Popular e Gerenciar a Tabela de Atendimentos ---
let appointmentsListTableBody = null; 
let appointmentFilterStatus = null; 
let appointmentFilterProfessional = null; 
let appointmentStartDateFilter = null; 
let appointmentEndDateFilter = null; 
let appointmentSearchInput = null; 
let appointmentSearchBtn = null; 
let appointmentsPerPageSelect = null; 

async function populateAppointmentsTable(allAppointments) {
    if (!auth.currentUser) {
        appointmentsListTableBody.innerHTML = `<tr><td colspan="8" class="text-center text-muted">Faça login para ver a lista de atendimentos.</td></tr>`;
        document.getElementById('appointmentsPaginationInfo').textContent = 'Mostrando 0 de 0 registros';
        document.getElementById('appointmentsPagination').innerHTML = '';
        return;
    }

    appointmentsListTableBody.innerHTML = '';

    const uniqueStatuses = new Set();
    Object.keys(STATUS_COLORS).forEach(status => uniqueStatuses.add(status));
    allAppointments.forEach(appointment => {
        if (appointment.status) {
            uniqueStatuses.add(appointment.status);
        }
    });

    const currentSelectedStatus = appointmentFilterStatus.value;
    appointmentFilterStatus.innerHTML = '';
    const allOption = document.createElement('option');
    allOption.value = 'Todos';
    allOption.textContent = 'Todos';
    appointmentFilterStatus.appendChild(allOption);

    const sortedStatuses = Array.from(uniqueStatuses).sort();

    sortedStatuses.forEach(status => {
        const option = document.createElement('option');
        option.value = status;
        option.textContent = status;
        appointmentFilterStatus.appendChild(option);
    });
    appointmentFilterStatus.value = currentSelectedStatus;
    if (appointmentFilterStatus.value !== currentSelectedStatus) {
        appointmentFilterStatus.value = 'Todos';
    }


    const filterStatus = appointmentFilterStatus.value;
    const filterProfessional = appointmentFilterProfessional.value;
    const filterStartDate = appointmentStartDateFilter.value;
    const filterEndDate = appointmentEndDateFilter.value;
    const searchQuery = appointmentSearchInput.value.toLowerCase().trim();

    allFilteredAppointments = allAppointments.filter(appointment => {
        if (filterStatus !== 'Todos' && appointment.status !== filterStatus) {
            return false;
        }
        if (filterProfessional !== 'Todos' && appointment.professional !== filterProfessional) {
            return false;
        }
        const appointmentDate = new Date(appointment.date + 'T' + (appointment.startHour || '00:00'));
        if (filterStartDate) {
            const startDate = new Date(filterStartDate + 'T00:00:00');
            if (appointmentDate < startDate) {
                return false;
            }
        }
        if (filterEndDate) {
            const endDate = new Date(filterEndDate + 'T23:59:59');
            if (appointmentDate > endDate) {
                return false;
            }
        }
        if (searchQuery && !(appointment.patient && appointment.patient.toLowerCase().includes(searchQuery))) {
            return false;
        }
        return true;
    });

    allFilteredAppointments.sort((a, b) => {
        const dateA = a.date && a.startHour ? new Date(a.date + 'T' + (a.startHour || '00:00')) : new Date(0);
        const dateB = b.date && b.startHour ? new Date(b.date + 'T' + (b.startHour || '00:00')) : new Date(0);

        if (dateA.getTime() !== dateB.getTime()) {
            return dateB.getTime() - dateA.getTime();
        }

        const createdAtA = a.createdAt && a.createdAt.toDate ? a.createdAt.toDate() : new Date(0);
        const createdAtB = b.createdAt && b.createdAt.toDate ? b.createdAt.toDate() : new Date(0);
        return createdAtB.getTime() - createdAtA.getTime();
    });

    if (allFilteredAppointments.length === 0) {
        const noRecordsRow = appointmentsListTableBody.insertRow();
        noRecordsRow.innerHTML = `<td colspan="8" class="text-center text-muted">Nenhum atendimento encontrado com os filtros aplicados.</td>`;
        document.getElementById('appointmentsPaginationInfo').textContent = 'Mostrando 0 de 0 registros';
        document.getElementById('appointmentsPagination').innerHTML = '';
        return;
    }

    appointmentsItemsPerPage = parseInt(appointmentsPerPageSelect.value);

    const totalPages = Math.ceil(allFilteredAppointments.length / appointmentsItemsPerPage);
    if (currentAppointmentsPage > totalPages) {
        currentAppointmentsPage = totalPages > 0 ? totalPages : 1;
    }
    if (currentAppointmentsPage < 1 && totalPages > 0) {
        currentAppointmentsPage = 1;
    } else if (totalPages === 0) {
        currentAppointmentsPage = 1;
    }

    const renderPage = (page) => {
        appointmentsListTableBody.innerHTML = '';
        const startIndex = (page - 1) * appointmentsItemsPerPage;
        const endIndex = Math.min(startIndex + appointmentsItemsPerPage, allFilteredAppointments.length);
        const paginatedItems = allFilteredAppointments.slice(startIndex, endIndex);

        paginatedItems.forEach(appointment => {
            const row = appointmentsListTableBody.insertRow();
            const formattedDate = new Date(appointment.date).toLocaleDateString('pt-BR');

            const statusColor = STATUS_COLORS[appointment.status] || '#6c757d';

            row.innerHTML = `
                <td>${formattedDate}</td>
                <td>${appointment.startHour}${appointment.endHour ? ' - ' + appointment.endHour : ''}</td>
                <td>${appointment.patient || 'N/A'}</td>
                <td>${appointment.professional || 'N/A'}</td>
                <td><span class="badge" style="background-color: ${statusColor}; color: white;">${appointment.status || 'N/A'}</span></td>
                <td>${appointment.agreement || 'N/A'}</td>
                <td>${appointment.procedure || 'N/A'}</td>
                <td>
                    <button type="button" class="btn btn-sm btn-outline-info view-appointment-detail-btn" data-id="${appointment.id}">
                        <i class="fas fa-eye"></i> Detalhes
                    </button>
                    <button type="button" class="btn btn-sm btn-outline-primary edit-appointment-table-btn" data-id="${appointment.id}">
                        <i class="fas fa-edit"></i> Editar
                    </button>
                    ${appointment.repeatConfig ? `<button type="button" class="btn btn-sm btn-outline-success renew-repeat-btn" data-id="${appointment.id}">
                        <i class="fas fa-sync-alt"></i> Renovar Repetição
                    </button>` : ''}
                </td>
            `;

            row.querySelector('.view-appointment-detail-btn').addEventListener('click', async (e) => {
                if (!auth.currentUser) {
                    Swal.fire('Acesso Negado', 'Você precisa estar logado para ver detalhes do atendimento.', 'warning');
                    return;
                }
                const aptId = e.currentTarget.dataset.id;
                const apt = await getAppointmentByIdFB(aptId);
                if (apt) {
                    document.getElementById('viewAppointmentTime').textContent = `${apt.startHour} - ${apt.endHour || 'N/A'}`;
                    document.getElementById('viewProfessionalName').textContent = apt.professional || 'Não informado';
                    document.getElementById('viewPatientName').textContent = apt.patient || 'Não informado';
                    document.getElementById('viewCellphone').textContent = apt.cellphone || 'Não informado';
                    document.getElementById('viewAgreement').textContent = apt.agreement || 'Não informado';
                    document.getElementById('viewStatusSelect').value = apt.status || 'Agendado';
                    document.getElementById('viewAuthCode').textContent = apt.authCode || 'Não informado';

                    document.getElementById('editAppointmentBtn').dataset.id = apt.id;
                    document.getElementById('deleteAppointmentViewBtn').dataset.id = apt.id;
                    document.getElementById('startServiceBtn').dataset.id = apt.id;

                    const startEvaluationBtn = document.getElementById('startEvaluationBtn');
                    if (startEvaluationBtn) {
                        startEvaluationBtn.dataset.id = apt.id;
                        startEvaluationBtn.dataset.patientId = apt.patientId;
                    }
                    const startEvolutionBtn = document.getElementById('startEvolutionBtn');
                    if (startEvolutionBtn) {
                        startEvolutionBtn.dataset.id = apt.id;
                        startEvolutionBtn.dataset.patientId = apt.patientId;
                    }
                    const renewRepeatBtnView = document.getElementById('renewRepeatBtnView');
                    if (apt.repeatConfig) {
                        if (renewRepeatBtnView) {
                            renewRepeatBtnView.style.display = 'inline-block';
                            renewRepeatBtnView.dataset.id = apt.id;
                        }
                    } else {
                        if (renewRepeatBtnView) {
                            renewRepeatBtnView.style.display = 'none';
                            renewRepeatBtnView.removeAttribute('data-id');
                        }
                    }
                     if (renewRepeatBtnView) {
                        renewRepeatBtnView.onclick = async () => {
                            if (!auth.currentUser) {
                                Swal.fire('Acesso Negado', 'Você precisa estar logado para renovar repetições.', 'warning');
                                return;
                            }
                            const aptIdToRenew = renewRepeatBtnView.dataset.id;
                            viewAppointmentModalInstance.hide();
                            await openRepeatRenewalModal(aptIdToRenew);
                        };
                    }
                    viewAppointmentModalInstance.show();
                } else {
                    Swal.fire('Erro!', 'Agendamento não encontrado.', 'error');
                }
            });

            row.querySelector('.edit-appointment-table-btn').addEventListener('click', async (e) => {
                if (!auth.currentUser) {
                    Swal.fire('Acesso Negado', 'Você precisa estar logado para editar atendimentos.', 'warning');
                    return;
                }
                const aptId = e.currentTarget.dataset.id;
                const apt = await getAppointmentByIdFB(aptId);
                if (apt) {
                    document.getElementById('appointmentId').value = apt.id;
                    document.getElementById('appointmentDate').value = apt.date;
                    document.getElementById('appointmentStartHour').value = apt.startHour;
                    document.getElementById('appointmentEndHour').value = apt.endHour || '';
                    document.getElementById('professional').value = apt.professional || '';
                    document.getElementById('patient').value = apt.patient || '';
                    document.getElementById('agreement').value = apt.agreement || 'Particular';
                    document.getElementById('authCode').value = apt.authCode || '';
                    document.getElementById('procedure').value = apt.procedure || '';

                    populateAppointmentModalStatusSelect();
                    document.getElementById('status').value = apt.status || 'Agendado';

                    document.getElementById('room').value = apt.room || '';
                    document.getElementById('cellphone').value = apt.cellphone || '';
                    document.getElementById('smsReminder').value = apt.smsReminder || 'Sem lembrete';
                    document.getElementById('whatsappReminder').value = apt.whatsappReminder || 'Sem lembrete';
                    document.getElementById('observations').value = apt.observations || '';
                    document.getElementById('realizeFitment').checked = apt.realizeFitment || false;
                    document.getElementById('launchFinancial').checked = apt.launchFinancial || false;
                    document.getElementById('repeatAppointment').checked = apt.repeatAppointment || false;
                    repeatConfig = apt.repeatConfig || null;

                    document.getElementById('patientIdForAppointment').value = apt.patientId || '';

                    patientInfoMessage.classList.add('d-none');
                    patientSuggestions.innerHTML = '';

                    document.getElementById('appointmentModalLabel').textContent = 'Editar Agendamento';
                    const deleteBtn = document.getElementById('deleteAppointmentBtn');
                    if (deleteBtn) {
                        deleteBtn.style.display = 'inline-block';
                    }
                    appointmentModalInstance.show();
                } else {
                    Swal.fire('Erro!', 'Agendamento não encontrado.', 'error');
                }
            });

            const renewRepeatBtn = row.querySelector('.renew-repeat-btn');
            if (renewRepeatBtn) {
                renewRepeatBtn.addEventListener('click', async (e) => {
                    if (!auth.currentUser) {
                        Swal.fire('Acesso Negado', 'Você precisa estar logado para renovar repetições.', 'warning');
                        return;
                    }
                    const aptId = e.currentTarget.dataset.id;
                    await openRepeatRenewalModal(aptId);
                });
            }
        });

        const currentDisplayedCount = paginatedItems.length;
        const totalFilteredCount = allFilteredAppointments.length;
        document.getElementById('appointmentsPaginationInfo').textContent =
            `Mostrando de ${startIndex + 1} até ${startIndex + currentDisplayedCount} de ${totalFilteredCount} registros`;

        const paginationUl = document.getElementById('appointmentsPagination');
        paginationUl.innerHTML = '';

        const prevPageLi = document.createElement('li');
        prevPageLi.classList.add('page-item');
        if (currentAppointmentsPage === 1) prevPageLi.classList.add('disabled');
        prevPageLi.innerHTML = `<a class="page-link" href="#" id="appointmentsPrevPage">Anterior</a>`;
        paginationUl.appendChild(prevPageLi);
        if (currentAppointmentsPage > 1) {
            prevPageLi.addEventListener('click', (e) => {
                e.preventDefault();
                currentAppointmentsPage--;
                renderPage(currentAppointmentsPage);
            });
        }

        for (let i = 1; i <= totalPages; i++) {
            const pageLi = document.createElement('li');
            pageLi.classList.add('page-item');
            if (i === currentAppointmentsPage) pageLi.classList.add('active');
            pageLi.innerHTML = `<a class="page-link" href="#">${i}</a>`;
            pageLi.addEventListener('click', (e) => {
                e.preventDefault();
                currentAppointmentsPage = i;
                renderPage(currentAppointmentsPage);
            });
            paginationUl.appendChild(pageLi);
        }

        const nextPageLi = document.createElement('li');
        nextPageLi.classList.add('page-item');
        if (currentAppointmentsPage === totalPages) nextPageLi.classList.add('disabled');
        nextPageLi.innerHTML = `<a class="page-link" href="#" id="appointmentsNextPage">Próximo</a>`;
        paginationUl.appendChild(nextPageLi);
        if (currentAppointmentsPage < totalPages) {
            nextPageLi.addEventListener('click', (e) => {
                e.preventDefault();
                currentAppointmentsPage++;
                renderPage(currentAppointmentsPage);
            });
        }
    };

    renderPage(currentAppointmentsPage);
}

// --- Lógica para Popular e Gerenciar a Tabela de Lembretes ---
let remindersListTableBody, reminderFilterStatus, reminderFilterPatientName, reminderFilterStartDate, reminderFilterEndDate;

/**
 * **[CORREÇÃO APLICADA]**
 * A função foi ajustada para ler a propriedade `sendAt` (camelCase) em vez de `sendat`.
 * Adicionada maior robustez para lidar com lembretes inválidos no array.
 */
function populateRemindersTable(allReminders) {
    if (!remindersListTableBody) return;

    const statusFilter = reminderFilterStatus.value;
    const patientNameFilter = reminderFilterPatientName.value.toLowerCase().trim();
    const startDateFilter = reminderFilterStartDate.value;
    const endDateFilter = reminderFilterEndDate.value;

    const filteredReminders = allReminders.filter(reminder => {
        // Validação para garantir que o lembrete é um objeto válido com as propriedades necessárias
        if (!reminder || typeof reminder.message !== 'string' || !reminder.sendAt) {
            return false; // Ignora lembretes inválidos ou sem data de envio
        }

        if (statusFilter !== 'Todos' && reminder.status !== statusFilter) {
            return false;
        }

        // Usa a propriedade correta 'sendAt'
        const reminderDate = new Date(reminder.sendAt);
        if (startDateFilter && reminderDate < new Date(startDateFilter + 'T00:00:00Z')) return false;
        if (endDateFilter && reminderDate > new Date(endDateFilter + 'T23:59:59Z')) return false;

        // Extrai o nome do paciente da mensagem
        const match = reminder.message.match(/\*([^*]+)\*/);
        const patientName = match ? match[1].toLowerCase() : 'n/a';
        if (patientNameFilter && !patientName.includes(patientNameFilter)) {
            return false;
        }

        return true;
    });

    remindersListTableBody.innerHTML = '';

    if (filteredReminders.length === 0) {
        remindersListTableBody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">Nenhum lembrete encontrado com os filtros aplicados.</td></tr>';
        return;
    }

    // Ordena os lembretes por data de envio, do mais recente para o mais antigo
    filteredReminders.sort((a, b) => new Date(b.sendAt) - new Date(a.sendAt));

    filteredReminders.forEach(reminder => {
        const row = remindersListTableBody.insertRow();
        
        // Usa a propriedade correta 'sendAt'
        const sendAtDate = new Date(reminder.sendAt);
        const formattedDate = sendAtDate.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'medium' });
        
        const patientMatch = reminder.message.match(/\*([^*]+)\*/);
        const patientName = patientMatch ? patientMatch[1] : 'Envio Imediato';
        
        const getStatusBadge = (status) => {
            switch(status) {
                case 'enviado': return `<span class="badge bg-success">Enviado</span>`;
                case 'agendado': return `<span class="badge bg-primary">Agendado</span>`;
                case 'cancelado': return `<span class="badge bg-secondary">Cancelado</span>`;
                case 'falhou': return `<span class="badge bg-danger">Falhou</span>`;
                default: return `<span class="badge bg-dark">${status || 'desconhecido'}</span>`;
            }
        };

        row.innerHTML = `
            <td>${getStatusBadge(reminder.status)}</td>
            <td>${patientName}</td>
            <td>${formattedDate}</td>
            <td><small>${reminder.message.substring(0, 50)}...</small></td>
            <td>
                ${reminder.status === 'agendado' ? 
                `<button class="btn btn-sm btn-outline-danger cancel-reminder-btn" data-id="${reminder.id}"><i class="fas fa-times"></i> Cancelar</button>` : 
                 '-'}
            </td>
        `;

        const cancelBtn = row.querySelector('.cancel-reminder-btn');
        if(cancelBtn) {
            cancelBtn.addEventListener('click', async (e) => {
                const reminderId = e.currentTarget.dataset.id;
                Swal.fire({
                    title: 'Tem certeza?',
                    text: "Deseja cancelar o envio deste lembrete?",
                    icon: 'warning',
                    showCancelButton: true,
                    confirmButtonColor: '#d33',
                    confirmButtonText: 'Sim, cancelar!',
                    cancelButtonText: 'Não'
                }).then(async (result) => {
                    if (result.isConfirmed) {
                        await cancelWhatsappReminder(reminderId);
                        Swal.fire('Cancelado!', 'O lembrete foi cancelado.', 'success');
                        // Atualiza a tabela
                        const updatedReminders = await getWhatsappReminders();
                        populateRemindersTable(updatedReminders);
                    }
                });
            });
        }
    });
}


// Função para popular o quadro do prontuário
async function populatePatientRecord(patientId) {
    const patient = await getPatientByIdFB(patientId);
    if (!patient) {
        Swal.fire('Erro!', 'Paciente não encontrado para carregar o prontuário.', 'error');
        return;
    }

    document.getElementById('recordPatientNameHeader').textContent = patient.name || 'Paciente';
    document.getElementById('recordPatientNameSidebar').textContent = patient.name || 'Paciente';
    document.getElementById('recordPatientId').textContent = patient.id || 'N/A';
    document.getElementById('incompletePatientName').textContent = patient.name || 'o paciente';
    document.getElementById('currentRecordPatientName').textContent = patient.name || 'Patrick';

    document.getElementById('recordPatientPhone').textContent = patient.cellphone || 'Não informado';
    document.getElementById('recordPatientBirthDate').textContent = patient.birthDate || 'Não informado';
    document.getElementById('recordPatientGender').textContent = patient.gender || 'Não informado';
    document.getElementById('recordPatientAddress').textContent = patient.address || 'Não informado';

    document.getElementById('editPatientFromRecordBtn').onclick = () => {
        if (!auth.currentUser) {
            Swal.fire('Acesso Negado', 'Você precisa estar logado para editar pacientes.', 'warning');
            return;
        }
        if (patient && patient.id) {
            document.getElementById('patientDetailsId').value = patient.id;
            document.getElementById('patientDetailsName').value = patient.name || '';
            document.getElementById('patientDetailsCellphone').value = patient.cellphone || ''; 
            document.getElementById('patientDetailsBirthDate').value = patient.birthDate || '';
            document.getElementById('patientDetailsCpf').value = patient.cpf || '';
            document.getElementById('patientDetailsCity').value = patient.city || '';
            document.getElementById('patientDetailsAgreement').value = patient.agreement || 'Particular';
            document.getElementById('patientDetailsAddress').value = patient.address || '';
            document.getElementById('patientDetailsObservations').value = patient.observations || '';
            document.getElementById('patientDetailsIsArchived').checked = patient.isArchived || false;

            document.getElementById('patientDetailsModalLabel').textContent = 'Editar Paciente';
            patientFormModalInstance.show();
        } else {
            Swal.fire('Erro!', 'Dados do paciente não encontrados para edição.', 'error');
        }
    };

    document.getElementById('completePatientRegistrationBtn').onclick = () => {
        if (!auth.currentUser) {
            Swal.fire('Acesso Negado', 'Você precisa estar logado para completar o cadastro do paciente.', 'warning');
            return;
        }
        if (patient && patient.id) {
            document.getElementById('patientDetailsId').value = patient.id;
            document.getElementById('patientDetailsName').value = patient.name || '';
            document.getElementById('patientDetailsCellphone').value = patient.cellphone || ''; 
            document.getElementById('patientDetailsBirthDate').value = patient.birthDate || '';
            document.getElementById('patientDetailsCpf').value = patient.cpf || '';
            document.getElementById('patientDetailsCity').value = patient.city || '';
            document.getElementById('patientDetailsAgreement').value = patient.agreement || 'Particular';
            document.getElementById('patientDetailsAddress').value = patient.address || '';
            document.getElementById('patientDetailsObservations').value = patient.observations || '';
            document.getElementById('patientDetailsIsArchived').checked = patient.isArchived || false;

            document.getElementById('patientDetailsModalLabel').textContent = 'Completar Cadastro do Paciente';
            patientFormModalInstance.show();
        } else {
            Swal.fire('Erro!', 'Dados do paciente não encontrados para completar o cadastro.', 'error');
        }
    };


    const recordTimeline = document.getElementById('recordTimeline');
    recordTimeline.innerHTML = '';

    const patientEvaluationsQuery = query(evaluationsCollection, where("patientId", "==", patientId), where("userId", "==", auth.currentUser.uid));
    const patientEvaluationsSnapshot = await getDocs(patientEvaluationsQuery);
    const patientEvaluations = patientEvaluationsSnapshot.docs.map(doc => ({ id: doc.id, type: 'evaluation', ...doc.data() }));

    const patientEvolutionsQuery = query(evolutionsCollection, where("patientId", "==", patientId), where("userId", "==", auth.currentUser.uid));
    const patientEvolutionsSnapshot = await getDocs(patientEvolutionsQuery);
    const patientEvolutions = patientEvolutionsSnapshot.docs.map(doc => ({ id: doc.id, type: 'evolution', ...doc.data() }));

    const patientAppointmentsQuery = query(appointmentsCollection, where("patientId", "==", patientId), where("userId", "==", auth.currentUser.uid));
    const patientAppointmentsSnapshot = await getDocs(patientAppointmentsQuery);
    const patientAppointments = patientAppointmentsSnapshot.docs.map(doc => ({ id: doc.id, type: 'appointment', ...doc.data() }));


    const allPatientRecords = [...patientEvaluations, ...patientEvolutions, ...patientAppointments].sort((a, b) => {
        const dateA = a.date && a.startHour ? new Date(a.date + 'T' + a.startHour) : new Date(0);
        const dateB = b.date && b.startHour ? new Date(b.date + 'T' + b.startHour) : new Date(0);

        if (dateA.getTime() !== dateB.getTime()) {
            return dateB.getTime() - dateA.getTime();
        }

        const createdAtA = a.createdAt && a.createdAt.toDate ? a.createdAt.toDate() : new Date(0);
        const createdAtB = b.createdAt && b.createdAt.toDate ? b.createdAt.toDate() : new Date(0);
        return createdAtB.getTime() - createdAtA.getTime();
    });

    if (allPatientRecords.length === 0) {
        recordTimeline.innerHTML = '<p class="text-center text-muted">Nenhum histórico encontrado para este paciente.</p>';
        return;
    }


    for (const record of allPatientRecords) {
        const recordDate = new Date(record.date);
        const formattedDate = recordDate.toLocaleDateString('pt-BR');


        let correspondingAppointment = null;
        if (record.appointmentId) {
            correspondingAppointment = await getAppointmentByIdFB(record.appointmentId);
        } else if (record.type === 'appointment') {
            correspondingAppointment = record;
        }
        const displayProfessionalName = correspondingAppointment ? correspondingAppointment.professional : (record.professional || 'Não informado');

        if (record.type === 'evaluation') {
            const evaluationCard = document.createElement('div');
            evaluationCard.className = 'timeline-item mb-3';
            evaluationCard.innerHTML = `
                <div class="timeline-badge bg-warning text-white rounded-pill px-2 py-1 mb-2">
                    ${formattedDate}
                </div>
                <div class="card shadow-sm">
                    <div class="card-body">
                        <div class="d-flex justify-content-between align-items-center mb-2">
                            <h6 class="mb-0"><i class="fas fa-check-circle text-success me-2"></i>Avaliação</h6>
                            <div>
                                <button type="button" class="btn btn-sm btn-outline-primary me-1 edit-record-evaluation-btn" data-id="${record.id}" data-appointment-id="${record.appointmentId}" data-patient-id="${patient.id}">
                                    <i class="fas fa-edit"></i>
                                </button>
                                <button type="button" class="btn btn-sm btn-outline-danger delete-record-evaluation-btn" data-id="${record.id}" data-patient-id="${patient.id}">
                                    <i class="fas fa-trash"></i>
                                </button>
                            </div>
                        </div>
                        <p class="card-text mb-1">Data: ${formattedDate} ${record.startHour}</p>
                        <p class="card-text mb-1">Profissional: ${displayProfessionalName}</p>
                        <p class="card-text mb-1">Convênio: ${record.agreement || 'Não informado'}</p>
                        <p class="card-text mb-1">Senha/Autorização/Autenticador: ${record.authCode || 'Não informado'}</p>
                        <div class="mt-2">
                            <button type="button" class="btn btn-sm btn-success me-2 view-evaluation-detail-btn" data-id="${record.id}" data-appointment-id="${record.appointmentId}" data-patient-id="${patient.id}">
                                <i class="fas fa-eye"></i> Ver avaliação
                            </button>
                            <button type="button" class="btn btn-sm btn-outline-secondary">
                                <i class="fas fa-file-alt"></i> Plano de tratamento
                            </button>
                        </div>
                    </div>
                </div>
            `;
            recordTimeline.appendChild(evaluationCard);

            evaluationCard.querySelector('.view-evaluation-detail-btn').addEventListener('click', async (e) => {
                if (!auth.currentUser) {
                    Swal.fire('Acesso Negado', 'Você precisa estar logado para ver detalhes da avaliação.', 'warning');
                    return;
                }
                const evalId = e.currentTarget.dataset.id;
                const aptId = e.currentTarget.dataset.appointmentId;
                const patId = e.currentTarget.dataset.patientId;
                patientRecordSection.classList.add('d-none');
                await openDetailedEvaluationModal(evalId, aptId, patId);
            });
            evaluationCard.querySelector('.edit-record-evaluation-btn').addEventListener('click', async (e) => {
                if (!auth.currentUser) {
                    Swal.fire('Acesso Negado', 'Você precisa estar logado para editar avaliações.', 'warning');
                    return;
                }
                const evalId = e.currentTarget.dataset.id;
                const aptId = e.currentTarget.dataset.appointmentId;
                const patId = e.currentTarget.dataset.patientId;
                patientRecordSection.classList.add('d-none');
                await openEvaluationModal(aptId, patId, evalId);
            });
            evaluationCard.querySelector('.delete-record-evaluation-btn').addEventListener('click', async (e) => {
                if (!auth.currentUser) {
                    Swal.fire('Acesso Negado', 'Você precisa estar logado para excluir avaliações.', 'warning');
                    return;
                }
                const evalId = e.currentTarget.dataset.id;
                const patId = e.currentTarget.dataset.patientId;
                Swal.fire({
                    title: 'Tem certeza?',
                    text: "Você não poderá reverter isso!",
                    icon: 'warning',
                    showCancelButton: true,
                    confirmButtonColor: '#d33',
                    cancelButtonColor: '#3085d6',
                    confirmButtonText: 'Sim, excluir!',
                    cancelButtonText: 'Cancelar'
                }).then(async (result) => {
                    if (result.isConfirmed) {
                        try {
                            await deleteEvaluationFB(evalId);
                            Swal.fire('Excluído!', 'A avaliação foi excluída.', 'success');
                            await populatePatientRecord(patId);
                        } catch (error) {
                            Swal.fire('Erro!', 'Não foi possível deletar a avaliação. Detalhes: ' + error.message, 'error');
                        }
                    }
                });
            });
        } else if (record.type === 'evolution') {
            const evolutionCard = document.createElement('div');
            evolutionCard.className = 'timeline-item mb-3';
            evolutionCard.innerHTML = `
                <div class="timeline-badge bg-info text-white rounded-pill px-2 py-1 mb-2">
                    ${formattedDate}
                </div>
                <div class="card shadow-sm">
                    <div class="card-body">
                        <div class="d-flex justify-content-between align-items-center mb-2">
                            <h6 class="mb-0"><i class="fas fa-chart-line text-primary me-2"></i>Evolução</h6>
                            <div>
                                <button type="button" class="btn btn-sm btn-outline-primary me-1 edit-record-evolution-btn" data-id="${record.id}" data-appointment-id="${record.appointmentId}" data-patient-id="${patient.id}">
                                    <i class="fas fa-edit"></i>
                                </button>
                                <button type="button" class="btn btn-sm btn-outline-danger delete-record-evolution-btn" data-id="${record.id}" data-patient-id="${patient.id}">
                                    <i class="fas fa-trash"></i>
                                </button>
                            </div>
                        </div>
                        <p class="card-text mb-1">Data: ${formattedDate} ${record.startHour}</p>
                        <p class="card-text mb-1">Profissional: ${displayProfessionalName}</p>
                        <p class="card-text mb-1">Conteúdo: Clique para ver detalhes.</p>
                        <div class="mt-2">
                            <button type="button" class="btn btn-sm btn-info me-2 view-evolution-detail-btn" data-id="${record.id}" data-appointment-id="${record.appointmentId}" data-patient-id="${patient.id}">
                                <i class="fas fa-eye"></i> Ver evolução
                            </button>
                        </div>
                    </div>
                </div>
            `;
            recordTimeline.appendChild(evolutionCard);

            evolutionCard.querySelector('.view-evolution-detail-btn').addEventListener('click', async (e) => {
                if (!auth.currentUser) {
                    Swal.fire('Acesso Negado', 'Você precisa estar logado para ver detalhes da evolução.', 'warning');
                    return;
                }
                const evolId = e.currentTarget.dataset.id;
                const aptId = e.currentTarget.dataset.appointmentId;
                const patId = e.currentTarget.dataset.patientId;
                patientRecordSection.classList.add('d-none');
                await openDetailedEvolutionModal(evolId, aptId, patId);
            });
            evolutionCard.querySelector('.edit-record-evolution-btn').addEventListener('click', async (e) => {
                if (!auth.currentUser) {
                    Swal.fire('Acesso Negado', 'Você precisa estar logado para editar evoluções.', 'warning');
                    return;
                }
                const evolId = e.currentTarget.dataset.id;
                const aptId = e.currentTarget.dataset.appointmentId;
                const patId = e.currentTarget.dataset.patientId;
                patientRecordSection.classList.add('d-none');
                await openEvolutionModal(aptId, patId, evolId);
            });
            evolutionCard.querySelector('.delete-record-evolution-btn').addEventListener('click', async (e) => {
                if (!auth.currentUser) {
                    Swal.fire('Acesso Negado', 'Você precisa estar logado para excluir evoluções.', 'warning');
                    return;
                }
                const evolId = e.currentTarget.dataset.id;
                const patId = e.currentTarget.dataset.patientId;
                Swal.fire({
                    title: 'Tem certeza?',
                    text: "Você não poderá reverter isso!",
                    icon: 'warning',
                    showCancelButton: true,
                    confirmButtonColor: '#d33',
                    cancelButtonColor: '#3085d6',
                    confirmButtonText: 'Sim, excluir!',
                    cancelButtonText: 'Cancelar'
                }).then(async (result) => {
                    if (result.isConfirmed) {
                        try {
                            await deleteEvolutionFB(evolId);
                            Swal.fire('Excluído!', 'A evolução foi excluída.', 'success');
                            await populatePatientRecord(patId);
                        } catch (error) {
                            Swal.fire('Erro!', 'Não foi possível deletar a evolução. Tente novamente. Detalhes: ' + error.message, 'error');
                        }
                    }
                });
            });
        } else if (record.type === 'appointment') {
            let statusBadgeClass = 'bg-secondary';
            let statusIcon = 'fas fa-info-circle';

            switch (record.status) {
                case 'Agendado':
                    statusBadgeClass = 'bg-primary';
                    statusIcon = 'fas fa-calendar-check';
                    break;
                case 'Confirmado':
                    statusBadgeClass = 'bg-warning';
                    statusIcon = 'fas fa-check';
                    break;
                case 'Atendido':
                    statusBadgeClass = 'bg-success';
                    statusIcon = 'fas fa-clipboard-check';
                    break;
                case 'Cancelado':
                    statusBadgeClass = 'bg-danger';
                    statusIcon = 'fas fa-times';
                    break;
                case 'Faltou':
                    statusBadgeClass = 'bg-dark';
                    statusIcon = 'fas fa-user-times';
                    break;
                case 'Remarcar':
                    statusBadgeClass = 'bg-primary';
                    statusIcon = 'fas fa-redo';
                    break;
                case 'Não atendido (Sem cobrança)':
                    statusBadgeClass = 'bg-secondary';
                    statusIcon = 'fas fa-minus-circle';
                    break;
                case 'Bloqueado':
                    statusBadgeClass = 'bg-secondary';
                    statusIcon = 'fas fa-lock';
                    break;
                default:
                    statusBadgeClass = 'bg-secondary';
                    statusIcon = 'fas fa-info-circle';
            }

            const appointmentCard = document.createElement('div');
            appointmentCard.className = 'timeline-item mb-3';
            appointmentCard.innerHTML = `
                <div class="timeline-badge ${statusBadgeClass} text-white rounded-pill px-2 py-1 mb-2">
                    ${formattedDate} - ${record.status}
                </div>
                <div class="card shadow-sm">
                    <div class="card-body">
                        <div class="d-flex justify-content-between align-items-center mb-2">
                            <h6 class="mb-0"><i class="${statusIcon} me-2"></i>Agendamento</h6>
                            <div>
                                <button type="button" class="btn btn-sm btn-outline-primary me-1 edit-record-appointment-btn" data-id="${record.id}">
                                    <i class="fas fa-edit"></i>
                                </button>
                                <button type="button" class="btn btn-sm btn-outline-danger delete-record-appointment-btn" data-id="${record.id}" data-patient-id="${patient.id}">
                                    <i class="fas fa-trash"></i>
                                </button>
                            </div>
                        </div>
                        <p class="card-text mb-1">Horário: ${record.startHour}${record.endHour ? ' - ' + record.endHour : ''}</p>
                        <p class="card-text mb-1">Profissional: ${record.professional || 'Não informado'}</p>
                        <p class="card-text mb-1">Convênio: ${record.agreement || 'Não informado'}</p>
                        <p class="card-text mb-1">Status: ${record.status || 'Não informado'}</p>
                        <div class="mt-2">
                            <button type="button" class="btn btn-sm btn-secondary me-2 view-appointment-detail-btn" data-id="${record.id}">
                                <i class="fas fa-eye"></i> Ver detalhes
                            </button>
                            ${record.repeatConfig ? `<button type="button" class="btn btn-sm btn-outline-success renew-repeat-btn-record" data-id="${record.id}">
                                <i class="fas fa-sync-alt"></i> Renovar Repetição
                            </button>` : ''}
                        </div>
                    </div>
                </div>
            `;
            recordTimeline.appendChild(appointmentCard);

            appointmentCard.querySelector('.view-appointment-detail-btn').addEventListener('click', async (e) => {
                if (!auth.currentUser) {
                    Swal.fire('Acesso Negado', 'Você precisa estar logado para ver detalhes do atendimento.', 'warning');
                    return;
                }
                const aptId = e.currentTarget.dataset.id;
                const apt = await getAppointmentByIdFB(aptId);
                if (apt) {
                    document.getElementById('viewAppointmentTime').textContent = `${apt.startHour} - ${apt.endHour || 'N/A'}`;
                    document.getElementById('viewProfessionalName').textContent = apt.professional || 'Não informado';
                    document.getElementById('viewPatientName').textContent = apt.patient || 'Não informado';
                    document.getElementById('viewCellphone').textContent = apt.cellphone || 'Não informado';
                    document.getElementById('viewAgreement').textContent = apt.agreement || 'Não informado';
                    document.getElementById('viewStatusSelect').value = apt.status || 'Agendado';
                    document.getElementById('viewAuthCode').textContent = apt.authCode || 'Não informado';

                    document.getElementById('editAppointmentBtn').dataset.id = apt.id;
                    document.getElementById('deleteAppointmentViewBtn').dataset.id = apt.id;
                    document.getElementById('startServiceBtn').dataset.id = apt.id;

                    const startEvaluationBtn = document.getElementById('startEvaluationBtn');
                    if (startEvaluationBtn) {
                        startEvaluationBtn.dataset.id = apt.id;
                        startEvaluationBtn.dataset.patientId = apt.patientId;
                    }
                    const startEvolutionBtn = document.getElementById('startEvolutionBtn');
                    if (startEvolutionBtn) {
                        startEvolutionBtn.dataset.id = apt.id;
                        startEvolutionBtn.dataset.patientId = apt.patientId;
                    }
                    const renewRepeatBtnView = document.getElementById('renewRepeatBtnView');
                    if (apt.repeatConfig) {
                        if (renewRepeatBtnView) {
                            renewRepeatBtnView.style.display = 'inline-block';
                            renewRepeatBtnView.dataset.id = apt.id;
                        }
                    } else {
                        if (renewRepeatBtnView) {
                            renewRepeatBtnView.style.display = 'none';
                            renewRepeatBtnView.removeAttribute('data-id');
                        }
                    }
                     if (renewRepeatBtnView) {
                        renewRepeatBtnView.onclick = async () => {
                            if (!auth.currentUser) {
                                Swal.fire('Acesso Negado', 'Você precisa estar logado para renovar repetições.', 'warning');
                                return;
                            }
                            const aptIdToRenew = renewRepeatBtnView.dataset.id;
                            viewAppointmentModalInstance.hide();
                            await openRepeatRenewalModal(aptIdToRenew);
                        };
                    }
                    viewAppointmentModalInstance.show();
                } else {
                    Swal.fire('Erro!', 'Agendamento não encontrado.', 'error');
                }
            });

            appointmentCard.querySelector('.edit-record-appointment-btn').addEventListener('click', async (e) => {
                if (!auth.currentUser) {
                    Swal.fire('Acesso Negado', 'Você precisa estar logado para editar atendimentos.', 'warning');
                    return;
                }
                const aptId = e.currentTarget.dataset.id;
                const apt = await getAppointmentByIdFB(aptId);
                if (apt) {
                    document.getElementById('appointmentId').value = apt.id;
                    document.getElementById('appointmentDate').value = apt.date;
                    document.getElementById('appointmentStartHour').value = apt.startHour;
                    document.getElementById('appointmentEndHour').value = apt.endHour || '';
                    document.getElementById('professional').value = apt.professional || '';
                    document.getElementById('patient').value = apt.patient || '';
                    document.getElementById('agreement').value = apt.agreement || 'Particular';
                    document.getElementById('authCode').value = apt.authCode || '';
                    document.getElementById('procedure').value = apt.procedure || '';

                    populateAppointmentModalStatusSelect();
                    document.getElementById('status').value = apt.status || 'Agendado';

                    document.getElementById('room').value = apt.room || '';
                    document.getElementById('cellphone').value = apt.cellphone || '';
                    document.getElementById('smsReminder').value = apt.smsReminder || 'Sem lembrete';
                    document.getElementById('whatsappReminder').value = apt.whatsappReminder || 'Sem lembrete';
                    document.getElementById('observations').value = apt.observations || '';
                    document.getElementById('realizeFitment').checked = apt.realizeFitment || false;
                    document.getElementById('launchFinancial').checked = apt.launchFinancial || false;
                    document.getElementById('repeatAppointment').checked = apt.repeatAppointment || false;
                    repeatConfig = apt.repeatConfig || null;

                    document.getElementById('patientIdForAppointment').value = apt.patientId || '';

                    patientInfoMessage.classList.add('d-none');
                    patientSuggestions.innerHTML = '';

                    document.getElementById('appointmentModalLabel').textContent = 'Editar Agendamento';
                    const deleteBtn = document.getElementById('deleteAppointmentBtn');
                    if (deleteBtn) {
                        deleteBtn.style.display = 'inline-block';
                    }
                    appointmentModalInstance.show();
                } else {
                    Swal.fire('Erro!', 'Agendamento não encontrado para edição.', 'error');
                }
            });

            appointmentCard.querySelector('.delete-record-appointment-btn').addEventListener('click', async (e) => {
                if (!auth.currentUser) {
                    Swal.fire('Acesso Negado', 'Você precisa estar logado para excluir agendamentos.', 'warning');
                    return;
                }
                const appointmentId = e.currentTarget.dataset.id;
                const patId = e.currentTarget.dataset.patientId;
                Swal.fire({
                    title: 'Tem certeza?',
                    text: "Você não poderá reverter isso!",
                    icon: 'warning',
                    showCancelButton: true,
                    confirmButtonColor: '#d33',
                    cancelButtonColor: '#3085d6',
                    confirmButtonText: 'Sim, excluir!',
                    cancelButtonText: 'Cancelar'
                }).then(async (result) => {
                    if (result.isConfirmed) {
                        try {
                            await deleteAppointmentFB(appointmentId);
                            Swal.fire('Excluído!', 'O agendamento foi excluído.', 'success');
                            await populatePatientRecord(patId);
                            if (!appointmentsOverviewSection.classList.contains('d-none')) {
                                const updatedAppointments = await getAppointmentsFB();
                                await populateAppointmentsTable(updatedAppointments);
                            }
                            calendar.refetchEvents();
                        } catch (error) {
                            Swal.fire('Erro!', 'Não foi possível deletar o agendamento. Detalhes: ' + error.message, 'error');
                        }
                    }
                });
            });

            const renewRepeatRecordBtn = appointmentCard.querySelector('.renew-repeat-btn-record');
            if (renewRepeatRecordBtn) {
                renewRepeatRecordBtn.addEventListener('click', async (e) => {
                    if (!auth.currentUser) {
                        Swal.fire('Acesso Negado', 'Você precisa estar logado para renovar repetições.', 'warning');
                        return;
                    }
                    const aptId = e.currentTarget.dataset.id;
                    await openRepeatRenewalModal(aptId);
                });
            }
        }
    }
}

// Variáveis para elementos do DOM
let patientInput, patientSuggestions, patientInfoMessage, newPatientNamePlaceholder;
let professionalListUl, professionalSelect, appointmentFilterProfessionalSelect;
let appointmentModalInstance, viewAppointmentModalInstance;
let patientDetailsForm, newPatientBtn;
let agreementSelect;
let blockHourBtn;
let patientSearchInput;

// Referências para os modais de repetição
let repeatRenewalModalElement, repeatRenewalModalInstance;
let repeatSetupModalElement, repeatSetupModalInstance;


const loadPatientSuggestions = async (patientsData) => {
    if (!auth.currentUser) {
        currentPatientList = [];
        return;
    }
    currentPatientList = patientsData || await getPatientsFB();
};

const populateAppointmentModalStatusSelect = () => {
    const statusSelect = document.getElementById('status');
    if (!statusSelect) {
        return;
    }

    const currentSelectedValue = statusSelect.value;
    statusSelect.innerHTML = '';

    const allKnownStatuses = Object.keys(STATUS_COLORS);
    const sortedStatuses = Array.from(allKnownStatuses).sort();

    sortedStatuses.forEach(status => {
        const option = document.createElement('option');
        option.value = status;
        option.textContent = status;
        statusSelect.appendChild(option);
    });

    statusSelect.value = currentSelectedValue || 'Agendado';
};

const populateProcedureSelect = () => {
    const procedureSelect = document.getElementById('procedure');
    if (!procedureSelect) {
        return;
    }
    procedureSelect.innerHTML = ''; 

    const defaultOption = document.createElement('option');
    defaultOption.value = "";
    defaultOption.textContent = "Selecione o procedimento";
    procedureSelect.appendChild(defaultOption);

    PROCEDURE_OPTIONS.forEach(procedure => {
        const option = document.createElement('option');
        option.value = procedure;
        option.textContent = procedure;
        procedureSelect.appendChild(option);
    });
};

async function openRepeatRenewalModal(appointmentId) {
    if (!repeatRenewalModalInstance) {
        Swal.fire('Erro!', 'O modal de renovação de repetição não está pronto.', 'error');
        return;
    }

    const originalAppointment = await getAppointmentByIdFB(appointmentId);

    if (!originalAppointment || !originalAppointment.repeatConfig) {
        Swal.fire('Erro!', 'Agendamento não encontrado ou não possui configuração de repetição para renovar.', 'error');
        return;
    }

    repeatRenewalModalElement.dataset.originalAppointmentId = appointmentId;

    document.getElementById('repeatRenewalFrequency').textContent = originalAppointment.repeatConfig.frequency;
    document.getElementById('repeatRenewalDays').textContent = originalAppointment.repeatConfig.days.join(', ');
    document.getElementById('repeatRenewalSessionCount').textContent = originalAppointment.repeatConfig.sessions;
    
    document.getElementById('newRepeatSessionCount').value = originalAppointment.repeatConfig.sessions;

    repeatRenewalModalInstance.show();
}

function openRepeatSetupModal() {
    if (!repeatSetupModalInstance) {
        Swal.fire('Erro!', 'O modal de configuração de repetição não está pronto.', 'error');
        return;
    }
    document.getElementById('repeatSetupForm').reset();
    repeatSetupModalInstance.show();
}

async function startRepetitionForExistingAppointment(appointmentId) {
    if (!repeatSetupModalInstance) {
        Swal.fire('Erro!', 'O modal de configuração de repetição não está pronto.', 'error');
        return;
    }
    repeatSetupModalElement.dataset.baseAppointmentId = appointmentId;
    document.getElementById('repeatSetupForm').reset();
    repeatSetupModalInstance.show();
}


// =====================================================================
// Início do DOMContentLoaded
// =====================================================================
document.addEventListener('DOMContentLoaded', async () => {
    // --- INICIALIZAÇÃO DAS REFERÊNCIAS DO DOM ---
    mainSidebar = document.getElementById('mainSidebar');
    agendaSection = document.getElementById('agendaSection');
    patientsSection = document.getElementById('patientsSection');
    patientRecordSection = document.getElementById('patientRecordSection');
    appointmentsOverviewSection = document.getElementById('appointmentsOverviewSection');
    remindersSection = document.getElementById('remindersSection');

    logoutBtn = document.getElementById('logoutBtn');
    eventTooltip = document.getElementById('eventTooltip');

    const backToCalendarBtn = document.getElementById('backToCalendarBtn');
    const addProfessionalNavBtn = document.getElementById('addProfessionalNavBtn');
    const sidebarAgendaBtn = document.getElementById('sidebarAgendaBtn');
    const sidebarPatientsBtn = document.getElementById('sidebarPatientsBtn');
    const sidebarAppointmentsBtn = document.getElementById('sidebarAppointmentsBtn');
    const sidebarRemindersBtn = document.getElementById('sidebarRemindersBtn');
    const sidebarWhatsappBtn = document.getElementById('sidebarWhatsappBtn');
    const viewCalendarBtn = document.getElementById('viewCalendarRecordBtn');
    const backBtn = document.getElementById('backFromRecordBtn');

    const refreshPatientsBtn = document.getElementById('refreshPatientsBtn');
    const refreshAppointmentsBtn = document.getElementById('refreshAppointmentsBtn');

    patientListTableBody = document.getElementById('patientListTableBody');
    const patientFormModalElement = document.getElementById('patientFormModal');
    patientFormModalInstance = patientFormModalElement ? new bootstrap.Modal(patientFormModalElement) : null;
    patientDetailsForm = document.getElementById('patientDetailsForm');
    newPatientBtn = document.getElementById('newPatientBtn');
    patientSearchInput = document.getElementById('patientSearchInput');
    patientsPerPageSelect = document.getElementById('patientsPerPage');

    appointmentsListTableBody = document.getElementById('appointmentsListTableBody');
    appointmentFilterStatus = document.getElementById('appointmentFilterStatus');
    appointmentFilterProfessional = document.getElementById('appointmentFilterProfessional');
    appointmentStartDateFilter = document.getElementById('appointmentStartDateFilter');
    appointmentEndDateFilter = document.getElementById('appointmentEndDateFilter');
    appointmentSearchInput = document.getElementById('appointmentSearchInput');
    appointmentSearchBtn = document.getElementById('appointmentSearchBtn');
    appointmentsPerPageSelect = document.getElementById('appointmentsPerPage');

    remindersListTableBody = document.getElementById('remindersListTableBody');
    reminderFilterStatus = document.getElementById('reminderFilterStatus');
    reminderFilterPatientName = document.getElementById('reminderFilterPatientName');
    reminderFilterStartDate = document.getElementById('reminderFilterStartDate');
    reminderFilterEndDate = document.getElementById('reminderFilterEndDate');

    patientInput = document.getElementById('patient');
    patientSuggestions = document.getElementById('patientSuggestions');
    patientInfoMessage = document.getElementById('patientInfoMessage');
    newPatientNamePlaceholder = document.getElementById('newPatientNamePlaceholder');

    professionalListUl = document.getElementById('professionalList');
    professionalSelect = document.getElementById('professional');
    appointmentFilterProfessionalSelect = document.getElementById('appointmentFilterProfessional');

    const appointmentModalElement = document.getElementById('appointmentModal');
    appointmentModalInstance = new bootstrap.Modal(appointmentModalElement);
    const viewAppointmentModalElement = document.getElementById('viewAppointmentModal');
    viewAppointmentModalInstance = new bootstrap.Modal(viewAppointmentModalElement);
    const professionalModalElement = document.getElementById('professionalModal');
    const professionalModalInstance = new bootstrap.Modal(professionalModalElement);

    agreementSelect = document.getElementById('agreement');
    blockHourBtn = document.getElementById('blockHourBtn');

    if (evaluationModalElement) {
        evaluationModalInstance = new bootstrap.Modal(evaluationModalElement);
        evaluationForm = document.getElementById('evaluationForm');
    }
    if (detailedEvaluationModalElement) {
        detailedEvaluationModalInstance = new bootstrap.Modal(detailedEvaluationModalElement);
    }
    if (evolutionModalElement) {
        evolutionModalInstance = new bootstrap.Modal(evolutionModalElement);
        evolutionForm = document.getElementById('evolutionForm');
    }
    if (detailedEvolutionModalElement) {
        detailedEvolutionModalInstance = new bootstrap.Modal(detailedEvolutionModalElement);
    }
    
    const whatsappModalElement = document.getElementById('whatsappModal');
    if (whatsappModalElement) {
        whatsappModalElement.addEventListener('show.bs.modal', () => {
            checkWhatsappStatus(); 
            whatsappStatusInterval = setInterval(checkWhatsappStatus, 3000);
        });

        whatsappModalElement.addEventListener('hide.bs.modal', () => {
            if (whatsappStatusInterval) {
                clearInterval(whatsappStatusInterval);
                whatsappStatusInterval = null;
            }
        });

        const checkWhatsappStatusBtn = document.getElementById('checkWhatsappStatusBtn');
        if (checkWhatsappStatusBtn) {
            checkWhatsappStatusBtn.addEventListener('click', checkWhatsappStatus);
        }
        document.getElementById('reconnectWhatsappBtn')?.addEventListener('click', async () => {
             Swal.fire({ title: 'Aguarde...', text: 'Enviando solicitação de reconexão.', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
             try {
                await reconnectWhatsapp();
                Swal.update({text: 'Solicitação enviada. Verifique o status novamente em alguns segundos.'});
                setTimeout(() => {
                    checkWhatsappStatus();
                    Swal.close();
                }, 3000);
             } catch(e) {
                Swal.fire('Erro', `Não foi possível solicitar a reconexão: ${e.message}`, 'error');
             }
        });
    }

    repeatRenewalModalElement = document.getElementById('repeatRenewalModal');
    repeatRenewalModalInstance = repeatRenewalModalElement ? new bootstrap.Modal(repeatRenewalModalElement) : null;
    
    repeatSetupModalElement = document.getElementById('repeatSetupModal');
    repeatSetupModalInstance = repeatSetupModalElement ? new bootstrap.Modal(repeatSetupModalElement) : null;


    quillEditors.mainComplaint = initializeQuillEditor('mainComplaintEditor');
    quillEditors.currentDiseaseHistory = initializeQuillEditor('currentDiseaseHistoryEditor');
    quillEditors.pastMedicalHistory = initializeQuillEditor('pastMedicalHistoryEditor');
    quillEditors.familyHistory = initializeQuillEditor('familyHistoryEditor');
    quillEditors.evaluationObservations = initializeQuillEditor('evaluationObservationsEditor');

    const evolutionContentEditor = document.getElementById('evolutionContentEditor');
    quillEvolutionContent = evolutionContentEditor ? new Quill(evolutionContentEditor, {
        theme: 'snow',
        modules: {
            toolbar: [
                ['bold', 'italic', 'underline'],
                [{ 'list': 'ordered' }, { 'list': 'bullet' }],
                [{ 'align': [] }]
            ]
        }
    }) : null;

    if (eventTooltip) {
        eventTooltip.addEventListener('mouseenter', () => clearTimeout(eventTooltipTimeout));
        eventTooltip.addEventListener('mouseleave', () => {
            eventTooltip.classList.remove('show');
            setTimeout(() => eventTooltip.classList.add('d-none'), 200);
        });
    }

    // --- OBSERVADOR DE ESTADO DE AUTENTICAÇÃO ---
    onAuthStateChanged(auth, async (user) => {
        if (user) {
            // USUÁRIO LOGADO: Inicia a aplicação
            Swal.fire({
                title: 'Carregando dados...', allowOutsideClick: false,
                didOpen: () => Swal.showLoading()
            });

            // Torna a sidebar e o conteúdo principal visíveis
            mainSidebar.classList.remove('d-none');
            showAgendaSection(); // Mostra a agenda por padrão

            // Carrega dados essenciais em paralelo
            await Promise.all([
                loadAndDisplayProfessionals(),
                loadPatientSuggestions(),
            ]);
            
            // Define valores padrão para filtros de data se necessário
            const currentYear = new Date().getFullYear();
            if (appointmentStartDateFilter) appointmentStartDateFilter.value = `${currentYear}-01-01`;
            if (appointmentEndDateFilter) appointmentEndDateFilter.value = `${currentYear + 1}-12-31`;

            // Renderiza o calendário (os eventos serão buscados por sua própria fonte interna)
            if (calendar && !calendar.isInitialized) {
                calendar.render();
            }

            Swal.close();
        } else {
            // USUÁRIO NÃO LOGADO: Redireciona para a página de login
            window.location.href = 'login.html';
        }
    });

    // --- LISTENER DE LOGOUT ---
    if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
            try {
                await signOut(auth);
                // O onAuthStateChanged cuidará do redirecionamento
                Swal.fire('Sucesso!', 'Você foi desconectado.', 'success');
            } catch (error) {
                Swal.fire('Erro!', 'Não foi possível desconectar. Tente novamente.', 'error');
            }
        });
    }

    // --- INICIALIZAÇÃO DO FULLCALENDAR ---
    const calendarEl = document.getElementById('calendar');
    if (calendarEl) {
        calendar = new FullCalendar.Calendar(calendarEl, {
            initialView: 'timeGridWeek',
            locale: 'pt-br',
            headerToolbar: {
                left: 'prev,next today',
                center: 'title',
                right: 'dayGridMonth,timeGridWeek,timeGridDay'
            },
            buttonText: { month: 'Mês', week: 'Semana', day: 'Dia', today: 'Hoje' },
            editable: true,
            selectable: true,
            businessHours: {
                daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
                startTime: '07:00',
                endTime: '20:00'
            },
            slotMinTime: '07:00:00',
            slotMaxTime: '20:00:00',
            scrollTime: '07:00:00',

            events: async (fetchInfo, successCallback, failureCallback) => {
                if (!auth.currentUser) {
                    successCallback([]);
                    return;
                }
                try {
                    const appointments = await getAppointmentsFB();
                    const calendarEvents = appointments.map(app => ({
                        id: app.id,
                        title: `${app.patient} - ${app.professional}`,
                        start: `${app.date}T${app.startHour}`,
                        end: app.endHour ? `${app.date}T${app.endHour}` : null,
                        color: STATUS_COLORS[app.status] || '#6c757d',
                        extendedProps: {
                            professional: app.professional,
                            patient: app.patient,
                            agreement: app.agreement,
                            authCode: app.authCode,
                            procedure: app.procedure,
                            status: app.status,
                            room: app.room,
                            cellphone: app.cellphone,
                            smsReminder: app.smsReminder,
                            whatsappReminder: app.whatsappReminder,
                            observations: app.observations,
                            realizeFitment: app.realizeFitment,
                            launchFinancial: app.launchFinancial,
                            repeatAppointment: app.repeatAppointment,
                            repeatConfig: app.repeatConfig || null,
                            patientId: app.patientId
                        }
                    }));
                    successCallback(calendarEvents);
                } catch (error) {
                    failureCallback(error);
                }
            },
            
            eventDidMount: function(info) {
                if (info.event.extendedProps.status === 'Bloqueado') {
                    return;
                }

                info.el.addEventListener('mouseenter', (e) => {
                    clearTimeout(eventTooltipTimeout);

                    const event = info.event;
                    const props = event.extendedProps;

                    document.getElementById('tooltipTime').textContent = `${event.start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}${event.end ? ' - ' + event.end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}`;
                    document.getElementById('tooltipProfessional').textContent = props.professional || 'Não informado';
                    document.getElementById('tooltipPatient').textContent = props.patient || 'Não informado';
                    document.getElementById('tooltipCellphone').textContent = props.cellphone || 'Não informado';
                    document.getElementById('tooltipAgreement').textContent = props.agreement || 'Não informado';
                    document.getElementById('tooltipStatus').textContent = props.status || 'Não informado';
                    document.getElementById('tooltipProcedure').textContent = props.procedure || 'Não informado';
                    
                    const renewButton = document.getElementById('renovar-repeticao-btn');
                    const addRepetitionButton = document.getElementById('add-repetition-btn');
                    const repeatInfoElement = document.getElementById('repetido-info');

                    if (props.repeatConfig) {
                        if (repeatInfoElement) repeatInfoElement.style.display = 'block';
                        if (renewButton) renewButton.style.display = 'inline-block';
                        if (addRepetitionButton) addRepetitionButton.style.display = 'none';

                        const allEvents = calendar.getEvents();
                        const seriesEvents = allEvents.filter(ev => ev.extendedProps.patientId === props.patientId && JSON.stringify(ev.extendedProps.repeatConfig) === JSON.stringify(props.repeatConfig));
                        
                        if (seriesEvents.length > 0) {
                            const attendedStatuses = ['Atendido', 'Presença confirmada'];
                            const attendedCount = seriesEvents.filter(ev => attendedStatuses.includes(ev.extendedProps.status)).length;
                            const totalCount = props.repeatConfig.sessions;
            
                            seriesEvents.sort((a, b) => a.start - b.start);
                            const firstEvent = seriesEvents[0];
                            const lastEvent = seriesEvents[seriesEvents.length - 1];
                            const startDate = firstEvent.start.toLocaleDateString('pt-BR');
                            const endDate = lastEvent.start.toLocaleDateString('pt-BR');
            
                            if (repeatInfoElement) {
                                repeatInfoElement.innerHTML = `
                                    <span>Repetido: ${attendedCount} de ${totalCount}</span><br>
                                    <small>▶ ${startDate} até ${endDate}</small>
                                `;
                            }
                        }
            
                        if (renewButton) {
                            renewButton.onclick = async () => {
                                if (!auth.currentUser) { Swal.fire('Acesso Negado', 'Você precisa estar logado.', 'warning'); return; }
                                eventTooltip.classList.add('d-none');
                                await openRepeatRenewalModal(info.event.id);
                            };
                        }
                    } else {
                        if (repeatInfoElement) repeatInfoElement.style.display = 'none';
                        if (renewButton) renewButton.style.display = 'none';
                        if (addRepetitionButton) {
                            addRepetitionButton.style.display = 'inline-block';
                            addRepetitionButton.onclick = async () => {
                                if (!auth.currentUser) { Swal.fire('Acesso Negado', 'Você precisa estar logado.', 'warning'); return; }
                                eventTooltip.classList.add('d-none');
                                await startRepetitionForExistingAppointment(info.event.id);
                            };
                        }
                    }

                    const rect = info.el.getBoundingClientRect();
                    const scrollX = window.scrollX || window.pageXOffset;
                    const scrollY = window.scrollY || window.pageYOffset;
                    let top = rect.bottom + scrollY + 5;
                    let left = rect.left + scrollX;

                    eventTooltip.style.top = `${top}px`;
                    eventTooltip.style.left = `${left}px`;
                    eventTooltip.classList.add('show');
                    eventTooltip.classList.remove('d-none');
                });

                info.el.addEventListener('mouseleave', () => {
                    eventTooltipTimeout = setTimeout(() => {
                        eventTooltip.classList.remove('show');
                        setTimeout(() => {
                            if (!eventTooltip.matches(':hover')) {
                                eventTooltip.classList.add('d-none');
                            }
                        }, 200);
                    }, 200);
                });
            },

            select: (info) => {
                if (!auth.currentUser) {
                    Swal.fire('Acesso Negado', 'Você precisa estar logado para agendar.', 'warning');
                    return;
                }
                resetAppointmentForm();
                document.getElementById('appointmentDate').value = info.startStr.substring(0, 10);
                document.getElementById('appointmentStartHour').value = info.startStr.substring(11, 16) || '09:00';

                let endHourValue;
                const startDateTime = new Date();
                startDateTime.setHours(info.startStr.substring(11, 13), info.startStr.substring(14, 16), 0, 0);
                startDateTime.setMinutes(startDateTime.getMinutes() + 45);
                const newHours = String(startDateTime.getHours()).padStart(2, '0');
                const newMinutes = String(startDateTime.getMinutes()).padStart(2, '0');
                endHourValue = `${newHours}:${newMinutes}`;

                document.getElementById('appointmentEndHour').value = endHourValue;

                document.getElementById('appointmentModalLabel').textContent = 'Novo agendamento';
                const deleteBtn = document.getElementById('deleteAppointmentBtn');
                if (deleteBtn) {
                    deleteBtn.style.display = 'none';
                }
                patientInfoMessage.classList.remove('d-none');
                document.getElementById('newPatientNamePlaceholder').textContent = '';

                populateAppointmentModalStatusSelect();
                populateProcedureSelect(); 
                appointmentModalInstance.show();
            },

            eventClick: (info) => {
                if (!auth.currentUser) {
                    Swal.fire('Acesso Negado', 'Você precisa estar logado para ver detalhes de agendamentos.', 'warning');
                    return;
                }

                const event = info.event;
                const props = event.extendedProps;

                if (props.status === 'Bloqueado') {
                    const unblockHourModalElement = document.getElementById('unblockHourModal');
                    const unblockHourModalInstance = new bootstrap.Modal(unblockHourModalElement);

                    document.getElementById('unblockDate').textContent = new Date(event.startStr).toLocaleDateString('pt-BR');
                    document.getElementById('unblockTime').textContent = `${event.startStr.substring(11, 16)}${event.endStr ? ' - ' + event.endStr.substring(11, 16) : ''}`;
                    document.getElementById('unblockConfirmBtn').dataset.eventId = event.id;
                    unblockHourModalInstance.show();
                } else {
                    document.getElementById('viewAppointmentTime').textContent = `${event.startStr.substring(11, 16)} - ${event.endStr ? event.endStr.substring(11, 16) : 'N/A'}`;
                    document.getElementById('viewProfessionalName').textContent = props.professional || 'Não informado';
                    document.getElementById('viewPatientName').textContent = props.patient || 'Não informado';
                    document.getElementById('viewCellphone').textContent = props.cellphone || 'Não informado';
                    document.getElementById('viewAgreement').textContent = props.agreement || 'Não informado';
                    document.getElementById('viewStatusSelect').value = props.status || 'Agendado';
                    document.getElementById('viewAuthCode').textContent = props.authCode || 'Não informado';

                    document.getElementById('editAppointmentBtn').dataset.id = event.id;
                    document.getElementById('deleteAppointmentViewBtn').dataset.id = event.id;
                    document.getElementById('startServiceBtn').dataset.id = event.id;

                    const startEvaluationBtn = document.getElementById('startEvaluationBtn');
                    if (startEvaluationBtn) startEvaluationBtn.dataset.id = event.id;
                    if (startEvaluationBtn) startEvaluationBtn.dataset.patientId = props.patientId;
                    
                    const startEvolutionBtn = document.getElementById('startEvolutionBtn');
                    if (startEvolutionBtn) startEvolutionBtn.dataset.id = event.id;
                    if (startEvolutionBtn) startEvolutionBtn.dataset.patientId = props.patientId;
                    
                    const renewRepeatBtnView = document.getElementById('renewRepeatBtnView');
                    if (props.repeatConfig) {
                        if (renewRepeatBtnView) {
                            renewRepeatBtnView.style.display = 'inline-block';
                            renewRepeatBtnView.dataset.id = event.id;
                        }
                    } else {
                        if (renewRepeatBtnView) {
                            renewRepeatBtnView.style.display = 'none';
                            renewRepeatBtnView.removeAttribute('data-id');
                        }
                    }
                     if (renewRepeatBtnView) {
                        renewRepeatBtnView.onclick = async () => {
                            if (!auth.currentUser) {
                                Swal.fire('Acesso Negado', 'Você precisa estar logado para renovar repetições.', 'warning');
                                return;
                            }
                            const aptIdToRenew = renewRepeatBtnView.dataset.id;
                            viewAppointmentModalInstance.hide();
                            await openRepeatRenewalModal(aptIdToRenew);
                        };
                    }

                    viewAppointmentModalInstance.show();
                }
            },

            eventDrop: async (info) => {
                if (!auth.currentUser) {
                    Swal.fire('Acesso Negado', 'Você precisa estar logado para mover agendamentos.', 'warning');
                    info.revert();
                    return;
                }
                const eventId = info.event.id;
                const existingAppointment = await getAppointmentByIdFB(eventId);

                if (existingAppointment) {
                    const updatedAppointment = {
                        ...existingAppointment,
                        date: info.event.start.toISOString().substring(0, 10),
                        startHour: info.event.start.toISOString().substring(11, 16),
                        endHour: info.event.end ? info.event.end.toISOString().substring(11, 16) : null,
                    };
                    
                    info.event.setProp('title', `${updatedAppointment.patient} - ${updatedAppointment.professional}`);
                    info.event.setProp('color', STATUS_COLORS[updatedAppointment.status] || '#6c757d');
                    await updateAppointmentFB(eventId, updatedAppointment);
                    // Reagenda o lembrete enviando o agendamento atualizado em um lote de 1.
                    await scheduleBatchWhatsappReminders([{...updatedAppointment, id: eventId}]); 
                    Swal.fire('Sucesso!', 'Agendamento atualizado!', 'success');
                } else {
                    Swal.fire('Erro!', 'Agendamento não encontrado para atualização.', 'error');
                    info.revert();
                }
            },
            eventResize: async (info) => {
                if (!auth.currentUser) {
                    Swal.fire('Acesso Negado', 'Você precisa estar logado para redimensionar agendamentos.', 'warning');
                    info.revert();
                    return;
                }
                const eventId = info.event.id;
                const existingAppointment = await getAppointmentByIdFB(eventId);

                if (existingAppointment) {
                    const updatedAppointment = {
                        ...existingAppointment,
                        endHour: info.event.end ? info.event.end.toISOString().substring(11, 16) : null
                    };
                    await updateAppointmentFB(eventId, updatedAppointment);
                     // Reagenda o lembrete enviando o agendamento atualizado em um lote de 1.
                    await scheduleBatchWhatsappReminders([{...updatedAppointment, id: eventId}]);
                    Swal.fire('Sucesso!', 'Agendamento atualizado!', 'success');
                } else {
                    Swal.fire('Erro!', 'Agendamento não encontrado para atualização.', 'error');
                    info.revert();
                }
            }
        });
        // A renderização inicial é controlada pelo `onAuthStateChanged`
    }

    // =====================================================================
    // GERENCIAMENTO DE FORMULÁRIOS E MODAIS (EVENT LISTENERS)
    // =====================================================================

    const appointmentForm = document.getElementById('appointmentForm');

    const populateAgreementsSelect = () => {
        agreementSelect.innerHTML = '';
        AGREEMENT_OPTIONS.forEach(agreement => {
            const option = document.createElement('option');
            option.value = agreement;
            option.textContent = agreement;
            agreementSelect.appendChild(option);
        });
    };
    populateAgreementsSelect();
    populateProcedureSelect();

    if (blockHourBtn) {
        blockHourBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            if (!auth.currentUser) {
                Swal.fire('Acesso Negado', 'Você precisa estar logado para bloquear horários.', 'warning');
                return;
            }
            const appointmentDate = document.getElementById('appointmentDate').value;
            const appointmentStartHour = document.getElementById('appointmentStartHour').value;
            const appointmentEndHour = document.getElementById('appointmentEndHour').value;

            if (!appointmentDate || !appointmentStartHour) {
                Swal.fire('Atenção!', 'Por favor, selecione a Data e o Horário de início para bloquear.', 'warning');
                return;
            }

            const blockedAppointmentData = {
                date: appointmentDate,
                startHour: appointmentStartHour,
                endHour: appointmentEndHour || null,
                professional: 'N/A',
                patient: 'Horário Bloqueado',
                agreement: 'N/A',
                authCode: '',
                procedure: '',
                status: 'Bloqueado',
                room: '',
                cellphone: '',
                smsReminder: 'Sem lembrete',
                whatsappReminder: 'Sem lembrete',
                observations: 'Horário bloqueado por indisponibilidade.',
                realizeFitment: false,
                launchFinancial: false,
                repeatAppointment: false,
                patientId: null
            };

            try {
                await addAppointmentFB(blockedAppointmentData);
                Swal.fire('Sucesso!', 'Horário bloqueado com sucesso!', 'success');
                appointmentModalInstance.hide();
                calendar.refetchEvents();
                const updatedAppointments = await getAppointmentsFB();
                await populateAppointmentsTable(updatedAppointments);
            } catch (error) {
                Swal.fire('Erro!', 'Não foi possível bloquear o horário. Tente novamente.', 'error');
            }
        });
    }

    patientInput.addEventListener('input', () => {
        const query = patientInput.value.trim();
        patientSuggestions.innerHTML = '';
        patientInfoMessage.classList.add('d-none');
        newPatientNamePlaceholder.textContent = query;

        if (query.length > 0) {
            const lowerCaseQuery = query.toLowerCase();
            const matches = currentPatientList.filter(p =>
                p.name && p.name.toLowerCase().includes(lowerCaseQuery)
            );

            if (matches.length > 0) {
                matches.forEach(patient => {
                    const div = document.createElement('div');
                    div.classList.add('list-group-item', 'list-group-item-action', 'patient-suggestion-item');
                    div.textContent = patient.name;
                    div.dataset.patientId = patient.id;
                    div.dataset.patientCellphone = patient.cellphone || '';
                    div.dataset.patientAgreement = patient.agreement || 'Particular';

                    patientSuggestions.appendChild(div);

                    div.addEventListener('click', () => {
                        patientInput.value = patient.name;
                        document.getElementById('patientIdForAppointment').value = patient.id;
                        document.getElementById('cellphone').value = patient.cellphone || '';
                        document.getElementById('agreement').value = patient.agreement || 'Particular';
                        patientSuggestions.innerHTML = '';
                        patientInfoMessage.classList.add('d-none');
                    });
                });
            } else {
                patientInfoMessage.classList.remove('d-none');
            }
        } else {
            patientInfoMessage.classList.add('d-none');
            newPatientNamePlaceholder.textContent = '';
        }
    });

    document.addEventListener('click', (e) => {
        if (!patientInput.contains(e.target) && !patientSuggestions.contains(e.target)) {
            if (patientSuggestions.innerHTML !== '') {
                patientSuggestions.innerHTML = '';
            }
        }
    });

    // **[CORREÇÃO PRINCIPAL]** Lógica de submit do formulário de agendamento otimizada para repetições
    appointmentForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!auth.currentUser) {
            Swal.fire('Acesso Negado', 'Você precisa estar logado para salvar agendamentos.', 'warning');
            return;
        }

        const appointmentId = document.getElementById('appointmentId').value;
        const isRepeating = document.getElementById('repeatAppointment').checked;

        // Se for repetição, mas a configuração ainda não foi feita, abre o modal de configuração
        if (isRepeating && !appointmentId && !repeatConfig) {
            openRepeatSetupModal();
            return;
        }

        // Coleta todos os dados do formulário
        const appointmentDate = document.getElementById('appointmentDate').value;
        const appointmentStartHour = document.getElementById('appointmentStartHour').value;
        const appointmentEndHour = document.getElementById('appointmentEndHour').value;
        const professional = document.getElementById('professional').value;
        const patientName = document.getElementById('patient').value.trim();
        const agreement = document.getElementById('agreement').value;
        const authCode = document.getElementById('authCode').value;
        const procedure = document.getElementById('procedure').value;
        const status = document.getElementById('status').value;
        const room = document.getElementById('room').value;
        const cellphone = document.getElementById('cellphone').value;
        const smsReminder = document.getElementById('smsReminder').value;
        const whatsappReminder = document.getElementById('whatsappReminder').value;
        const observations = document.getElementById('observations').value;
        const realizeFitment = document.getElementById('realizeFitment').checked;
        const launchFinancial = document.getElementById('launchFinancial').checked;

        // Validações básicas
        if (!patientName || !professional || !appointmentStartHour || !appointmentEndHour) {
            Swal.fire('Atenção!', 'Paciente, profissional e horários são obrigatórios.', 'warning');
            return;
        }
        if (new Date(`1970-01-01T${appointmentEndHour}`) <= new Date(`1970-01-01T${appointmentStartHour}`)) {
            Swal.fire('Atenção!', 'O horário de término deve ser posterior ao de início.', 'warning');
            return;
        }

        // Lida com a criação/busca de paciente
        let patientId = document.getElementById('patientIdForAppointment').value;
        try {
            if (!patientId) {
                let existingPatient = await getPatientByNameFB(patientName);
                if (existingPatient) {
                    patientId = existingPatient.id;
                } else {
                    const newPatientData = { name: patientName, cellphone, agreement, createdAt: new Date() };
                    patientId = await addPatientFB(newPatientData);
                    await loadPatientSuggestions(await getPatientsFB());
                }
            }
        } catch (error) {
            Swal.fire('Erro!', 'Ocorreu um erro ao processar os dados do paciente.', 'error');
            return;
        }

        // Cria o objeto base do agendamento
        const baseAppointmentData = {
            date: appointmentDate, startHour: appointmentStartHour, endHour: appointmentEndHour,
            professional, patient: patientName, patientId, agreement, authCode, procedure,
            status, room, cellphone, smsReminder, whatsappReminder, observations, realizeFitment,
            launchFinancial, repeatAppointment: isRepeating, repeatConfig: isRepeating ? repeatConfig : null,
        };

        try {
            if (appointmentId) { // EDIÇÃO DE UM AGENDAMENTO EXISTENTE
                await updateAppointmentFB(appointmentId, baseAppointmentData);
                // Envia os dados para o servidor de lembretes em um lote de 1 para atualizar ou agendar
                await scheduleBatchWhatsappReminders([{ ...baseAppointmentData, id: appointmentId }]);
                Swal.fire('Sucesso!', 'Agendamento atualizado!', 'success');
            } else { // CRIAÇÃO DE NOVO(S) AGENDAMENTO(S)
                // Salva o agendamento principal
                const mainAppointmentId = await addAppointmentFB(baseAppointmentData);
                // Prepara o objeto para envio de lembrete
                const mainAppointmentForReminder = { ...baseAppointmentData, id: mainAppointmentId };
                
                let remindersBatch = [mainAppointmentForReminder];

                if (isRepeating && repeatConfig) {
                    // Gera as datas das repetições
                    const generatedAppointments = generateRepeatedAppointments(
                        baseAppointmentData.date, repeatConfig, baseAppointmentData.startHour, baseAppointmentData.endHour
                    );
                    
                    // Salva cada repetição no Firestore e coleta os dados para o batch de lembretes
                    for (const apt of generatedAppointments) {
                        const repeatedAptData = { ...baseAppointmentData, date: apt.date };
                        const repeatedId = await addAppointmentFB(repeatedAptData);
                        remindersBatch.push({ ...repeatedAptData, id: repeatedId });
                    }
                    
                    Swal.fire('Sucesso!', `Agendamento principal e ${generatedAppointments.length} repetições adicionados!`, 'success');
                } else {
                    Swal.fire('Sucesso!', 'Agendamento adicionado!', 'success');
                }

                // **[OTIMIZAÇÃO]** Envia todos os lembretes (o principal + repetições) de uma só vez
                await scheduleBatchWhatsappReminders(remindersBatch);
            }
            
            calendar.refetchEvents(); // Atualiza o calendário
        } catch (error) {
            console.error("Erro ao salvar agendamento(s):", error);
            Swal.fire('Erro!', `Não foi possível salvar o agendamento. Detalhes: ${error.message}`, 'error');
            return;
        }

        appointmentModalInstance.hide();
        // Atualiza as tabelas de pacientes e atendimentos
        const updatedAppointments = await getAppointmentsFB();
        const updatedPatients = await getPatientsFB();
        await populatePatientsTable(updatedPatients);
        await populateAppointmentsTable(updatedAppointments);
    });


    const deleteAppointmentBtn = document.getElementById('deleteAppointmentBtn');
    if (deleteAppointmentBtn) {
        deleteAppointmentBtn.addEventListener('click', async () => {
            if (!auth.currentUser) {
                Swal.fire('Acesso Negado', 'Você precisa estar logado para excluir agendamentos.', 'warning');
                return;
            }
            const appointmentId = document.getElementById('appointmentId').value;
            if (appointmentId) {
                Swal.fire({
                    title: 'Tem certeza?',
                    text: "Você não poderá reverter isso!",
                    icon: 'warning',
                    showCancelButton: true,
                    confirmButtonColor: '#d33',
                    cancelButtonColor: '#3085d6',
                    confirmButtonText: 'Sim, excluir!',
                    cancelButtonText: 'Cancelar'
                }).then(async (result) => {
                    if (result.isConfirmed) {
                        try {
                            await deleteAppointmentFB(appointmentId);
                            Swal.fire('Excluído!', 'O agendamento foi excluído.', 'success');
                            appointmentModalInstance.hide();
                            const updatedAppointments = await getAppointmentsFB();
                            await populateAppointmentsTable(updatedAppointments);
                            calendar.refetchEvents();
                        } catch (error) {
                            Swal.fire('Erro!', 'Não foi possível deletar o agendamento. Detalhes: ' + error.message, 'error');
                        }
                    }
                });
            }
        });
    }

    function resetAppointmentForm() {
        document.getElementById('appointmentForm').reset();
        document.getElementById('appointmentId').value = '';
        document.getElementById('patientIdForAppointment').value = '';
        document.getElementById('professional').value = '';
        populateAgreementsSelect();
        populateProcedureSelect();
        document.getElementById('smsReminder').value = 'Sem lembrete';
        document.getElementById('whatsappReminder').value = 'Sem lembrete';
        document.getElementById('patient').value = '';
        document.getElementById('cellphone').value = '';
        patientInfoMessage.classList.add('d-none');
        newPatientNamePlaceholder.textContent = '';
        patientSuggestions.innerHTML = '';
        document.getElementById('repeatAppointment').checked = false;
        repeatConfig = null;
    }

    const professionalForm = document.getElementById('professionalForm');

    const loadAndDisplayProfessionals = async () => {
        if (!auth.currentUser) {
            existingProfessionals = [];
            professionalListUl.innerHTML = '<li class="list-group-item text-center text-muted">Faça login para ver/cadastrar profissionais.</li>';
            professionalSelect.innerHTML = '<option value="">Faça login</option>';
            appointmentFilterProfessionalSelect.innerHTML = '<option value="Todos">Todos</option>';
            return;
        }

        existingProfessionals = await getProfessionalsFB();
        professionalListUl.innerHTML = '';
        professionalSelect.innerHTML = '<option value="">Selecione o profissional</option>';
        appointmentFilterProfessionalSelect.innerHTML = '<option value="Todos">Todos</option>';

        existingProfessionals.forEach(professional => {
            const listItem = document.createElement('li');
            listItem.className = 'list-group-item d-flex justify-content-between align-items-center';
            listItem.innerHTML = `
                <span>${professional.name} ${professional.specialty ? `(${professional.specialty})` : ''}</span>
                <div>
                    <button type="button" class="btn btn-sm btn-info me-2 edit-professional-btn" data-id="${professional.id}">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button type="button" class="btn btn-sm btn-danger delete-professional-btn" data-id="${professional.id}">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            `;
            professionalListUl.appendChild(listItem);

            const option = document.createElement('option');
            option.value = professional.name;
            option.textContent = `${professional.name} ${professional.specialty ? `(${professional.specialty})` : ''}`;
            professionalSelect.appendChild(option);

            const filterOption = document.createElement('option');
            filterOption.value = professional.name;
            filterOption.textContent = `${professional.name}`;
            appointmentFilterProfessionalSelect.appendChild(filterOption);
        });

        document.querySelectorAll('.edit-professional-btn').forEach(button => {
            button.onclick = async (e) => {
                if (!auth.currentUser) {
                    Swal.fire('Acesso Negado', 'Você precisa estar logado para editar profissionais.', 'warning');
                    return;
                }
                const id = e.currentTarget.dataset.id;
                const professional = existingProfessionals.find(p => p.id === id);
                if (professional) {
                    document.getElementById('professionalId').value = professional.id;
                    document.getElementById('professionalName').value = professional.name;
                    document.getElementById('professionalSpecialty').value = professional.specialty || '';
                    document.getElementById('professionalModalLabel').textContent = 'Editar Profissional';
                }
            };
        });

        document.querySelectorAll('.delete-professional-btn').forEach(button => {
            button.onclick = async (e) => {
                if (!auth.currentUser) {
                    Swal.fire('Acesso Negado', 'Você precisa estar logado para excluir profissionais.', 'warning');
                    return;
                }
                const id = e.currentTarget.dataset.id;
                Swal.fire({
                    title: 'Tem certeza?',
                    text: "Você não poderá reverter isso!",
                    icon: 'warning',
                    showCancelButton: true,
                    confirmButtonColor: '#d33',
                    cancelButtonColor: '#3085d6',
                    confirmButtonText: 'Sim, excluir!',
                    cancelButtonText: 'Cancelar'
                }).then(async (result) => {
                    if (result.isConfirmed) {
                        try {
                            await deleteProfessionalFB(id);
                            Swal.fire('Excluído!', 'O profissional foi excluído.', 'success');
                            loadAndDisplayProfessionals();
                        } catch (error) {
                            Swal.fire('Erro!', 'Não foi possível deletar o profissional. Detalhes: ' + error.message, 'error');
                        }
                    }
                });
            };
        });
    };

    professionalModalElement.addEventListener('show.bs.modal', () => {
        document.getElementById('professionalForm').reset();
        document.getElementById('professionalId').value = '';
        document.getElementById('professionalModalLabel').textContent = 'Cadastrar Profissional';
    });

    professionalForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!auth.currentUser) {
            Swal.fire('Acesso Negado', 'Você precisa estar logado para salvar profissionais.', 'warning');
            return;
        }

        const userId = auth.currentUser.uid;
        if (!userId) {
            Swal.fire('Erro!', 'Não foi possível obter o ID do usuário. Tente fazer login novamente.', 'error');
            return;
        }

        const id = document.getElementById('professionalId').value;
        const name = document.getElementById('professionalName').value;
        const specialty = document.getElementById('professionalSpecialty').value;

        const professionalData = { name, specialty, userId };

        try {
            if (id) {
                await updateProfessionalFB(id, professionalData);
                Swal.fire('Sucesso!', 'Profissional atualizado!', 'success');
            } else {
                await addProfessionalFB(professionalData);
                Swal.fire('Sucesso!', 'Profissional cadastrado!', 'success');
            }
        } catch (error) {
            Swal.fire('Erro!', 'Não foi possível salvar o profissional. Verifique o console para mais detalhes.', 'error');
        }

        await loadAndDisplayProfessionals();
        professionalModalInstance.hide();
    });

    const viewStatusSelect = document.getElementById('viewStatusSelect');

    viewStatusSelect.addEventListener('change', async (e) => {
        if (!auth.currentUser) {
            Swal.fire('Acesso Negado', 'Você precisa estar logado para alterar o status do agendamento.', 'warning');
            e.target.value = e.target.defaultValue;
            return;
        }
        const appointmentId = document.getElementById('editAppointmentBtn').dataset.id;
        const newStatus = e.target.value;
        if (appointmentId) {
            const existingAppointment = await getAppointmentByIdFB(appointmentId);

            if (existingAppointment) {
                existingAppointment.status = newStatus;
                try {
                    await updateAppointmentFB(appointmentId, existingAppointment);
                    // Se o status for alterado para um que não precisa de lembrete, cancela o agendamento do envio
                    if (newStatus === 'Cancelado' || newStatus === 'Faltou' || newStatus === 'Atendido') {
                        await cancelWhatsappReminder(appointmentId);
                    }
                    Swal.fire('Status Atualizado!', `Status do agendamento para ${newStatus}.`, 'success');
                    if (!appointmentsOverviewSection.classList.contains('d-none')) {
                        const updatedAppointments = await getAppointmentsFB();
                        await populateAppointmentsTable(updatedAppointments);
                    }
                    calendar.refetchEvents();
                } catch (error) {
                    Swal.fire('Erro!', 'Não foi possível atualizar o status. Tente novamente.', 'error');
                }
            } else {
                Swal.fire('Erro!', 'Agendamento não encontrado.', 'error');
            }
        }
    });

    document.getElementById('editAppointmentBtn').addEventListener('click', async (e) => {
        if (!auth.currentUser) {
            Swal.fire('Acesso Negado', 'Você precisa estar logado para editar agendamentos.', 'warning');
            return;
        }
        const appointmentId = e.currentTarget.dataset.id;
        if (appointmentId) {
            viewAppointmentModalInstance.hide();
            const appointment = await getAppointmentByIdFB(appointmentId);
            if (appointment) {
                document.getElementById('appointmentId').value = appointment.id;
                document.getElementById('appointmentDate').value = appointment.date;
                document.getElementById('appointmentStartHour').value = appointment.startHour;
                document.getElementById('appointmentEndHour').value = appointment.endHour || '';
                document.getElementById('professional').value = appointment.professional || '';
                document.getElementById('patient').value = appointment.patient || '';
                document.getElementById('agreement').value = appointment.agreement || 'Particular';
                document.getElementById('authCode').value = appointment.authCode || '';
                document.getElementById('procedure').value = appointment.procedure || '';

                populateAppointmentModalStatusSelect();
                populateProcedureSelect(); 
                document.getElementById('status').value = appointment.status || 'Agendado';

                document.getElementById('room').value = appointment.room || '';
                document.getElementById('cellphone').value = appointment.cellphone || '';
                document.getElementById('smsReminder').value = appointment.smsReminder || 'Sem lembrete';
                document.getElementById('whatsappReminder').value = appointment.whatsappReminder || 'Sem lembrete';
                document.getElementById('observations').value = appointment.observations || '';
                document.getElementById('realizeFitment').checked = appointment.realizeFitment || false;
                document.getElementById('launchFinancial').checked = appointment.launchFinancial || false;
                document.getElementById('repeatAppointment').checked = appointment.repeatAppointment || false;
                repeatConfig = appointment.repeatConfig || null;


                document.getElementById('patientIdForAppointment').value = appointment.patientId || '';

                patientInfoMessage.classList.add('d-none');
                patientSuggestions.innerHTML = '';

                document.getElementById('appointmentModalLabel').textContent = 'Editar Agendamento';
                const deleteBtn = document.getElementById('deleteAppointmentBtn');
                if (deleteBtn) {
                    deleteBtn.style.display = 'inline-block';
                }
                appointmentModalInstance.show();
            } else {
                Swal.fire('Erro!', 'Agendamento não encontrado para edição.', 'error');
            }
        }
    });

    document.getElementById('deleteAppointmentViewBtn').addEventListener('click', async (e) => {
        if (!auth.currentUser) {
            Swal.fire('Acesso Negado', 'Você precisa estar logado para excluir agendamentos.', 'warning');
            return;
        }
        const appointmentId = e.currentTarget.dataset.id;
        if (appointmentId) {
            Swal.fire({
                title: 'Tem certeza?',
                text: "Você não poderá reverter isso!",
                icon: 'warning',
                showCancelButton: true,
                confirmButtonColor: '#d33',
                cancelButtonColor: '#3085d6',
                confirmButtonText: 'Sim, excluir!',
                cancelButtonText: 'Cancelar'
            }).then(async (result) => {
                if (result.isConfirmed) {
                    try {
                        await deleteAppointmentFB(appointmentId);
                        Swal.fire('Excluído!', 'O agendamento foi excluído.', 'success');
                        viewAppointmentModalInstance.hide();
                        if (!appointmentsOverviewSection.classList.contains('d-none')) {
                            const updatedAppointments = await getAppointmentsFB();
                            await populateAppointmentsTable(updatedAppointments);
                        }
                        calendar.refetchEvents();
                    } catch (error) {
                        Swal.fire('Erro!', 'Não foi possível deletar o agendamento. Detalhes: ' + error.message, 'error');
                    }
                }
            });
        }
    });

    document.getElementById('startEvaluationBtn').addEventListener('click', async (e) => {
        if (!auth.currentUser) {
            Swal.fire('Acesso Negado', 'Você precisa estar logado para iniciar uma avaliação.', 'warning');
            return;
        }
        const appointmentId = e.currentTarget.dataset.id;
        const patientId = e.currentTarget.dataset.patientId;
        if (appointmentId && patientId) {
            viewAppointmentModalInstance.hide();
            await openEvaluationModal(appointmentId, patientId);
        }
    });

    document.getElementById('startEvolutionBtn').addEventListener('click', async (e) => {
        if (!auth.currentUser) {
            Swal.fire('Acesso Negado', 'Você precisa estar logado para iniciar uma evolução.', 'warning');
            return;
        }
        const appointmentId = e.currentTarget.dataset.id;
        const patientId = e.currentTarget.dataset.patientId;
        if (appointmentId && patientId) {
            viewAppointmentModalInstance.hide();
            await openEvolutionModal(appointmentId, patientId);
        }
    });


    document.getElementById('generateSPSADTBtn').addEventListener('click', () => {
        if (!auth.currentUser) {
            Swal.fire('Acesso Negado', 'Você precisa estar logado para gerar SP/SADT.', 'warning');
            return;
        }
        Swal.fire('Ação!', 'Gerar SP/SADT (funcionalidade a ser implementada).', 'info');
    });

    document.getElementById('sendPreEvaluationBtn').addEventListener('click', () => {
        if (!auth.currentUser) {
            Swal.fire('Acesso Negado', 'Você precisa estar logado para enviar pré-avaliação.', 'warning');
            return;
        }
        Swal.fire('Ação!', 'Enviar pré-avaliação (funcionalidade a ser implementada).', 'info');
    });

    evaluationForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!auth.currentUser) {
            Swal.fire('Acesso Negado', 'Você precisa estar logado para salvar avaliações.', 'warning');
            return;
        }

        const evaluationId = document.getElementById('evaluationId').value;
        const evaluationAppointmentId = document.getElementById('evaluationAppointmentId').value;
        const evaluationPatientId = document.getElementById('evaluationPatientId').value;
        const evaluationDate = document.getElementById('evaluationDate').value;
        const evaluationStartHour = document.getElementById('evaluationStartHour').value;
        const evaluationEndHour = document.getElementById('evaluationEndHour').value;
        const evaluationAgreement = document.getElementById('evaluationAgreement').value;
        const evaluationAuthCode = document.getElementById('evaluationAuthCode').value;
        const evaluationLaunchFinancial = document.getElementById('evaluationLaunchFinancial').checked;
        const evaluationProcedure = document.getElementById('evaluationProcedure').value;

        const evaluationContentData = {};
        for (const key in quillEditors) {
            if (quillEditors[key]) {
                evaluationContentData[key] = JSON.stringify(quillEditors[key].getContents());
            }
        }

        const evaluationData = {
            appointmentId: evaluationAppointmentId || null,
            patientId: evaluationPatientId,
            date: evaluationDate,
            startHour: evaluationStartHour,
            endHour: evaluationEndHour,
            agreement: evaluationAgreement,
            authCode: evaluationAuthCode,
            launchFinancial: evaluationLaunchFinancial,
            procedure: evaluationProcedure,
            mainComplaint: evaluationContentData.mainComplaint,
            currentDiseaseHistory: evaluationContentData.currentDiseaseHistory,
            pastMedicalHistory: evaluationContentData.pastMedicalHistory,
            familyHistory: evaluationContentData.familyHistory,
            observations: evaluationContentData.evaluationObservations,
            createdAt: new Date(),
        };

        try {
            if (evaluationId) {
                await updateEvaluationFB(evaluationId, evaluationData);
                Swal.fire('Sucesso!', 'Avaliação atualizada!', 'success');
            } else {
                await addEvaluationFB(evaluationData);
                Swal.fire('Sucesso!', 'Avaliação salva!', 'success');
            }
        } catch (error) {
            Swal.fire('Erro!', 'Não foi possível salvar a avaliação. Verifique o console para detalhes.', 'error');
        }

        evaluationModalInstance.hide();
        await showPatientRecordSection(evaluationPatientId);
        const successMessageRecord = document.getElementById('successMessageRecord');
        if (successMessageRecord) {
            successMessageRecord.classList.remove('d-none');
            setTimeout(() => {
                successMessageRecord.classList.add('d-none');
            }, 5000);
        }
    });

    evolutionForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!auth.currentUser) {
            Swal.fire('Acesso Negado', 'Você precisa estar logado para salvar evoluções.', 'warning');
            return;
        }

        const evolutionId = document.getElementById('evolutionId').value;
        const evolutionAppointmentId = document.getElementById('evolutionAppointmentId').value;
        const evolutionPatientId = document.getElementById('evolutionPatientId').value;
        const evolutionDate = document.getElementById('evolutionDate').value;
        const evolutionStartHour = document.getElementById('evolutionStartHour').value;
        const evolutionEndHour = document.getElementById('evolutionEndHour').value;
        const evolutionAgreement = document.getElementById('evolutionAgreement').value;
        const evolutionAuthCode = document.getElementById('evolutionAuthCode').value;
        const evolutionLaunchFinancial = document.getElementById('evolutionLaunchFinancial').checked;
        const evolutionProcedure = document.getElementById('evolutionProcedure').value;

        const evolutionContent = quillEvolutionContent ? JSON.stringify(quillEvolutionContent.getContents()) : '';

        const attachedFiles = document.getElementById('attachedFiles').files;
        if (attachedFiles.length > 0) {
            Swal.fire('Aviso!', 'Os arquivos foram selecionados, mas não serão salvos offline sem uma integração de backend/armazenamento de arquivos.', 'warning');
        }

        const evolutionData = {
            appointmentId: evolutionAppointmentId || null,
            patientId: evolutionPatientId,
            date: evolutionDate,
            startHour: evolutionStartHour,
            endHour: evolutionEndHour,
            agreement: evolutionAgreement,
            authCode: evolutionAuthCode,
            launchFinancial: evolutionLaunchFinancial,
            procedure: evolutionProcedure,
            content: evolutionContent,
            createdAt: new Date(),
        };

        try {
            if (evolutionId) {
                await updateEvolutionFB(evolutionId, evolutionData);
                Swal.fire('Sucesso!', 'Evolução atualizada!', 'success');
            } else {
                await addEvolutionFB(evolutionData);
                Swal.fire('Sucesso!', 'Evolução salva!', 'success');
            }
        } catch (error) {
            Swal.fire('Erro!', 'Não foi possível salvar a evolução. Verifique o console para detalhes.', 'error');
        }

        evolutionModalInstance.hide();
        await showPatientRecordSection(evolutionPatientId);
        const successMessageRecord = document.getElementById('successMessageRecord');
        if (successMessageRecord) {
            successMessageRecord.classList.remove('d-none');
            setTimeout(() => {
                successMessageRecord.classList.add('d-none');
            }, 5000);
        }
    });

    document.getElementById('newEvaluationRecordBtn').addEventListener('click', async () => {
        if (!auth.currentUser) {
            Swal.fire('Acesso Negado', 'Você precisa estar logado para criar uma nova avaliação.', 'warning');
            return;
        }
        const currentPatientId = document.getElementById('recordPatientId').textContent;
        let currentAppointmentId = null;
        if (calendar.getEvents().length > 0) {
            const eventsForPatient = calendar.getEvents().filter(event => event.extendedProps.patientId === currentPatientId && event.extendedProps.status !== 'Bloqueado');
            if (eventsForPatient.length > 0) {
                const latestAppointment = eventsForPatient.reduce((prev, current) => {
                    const prevDate = new Date(prev.start);
                    const currentDate = new Date(current.start);
                    return (currentDate > prevDate) ? current : prev;
                });
                currentAppointmentId = latestAppointment.id;
            }
        }

        if (currentPatientId) {
            patientRecordSection.classList.add('d-none');
            await openEvaluationModal(currentAppointmentId, currentPatientId);
        } else {
            Swal.fire('Erro!', 'Nenhum paciente selecionado para nova avaliação. Selecione um agendamento ou paciente com histórico para iniciar.', 'error');
        }
    });

    document.getElementById('newEvolutionRecordBtn').addEventListener('click', async () => {
        if (!auth.currentUser) {
            Swal.fire('Acesso Negado', 'Você precisa estar logado para criar uma nova evolução.', 'warning');
            return;
        }
        const currentPatientId = document.getElementById('recordPatientId').textContent;
        let currentAppointmentId = null;
        if (calendar.getEvents().length > 0) {
            const eventsForPatient = calendar.getEvents().filter(event => event.extendedProps.patientId === currentPatientId && event.extendedProps.status !== 'Bloqueado');
            if (eventsForPatient.length > 0) {
                const latestAppointment = eventsForPatient.reduce((prev, current) => {
                    const prevDate = new Date(prev.start);
                    const currentDate = new Date(current.start);
                    return (currentDate > prevDate) ? current : prev;
                });
                currentAppointmentId = latestAppointment.id;
            }
        }

        if (currentPatientId) {
            patientRecordSection.classList.add('d-none');
            await openEvolutionModal(currentAppointmentId, currentPatientId);
        } else {
            Swal.fire('Erro!', 'Nenhum paciente ou agendamento recente selecionado para nova evolução. Selecione um agendamento ou paciente com histórico para iniciar.', 'error');
        }
    });

    document.getElementById('generatedFilesRecordBtn').addEventListener('click', () => {
        if (!auth.currentUser) {
            Swal.fire('Acesso Negado', 'Você precisa estar logado para acessar arquivos gerados.', 'warning');
            return;
        }
        Swal.fire('Funcionalidade', 'Gerenciar arquivos gerados (a ser implementado).', 'info');
    });


    const tooltipTriggerList = document.querySelectorAll('[data-bs-toggle="tooltip"]');
    if (tooltipTriggerList.length > 0) {
        Array.from(tooltipTriggerList).map(tooltipTriggerEl => new bootstrap.Tooltip(tooltipTriggerEl));
    }

    const unblockConfirmBtn = document.getElementById('unblockConfirmBtn');
    if (unblockConfirmBtn) {
        unblockConfirmBtn.addEventListener('click', async () => {
            if (!auth.currentUser) {
                Swal.fire('Acesso Negado', 'Você precisa estar logado para desbloquear horários.', 'warning');
                return;
            }
            const eventId = unblockConfirmBtn.dataset.eventId;
            const unblockHourModalElement = document.getElementById('unblockHourModal');
            const unblockHourModalInstance = bootstrap.Modal.getInstance(unblockHourModalElement);

            if (!eventId) {
                Swal.fire('Erro!', 'ID do horário bloqueado inválido.', 'error');
                return;
            }

            Swal.fire({
                title: 'Tem certeza?',
                text: "Você irá desbloquear este horário e ele ficará disponível para agendamento.",
                icon: 'warning',
                showCancelButton: true,
                confirmButtonColor: '#28a745',
                cancelButtonColor: '#6c757d',
                confirmButtonText: 'Sim, desbloquear!',
                cancelButtonText: 'Cancelar'
            }).then(async (result) => {
                    if (result.isConfirmed) {
                        try {
                            await deleteAppointmentFB(eventId);
                            Swal.fire('Desbloqueado!', 'O horário foi desbloqueado e está disponível.', 'success');
                            unblockHourModalInstance.hide();
                            const updatedAppointments = await getAppointmentsFB();
                            await populateAppointmentsTable(updatedAppointments);
                            calendar.refetchEvents();
                        }
                        catch (error) {
                            Swal.fire('Erro!', 'Não foi possível desbloquear o horário. Detalhes: ' + error.message, 'error');
                        }
                    }
                });
        });
    }

    if (newPatientBtn) {
        newPatientBtn.addEventListener('click', () => {
            if (!auth.currentUser) {
                Swal.fire('Acesso Negado', 'Você precisa estar logado para cadastrar pacientes.', 'warning');
                return;
            }
            resetPatientForm();
            document.getElementById('patientDetailsModalLabel').textContent = 'Cadastrar Novo Paciente';
            patientFormModalInstance.show();
        });
    }

    function resetPatientForm() {
        patientDetailsForm.reset();
        document.getElementById('patientDetailsId').value = '';
        document.getElementById('patientDetailsIsArchived').checked = false;
        document.getElementById('patientDetailsAgreement').value = 'Particular';
    }

    if (patientDetailsForm) {
        patientDetailsForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (!auth.currentUser) {
                Swal.fire('Acesso Negado', 'Você precisa estar logado para salvar pacientes.', 'warning');
                return;
            }

            const patientId = document.getElementById('patientDetailsId').value;
            const name = document.getElementById('patientDetailsName').value;
            const cellphone = document.getElementById('patientDetailsCellphone').value;
            const birthDate = document.getElementById('patientDetailsBirthDate').value;
            const cpf = document.getElementById('patientDetailsCpf').value;
            const city = document.getElementById('patientDetailsCity').value;
            const agreement = document.getElementById('patientDetailsAgreement').value;
            const address = document.getElementById('patientDetailsAddress').value;
            const observations = document.getElementById('patientDetailsObservations').value;
            const isArchived = document.getElementById('patientDetailsIsArchived').checked;

            const patientData = {
                name,
                cellphone,
                birthDate,
                cpf,
                city,
                agreement,
                address,
                observations,
                isArchived
            };

            try {
                if (patientId) {
                    await updatePatientFB(patientId, patientData);
                    Swal.fire('Sucesso!', 'Paciente atualizado!', 'success');
                } else {
                    await addPatientFB(patientData);
                    Swal.fire('Sucesso!', 'Paciente cadastrado!', 'success');
                }
            } catch (error) {
                Swal.fire('Erro!', 'Não foi possível salvar o paciente. Verifique o console para detalhes.', 'error');
            }

            const updatedPatients = await getPatientsFB();
            await populatePatientsTable(updatedPatients);
            patientFormModalInstance.hide();
            await loadPatientSuggestions(updatedPatients);
            if (!appointmentsOverviewSection.classList.contains('d-none')) {
                const updatedAppointments = await getAppointmentsFB();
                await populateAppointmentsTable(updatedAppointments);
            }
        });
    }

    document.getElementById('viewArchivedPatientsBtn').addEventListener('click', () => {
        if (!auth.currentUser) {
            Swal.fire('Acesso Negado', 'Você precisa estar logado para ver pacientes arquivados.', 'warning');
            return;
        }
        Swal.fire('Funcionalidade', 'Filtrar pacientes arquivados/desativados (a ser implementado).', 'info');
    });

    document.getElementById('exportExcelBtn').addEventListener('click', () => {
        if (!auth.currentUser) {
            Swal.fire('Acesso Negado', 'Você precisa estar logado para exportar dados.', 'warning');
            return;
        }
        Swal.fire('Funcionalidade', 'Exportar pacientes para Excel (a ser implementada).', 'info');
    });

    document.getElementById('importCsvBtn').addEventListener('click', () => {
        if (!auth.currentUser) {
            Swal.fire('Acesso Negado', 'Você precisa estar logado para importar dados.', 'warning');
            return;
        }
        Swal.fire('Funcionalidade', 'Importar pacientes de CSV (a ser implementada).', 'info');
    });

    appointmentSearchInput.addEventListener('input', async () => {
        currentAppointmentsPage = 1;
        const updatedAppointments = await getAppointmentsFB();
        populateAppointmentsTable(updatedAppointments);
    });

    if (patientSearchInput) {
        patientSearchInput.addEventListener('input', async () => {
            if (auth.currentUser) {
                currentPatientsPage = 1;
                const patientsData = await getPatientsFB();
                await populatePatientsTable(patientsData);
            } else {
                Swal.fire('Acesso Negado', 'Você precisa estar logado para pesquisar pacientes.', 'warning');
            }
        });
        const patientSearchBtn = document.getElementById('patientSearchBtn');
        if (patientSearchBtn) {
            patientSearchBtn.addEventListener('click', async () => {
                if (auth.currentUser) {
                    currentPatientsPage = 1;
                    const patientsData = await getPatientsFB();
                    await populatePatientsTable(patientsData);
                } else {
                    Swal.fire('Acesso Negado', 'Você precisa estar logado para pesquisar pacientes.', 'warning');
                }
            });
        }
    }

    async function refreshAndPopulateReminders() {
        if (auth.currentUser) {
            const reminders = await getWhatsappReminders();
            populateRemindersTable(reminders);
        }
    }

    const reminderFilters = [reminderFilterStatus, reminderFilterPatientName, reminderFilterStartDate, reminderFilterEndDate];
    reminderFilters.forEach(filter => {
        if (filter) {
            filter.addEventListener('change', refreshAndPopulateReminders);
            if (filter.type === 'text' || filter.type === 'search') {
                filter.addEventListener('input', refreshAndPopulateReminders);
            }
        }
    });
    
    document.getElementById('refreshRemindersBtn')?.addEventListener('click', refreshAndPopulateReminders);
    document.getElementById('clearReminderFiltersBtn')?.addEventListener('click', () => {
        document.getElementById('remindersFilterForm').reset();
        refreshAndPopulateReminders();
    });


    appointmentFilterStatus.addEventListener('change', async () => {
        currentAppointmentsPage = 1;
        const updatedAppointments = await getAppointmentsFB();
        populateAppointmentsTable(updatedAppointments);
    });
    appointmentFilterProfessional.addEventListener('change', async () => {
        currentAppointmentsPage = 1;
        const updatedAppointments = await getAppointmentsFB();
        populateAppointmentsTable(updatedAppointments);
    });
    appointmentStartDateFilter.addEventListener('change', async () => {
        currentAppointmentsPage = 1;
        const updatedAppointments = await getAppointmentsFB();
        populateAppointmentsTable(updatedAppointments);
    });
    appointmentEndDateFilter.addEventListener('change', async () => {
        currentAppointmentsPage = 1;
        const updatedAppointments = await getAppointmentsFB();
        populateAppointmentsTable(updatedAppointments);
    });
    appointmentSearchBtn.addEventListener('click', async () => {
        currentAppointmentsPage = 1;
        const updatedAppointments = await getAppointmentsFB();
        populateAppointmentsTable(updatedAppointments);
    });
    appointmentSearchInput.addEventListener('keypress', async (e) => {
        if (e.key === 'Enter') {
            currentAppointmentsPage = 1;
            const updatedAppointments = await getAppointmentsFB();
            populateAppointmentsTable(updatedAppointments);
        }
    });

    appointmentsPerPageSelect.addEventListener('change', async () => {
        appointmentsItemsPerPage = parseInt(appointmentsPerPageSelect.value);
        currentAppointmentsPage = 1;
        const updatedAppointments = await getAppointmentsFB();
        populateAppointmentsTable(updatedAppointments);
    });

    if (patientsPerPageSelect) {
        patientsPerPageSelect.addEventListener('change', async () => {
            patientsItemsPerPage = parseInt(patientsPerPageSelect.value);
            currentPatientsPage = 1;
            const updatedPatients = await getPatientsFB();
            populatePatientsTable(updatedPatients);
        });
    }

    document.getElementById('exportAppointmentsExcelBtn').addEventListener('click', () => {
        if (!auth.currentUser) {
            Swal.fire('Acesso Negado', 'Você precisa estar logado para exportar atendimentos.', 'warning');
            return;
        }
        Swal.fire('Funcionalidade', 'Exportar atendimentos para Excel (a ser implementada).', 'info');
    });

    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('/service-worker.js')
                .then(registration => {
                    console.log('Service Worker registrado com sucesso:', registration.scope);
                })
                .catch(error => {
                    console.error('Falha no registro do Service Worker:', error);
                });
        });
    }

    if (sidebarAgendaBtn) sidebarAgendaBtn.addEventListener('click', showAgendaSection);
    if (sidebarPatientsBtn) sidebarPatientsBtn.addEventListener('click', showPatientsSection);
    if (sidebarAppointmentsBtn) sidebarAppointmentsBtn.addEventListener('click', showAppointmentsOverviewSection);
    if (sidebarRemindersBtn) sidebarRemindersBtn.addEventListener('click', showRemindersSection);
    if (backToCalendarBtn) backToCalendarBtn.addEventListener('click', showAgendaSection);
    if (addProfessionalNavBtn) addProfessionalNavBtn.addEventListener('click', () => professionalModalInstance.show());
    if(viewCalendarBtn) {
        viewCalendarBtn.addEventListener('click', () => {
            patientRecordSection.classList.add('d-none');
            agendaSection.classList.remove('d-none');
        });
    }
    
    if(backBtn) {
        backBtn.addEventListener('click', () => {
            patientRecordSection.classList.add('d-none');
            patientsSection.classList.remove('d-none');
        });
    }

    if (refreshPatientsBtn) {
        refreshPatientsBtn.addEventListener('click', async () => {
            if (auth.currentUser) {
                const updatedPatients = await getPatientsFB();
                await populatePatientsTable(updatedPatients);
                Swal.fire({title: 'Atualizado!', text: 'Lista de pacientes recarregada.', icon: 'success', timer: 1000, showConfirmButton: false });
            }
        });
    }

    if (refreshAppointmentsBtn) {
        refreshAppointmentsBtn.addEventListener('click', async () => {
            if (auth.currentUser) {
                const updatedAppointments = await getAppointmentsFB();
                await populateAppointmentsTable(updatedAppointments);
                Swal.fire({title: 'Atualizado!', text: 'Lista de atendimentos recarregada.', icon: 'success', timer: 1000, showConfirmButton: false });
            }
        });
    }

    const repeatSetupForm = document.getElementById('repeatSetupForm');
    if(repeatSetupForm) {
        repeatSetupForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const baseAppointmentId = repeatSetupModalElement.dataset.baseAppointmentId;
    
            const frequency = document.getElementById('repeatFrequency').value;
            const sessions = parseInt(document.getElementById('repeatSessionCount').value, 10);
            const daysCheckboxes = document.querySelectorAll('#repeatDaysOfWeek .form-check-input:checked');
            const selectedDays = Array.from(daysCheckboxes).map(cb => cb.value);
    
            if (selectedDays.length === 0) {
                Swal.fire('Atenção!', 'Selecione pelo menos um dia da semana para a repetição.', 'warning');
                return;
            }
            if (isNaN(sessions) || sessions <= 0) {
                Swal.fire('Atenção!', 'A quantidade de sessões deve ser um número positivo.', 'warning');
                return;
            }
    
            const newRepeatConfig = { frequency, days: selectedDays, sessions };
            
            if (baseAppointmentId) {
                try {
                    const baseAppointment = await getAppointmentByIdFB(baseAppointmentId);
                    if (!baseAppointment) {
                        throw new Error("Agendamento base não encontrado.");
                    }
    
                    await updateAppointmentFB(baseAppointmentId, {
                        repeatAppointment: true,
                        repeatConfig: newRepeatConfig
                    });
                    
                    const generated = generateRepeatedAppointments(
                        baseAppointment.date,
                        newRepeatConfig,
                        baseAppointment.startHour,
                        baseAppointment.endHour
                    );
    
                    const remindersBatch = [];
                    for (const apt of generated) {
                        const newAppointmentData = {
                            ...baseAppointment,
                            date: apt.date,
                            startHour: apt.startHour,
                            endHour: apt.endHour,
                            repeatAppointment: true,
                            repeatConfig: newRepeatConfig,
                            createdAt: new Date(),
                            id: null
                        };
                        delete newAppointmentData.id;
                        const newId = await addAppointmentFB(newAppointmentData);
                        remindersBatch.push({ ...newAppointmentData, id: newId });
                    }
                    
                    // Envia lembretes em lote
                    await scheduleBatchWhatsappReminders(remindersBatch);
    
                    Swal.fire('Sucesso!', `Repetição criada e ${generated.length} novo(s) agendamento(s) adicionado(s)!`, 'success');
                    repeatSetupModalInstance.hide();
                    calendar.refetchEvents();
    
                } catch (error) {
                    Swal.fire('Erro!', 'Não foi possível criar a repetição. ' + error.message, 'error');
                } finally {
                    delete repeatSetupModalElement.dataset.baseAppointmentId;
                }
    
            } else {
                repeatConfig = newRepeatConfig;
                repeatSetupModalInstance.hide();
                document.getElementById('appointmentForm').requestSubmit();
            }
        });
    }

    const renewRepeatSaveBtn = document.getElementById('renewRepeatSaveBtn');
    if (renewRepeatSaveBtn) {
        renewRepeatSaveBtn.addEventListener('click', async () => {
            if (!auth.currentUser) {
                Swal.fire('Acesso Negado', 'Você precisa estar logado para renovar repetições.', 'warning');
                return;
            }
            const originalAppointmentId = repeatRenewalModalElement.dataset.originalAppointmentId;
            const newSessionsCount = parseInt(document.getElementById('newRepeatSessionCount').value, 10);

            if (isNaN(newSessionsCount) || newSessionsCount <= 0) {
                Swal.fire('Atenção!', 'A quantidade de sessões deve ser um número positivo.', 'warning');
                return;
            }

            try {
                const originalAppointment = await getAppointmentByIdFB(originalAppointmentId);
                if (!originalAppointment || !originalAppointment.repeatConfig) {
                    Swal.fire('Erro!', 'Agendamento original ou configuração de repetição não encontrada.', 'error');
                    return;
                }

                const newRepeatConfig = { ...originalAppointment.repeatConfig, sessions: newSessionsCount };

                const allAppointments = await getAppointmentsFB();
                const relatedAppointments = allAppointments.filter(apt =>
                    apt.patientId === originalAppointment.patientId &&
                    JSON.stringify(apt.repeatConfig) === JSON.stringify(originalAppointment.repeatConfig)
                );

                let latestDate = originalAppointment.date;
                if (relatedAppointments.length > 0) {
                    latestDate = relatedAppointments.reduce((maxDate, apt) => {
                        return new Date(apt.date) > new Date(maxDate) ? apt.date : maxDate;
                    }, latestDate);
                }

                const generatedNewAppointments = generateRepeatedAppointments(
                    latestDate,
                    newRepeatConfig,
                    originalAppointment.startHour,
                    originalAppointment.endHour
                );
                
                const existingDates = new Set(allAppointments.map(apt => `${apt.date}T${apt.startHour}`));
                const uniqueNewAppointments = generatedNewAppointments.filter(newApt => !existingDates.has(`${newApt.date}T${newApt.startHour}`));

                if (uniqueNewAppointments.length === 0) {
                    Swal.fire('Atenção!', 'Nenhum novo agendamento a ser adicionado.', 'info');
                    repeatRenewalModalInstance.hide();
                    return;
                }

                const remindersBatch = [];
                for (const apt of uniqueNewAppointments) {
                    const newAppointmentData = {
                        ...originalAppointment,
                        date: apt.date,
                        startHour: apt.startHour,
                        endHour: apt.endHour,
                        repeatAppointment: true,
                        repeatConfig: newRepeatConfig,
                        createdAt: new Date()
                    };
                    delete newAppointmentData.id;
                    const newId = await addAppointmentFB(newAppointmentData);
                    remindersBatch.push({ ...newAppointmentData, id: newId });
                }

                // Envia os novos lembretes em lote
                await scheduleBatchWhatsappReminders(remindersBatch);

                Swal.fire('Sucesso!', `${uniqueNewAppointments.length} novos agendamentos adicionados!`, 'success');
                repeatRenewalModalInstance.hide();
                calendar.refetchEvents();
                const updatedAppointments = await getAppointmentsFB();
                await populateAppointmentsTable(updatedAppointments);
            } catch (error) {
                Swal.fire('Erro!', 'Não foi possível renovar a repetição.', 'error');
            }
        });
    }

});