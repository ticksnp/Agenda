// login.js (COMPLETO E CORRIGIDO)

// Importa a instância 'auth' do nosso arquivo de configuração
import { auth } from './firebase-config.js';

// Importa as funções que vamos usar do SDK do Firebase Auth
import { 
    signInWithEmailAndPassword, 
    createUserWithEmailAndPassword, 
    sendPasswordResetEmail, 
    onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.4.0/firebase-auth.js";

document.addEventListener('DOMContentLoaded', () => {
    // Referências aos elementos da UI de autenticação
    const loginForm = document.getElementById('loginForm');
    const registerForm = document.getElementById('registerForm');
    const forgotPasswordForm = document.getElementById('forgotPasswordForm');

    const loginEmailInput = document.getElementById('loginEmail');
    const loginPasswordInput = document.getElementById('loginPassword');

    const registerEmailInput = document.getElementById('registerEmail');
    const registerPasswordInput = document.getElementById('registerPassword');
    const registerConfirmPasswordInput = document.getElementById('registerConfirmPassword');

    const resetEmailInput = document.getElementById('resetEmail');

    // Links e Botões para alternar entre formulários
    const registerBtn = document.getElementById('registerBtn');
    const forgotPasswordLink = document.getElementById('forgotPasswordLink');
    const backToLoginFromRegisterBtn = document.getElementById('backToLoginFromRegister');
    const backToLoginFromResetBtn = document.getElementById('backToLoginFromReset');
    
    // Observador do estado de autenticação
    // Se o usuário já estiver logado, redireciona para a aplicação principal
    onAuthStateChanged(auth, user => {
        if (user) {
            // Já logado, vai para a página principal
            window.location.href = 'index.html';
        }
        // Se não houver usuário, ele simplesmente permanece na página de login.
    });

    // Lógica de Login
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = loginEmailInput.value;
            const password = loginPasswordInput.value;

            Swal.fire({ title: 'Entrando...', allowOutsideClick: false, didOpen: () => { Swal.showLoading(); } });

            try {
                await signInWithEmailAndPassword(auth, email, password);
                // O onAuthStateChanged acima cuidará do redirecionamento
            } catch (error) {
                let errorMessage = 'Erro ao fazer login. Verifique suas credenciais.';
                if (error.code === 'auth/invalid-credential' || error.code === 'auth/wrong-password' || error.code === 'auth/user-not-found') {
                    errorMessage = 'E-mail ou senha incorretos.';
                }
                Swal.fire('Erro!', errorMessage, 'error');
            }
        });
    }

    // Lógica de Cadastro
    if (registerForm) {
        registerForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = registerEmailInput.value;
            const password = registerPasswordInput.value;
            const confirmPassword = registerConfirmPasswordInput.value;

            if (password !== confirmPassword) {
                Swal.fire("Erro!", "As senhas não coincidem!", "error");
                return;
            }

            Swal.fire({ title: 'Criando conta...', allowOutsideClick: false, didOpen: () => { Swal.showLoading(); } });

            try {
                await createUserWithEmailAndPassword(auth, email, password);
                Swal.fire("Sucesso!", "Conta criada com sucesso! Faça o login para continuar.", "success");
                registerForm.reset();
                registerForm.classList.add('d-none');
                loginForm.classList.remove('d-none');
            } catch (error) {
                let errorMessage = 'Ocorreu um erro ao criar a conta.';
                if (error.code === 'auth/email-already-in-use') {
                    errorMessage = 'Este e-mail já está em uso por outra conta.';
                } else if (error.code === 'auth/weak-password') {
                    errorMessage = 'A senha é muito fraca. Use pelo menos 6 caracteres.';
                }
                Swal.fire("Erro ao criar conta", errorMessage, "error");
            }
        });
    }

    // --- LÓGICA DE REDEFINIÇÃO DE SENHA (CORRIGIDA) ---
    if (forgotPasswordForm) {
        forgotPasswordForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = resetEmailInput.value.trim();
            if (!email) {
                Swal.fire("Atenção", "Por favor, informe seu e-mail.", "warning");
                return;
            }

            Swal.fire({ title: 'Aguarde...', text: 'Enviando solicitação.', allowOutsideClick: false, didOpen: () => { Swal.showLoading(); } });

            try {
                // CORREÇÃO: Chamamos a função de envio diretamente.
                // O Firebase lida com o caso de o e-mail não existir internamente e não gera um erro por isso.
                await sendPasswordResetEmail(auth, email);

                // Mostramos sempre uma mensagem de sucesso para evitar que atacantes
                // descubram quais e-mails estão cadastrados no sistema.
                Swal.fire({
                    icon: 'success',
                    title: 'Verifique seu e-mail',
                    text: 'Se um usuário com este e-mail estiver cadastrado, um link para redefinição de senha será enviado. Verifique sua caixa de entrada e a pasta de spam.'
                });
                
                forgotPasswordForm.classList.add('d-none');
                loginForm.classList.remove('d-none');
            } catch (error) {
                // Este erro agora só deve acontecer para problemas reais (ex: e-mail mal formatado, problemas de rede).
                console.error("Erro ao enviar e-mail de redefinição:", error);
                Swal.fire("Erro!", "Ocorreu um erro ao tentar enviar o e-mail. Verifique o e-mail digitado e tente novamente.", "error");
            }
        });
    }


    // Navegação entre formulários
    if (registerBtn) {
        registerBtn.addEventListener('click', () => {
            loginForm.classList.add('d-none');
            forgotPasswordForm.classList.add('d-none');
            registerForm.classList.remove('d-none');
        });
    }
    
    if(backToLoginFromRegisterBtn) {
        backToLoginFromRegisterBtn.addEventListener('click', () => {
            registerForm.classList.add('d-none');
            loginForm.classList.remove('d-none');
        });
    }

    if(forgotPasswordLink) {
        forgotPasswordLink.addEventListener('click', (e) => {
            e.preventDefault();
            loginForm.classList.add('d-none');
            registerForm.classList.add('d-none');
            forgotPasswordForm.classList.remove('d-none');
        });
    }

    if(backToLoginFromResetBtn) {
        backToLoginFromResetBtn.addEventListener('click', () => {
            forgotPasswordForm.classList.add('d-none');
            loginForm.classList.remove('d-none');
        });
    }
});