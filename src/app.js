// app.js - Bot WhatsApp - Evolution API v2 com Geração de Documentos - VERSÃO CORRIGIDA
require('dotenv').config();
const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const TelegramBot = require('node-telegram-bot-api');

// Importar serviços
const Database = require('./database/database');
const UserService = require('./services/userService');
const ConversationService = require('./services/conversationService');
const GroqTranscription = require('./transcription/groqTranscription');
const { generateDocument, documentExists, cleanupOldFiles } = require('./document-generator');

// Configurações
const config = {
    EVOLUTION_API_URL: process.env.EVOLUTION_API_URL || 'https://evolution.pxbetapp.win',
    API_KEY: process.env.API_KEY || '6E3FB6094C50-414D-BDA5-9E4E39FC82D4',
    INSTANCE_NAME: process.env.INSTANCE_NAME || 'bot',
    PORT: process.env.PORT || 3002,
    GROQ_API_KEY: process.env.GROQ_API_KEY,
    REFERRAL_CODE: process.env.REFERRAL_CODE || 'AGENT2024',
    PRICES: {
        '1_5': parseFloat(process.env.PRICE_1_5_DAYS || '100'),
        '6_10': parseFloat(process.env.PRICE_6_10_DAYS || '150'),
        '11_15': parseFloat(process.env.PRICE_11_15_DAYS || '200')
    },
    CONVERSATION_TIMEOUT_MINUTES: parseInt(process.env.CONVERSATION_TIMEOUT_MINUTES || '30'),
    TRUST_PROXY: process.env.TRUST_PROXY === 'true' || false,
    PIX_KEY: process.env.PIX_KEY || 'seupix@email.com',
    ADMIN_TELEGRAM_BOT_TOKEN: process.env.ADMIN_TELEGRAM_BOT_TOKEN,
    ADMIN_TELEGRAM_CHAT_ID: process.env.ADMIN_TELEGRAM_CHAT_ID,
    ADMIN_API_KEY: process.env.ADMIN_API_KEY || 'ADMIN_SECRET_KEY_2024'
};

// Sistema de Log Simplificado
class Logger {
    constructor() {
        this.logFile = 'logs/bot.log';
        this.ensureLogDirectory();
    }
    
    ensureLogDirectory() {
        const logDir = path.dirname(this.logFile);
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true });
        }
    }
    
    log(level, message, data = null) {
        const timestamp = new Date().toISOString();
        const logEntry = { timestamp, level: level.toUpperCase(), message, ...(data && { data }) };
        
        console.log(JSON.stringify(logEntry));
        
        try {
            fs.appendFileSync(this.logFile, JSON.stringify(logEntry) + '\n');
        } catch (error) {
            console.error('Erro ao escrever log:', error);
        }
    }
    
    error(message, data = null) { this.log('error', message, data); }
    info(message, data = null) { this.log('info', message, data); }
    
    maskNumber(number) {
        if (!number || number.length < 8) return number;
        const cleanNumber = number.replace(/\D/g, '');
        return cleanNumber.slice(0, 4) + '*'.repeat(cleanNumber.length - 8) + cleanNumber.slice(-4);
    }
}

const logger = new Logger();

// Estados do Bot
const BOT_STATES = {
    INITIAL: 'initial',
    GREETING: 'greeting',
    SHOWING_SERVICE: 'showing_service',
    SHOWING_PRICES: 'showing_prices',
    SHOWING_EXAMPLE: 'showing_example',
    INTERESTED: 'interested',
    COLLECTING_DAYS: 'collecting_days',
    COLLECTING_NAME: 'collecting_name',
    COLLECTING_CPF: 'collecting_cpf',
    COLLECTING_DATE: 'collecting_date',
    COLLECTING_TIME: 'collecting_time',
    COLLECTING_CID: 'collecting_cid',
    SHOWING_SUMMARY: 'showing_summary',
    AWAITING_PAYMENT: 'awaiting_payment',
    PAYMENT_SENT: 'payment_sent',
    PAYMENT_PROOF_SENT: 'payment_proof_sent',
    GENERATING_DOCUMENT: 'generating_document',
    COMPLETED: 'completed',
    SUPPORT: 'support'
};

// Sistema de Circuit Breaker para operações críticas
class CircuitBreaker {
    constructor(threshold = 5, timeout = 60000) {
        this.failureThreshold = threshold;
        this.timeout = timeout;
        this.failureCount = 0;
        this.lastFailureTime = null;
        this.state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
    }
    
    async execute(operation) {
        if (this.state === 'OPEN') {
            if (Date.now() - this.lastFailureTime < this.timeout) {
                throw new Error('Circuit breaker is OPEN');
            }
            this.state = 'HALF_OPEN';
        }
        
        try {
            const result = await operation();
            this.onSuccess();
            return result;
        } catch (error) {
            this.onFailure();
            throw error;
        }
    }
    
    onSuccess() {
        this.failureCount = 0;
        this.state = 'CLOSED';
    }
    
    onFailure() {
        this.failureCount++;
        this.lastFailureTime = Date.now();
        if (this.failureCount >= this.failureThreshold) {
            this.state = 'OPEN';
        }
    }
}

// Instâncias de Circuit Breakers
const dbCircuitBreaker = new CircuitBreaker(3, 30000);
const apiCircuitBreaker = new CircuitBreaker(5, 60000);

// Palavras-chave
const KEYWORDS = {
    ATESTADO: ['atestado', 'atestados', 'documento', 'documentos', 'médico', 'medico', 'papel', 'licença', 'licenca', 'falta', 'trabalho'],
    PREÇO: ['preço', 'preços', 'preco', 'precos', 'valor', 'valores', 'quanto custa', 'quanto tá', 'quanto esta', 'qual o valor', 'quanto'],
    EXEMPLO: ['exemplo', 'modelo', 'sample', 'ver', 'mostrar', 'mostra', 'foto', 'como', 'imagem'],
    COMPRAR: ['comprar', 'quero', 'solicitar', 'pedir', 'fazer pedido', 'adquirir'],
    CONFIRMAR: ['sim', 'confirmar', 'confirmo', 'ok', 'está correto', 'esta correto', 'correto'],
    CANCELAR: ['não', 'nao', 'cancelar', 'voltar', 'incorreto', 'errado'],
    SUPORTE: ['suporte', 'ajuda', 'problema', 'erro', 'duvida', 'dúvida', 'falar', 'atendimento', 'humano'],
    MENU: ['menu', 'início', 'inicio', 'começar', 'comecar', 'start', 'oi', 'olá', 'ola', 'hey'],
    PAGAMENTO: ['pago', 'paguei', 'pagamento', 'comprovante', 'pix', 'transferencia', 'transferência', 'enviado', 'feito']
};

let database, userService, conversationService, groqTranscription, telegramAdminBot, orderService;

// Pool de conexões para melhor performance
class ConnectionPool {
    constructor() {
        this.connections = new Map();
        this.maxConnections = 10;
        this.connectionTimeout = 30000;
    }
    
    async getConnection(key) {
        if (this.connections.has(key)) {
            const connection = this.connections.get(key);
            if (Date.now() - connection.lastUsed < this.connectionTimeout) {
                connection.lastUsed = Date.now();
                return connection.instance;
            } else {
                this.connections.delete(key);
            }
        }
        return null;
    }
    
    setConnection(key, instance) {
        if (this.connections.size >= this.maxConnections) {
            // Remove conexão mais antiga
            const oldestKey = Array.from(this.connections.entries())
                .sort(([,a], [,b]) => a.lastUsed - b.lastUsed)[0][0];
            this.connections.delete(oldestKey);
        }
        
        this.connections.set(key, {
            instance,
            lastUsed: Date.now()
        });
    }
    
    cleanup() {
        const now = Date.now();
        for (const [key, connection] of this.connections.entries()) {
            if (now - connection.lastUsed > this.connectionTimeout) {
                this.connections.delete(key);
            }
        }
    }
}

const connectionPool = new ConnectionPool();

// Limpeza periódica do pool
setInterval(() => {
    connectionPool.cleanup();
}, 60000); // Limpar a cada minuto

// Serviço de Pedidos
class OrderService {
    constructor(database) {
        this.database = database;
    }

    async createOrder(userId, orderData) {
        return await dbCircuitBreaker.execute(async () => {
            const orderId = `ORD${Date.now()}${Math.random().toString(36).substr(2, 4).toUpperCase()}`;
            
            const query = `
                INSERT INTO orders (id, user_id, days, name, cpf, entry_date, entry_time, cid_code, price, status, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', datetime('now'))
            `;
            
            await this.database.run(query, [
                orderId, userId, orderData.days, orderData.name, orderData.cpf, 
                orderData.entryDate, orderData.entryTime, orderData.cidCode, orderData.price
            ]);
            
            return orderId;
        });
    }

    async getOrder(orderId) {
        return await dbCircuitBreaker.execute(async () => {
            const query = 'SELECT * FROM orders WHERE id = ?';
            return await this.database.get(query, [orderId]);
        });
    }
    
    // Nova função para buscar pedido ativo por usuário
    async getActiveOrderByUserId(userId) {
        return await dbCircuitBreaker.execute(async () => {
            const query = `
                SELECT * FROM orders 
                WHERE user_id = ? AND status IN ('pending', 'payment_sent') 
                ORDER BY created_at DESC 
                LIMIT 1
            `;
            return await this.database.get(query, [userId]);
        });
    }

    async updateOrderStatus(orderId, status) {
        return await dbCircuitBreaker.execute(async () => {
            const query = 'UPDATE orders SET status = ?, updated_at = datetime("now") WHERE id = ?';
            await this.database.run(query, [status, orderId]);
        });
    }

    async saveOrderData(conversationId, key, value) {
        return await dbCircuitBreaker.execute(async () => {
            const query = `
                INSERT OR REPLACE INTO order_data (conversation_id, data_key, data_value, created_at)
                VALUES (?, ?, ?, datetime('now'))
            `;
            await this.database.run(query, [conversationId, key, value]);
        });
    }

    async getOrderData(conversationId) {
        return await dbCircuitBreaker.execute(async () => {
            const query = 'SELECT data_key, data_value FROM order_data WHERE conversation_id = ?';
            const rows = await this.database.all(query, [conversationId]);
            
            const orderData = {};
            rows.forEach(row => {
                orderData[row.data_key] = row.data_value;
            });
            
            return orderData;
        });
    }

    async clearOrderData(conversationId) {
        return await dbCircuitBreaker.execute(async () => {
            const query = 'DELETE FROM order_data WHERE conversation_id = ?';
            await this.database.run(query, [conversationId]);
        });
    }
}

// Sistema de Retry para operações críticas
class RetrySystem {
    static async withRetry(operation, maxRetries = 3, delay = 1000) {
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                return await Promise.race([
                    operation(),
                    new Promise((_, reject) => 
                        setTimeout(() => reject(new Error('Operation timeout')), 30000)
                    )
                ]);
            } catch (error) {
                logger.error(`Tentativa ${attempt}/${maxRetries} falhou:`, { error: error.message });
                
                if (attempt === maxRetries) {
                    throw error;
                }
                
                await new Promise(resolve => setTimeout(resolve, delay * attempt));
            }
        }
    }
}

// Telegram Service para Admin - Melhorado
class TelegramService {
    constructor() {
        this.botToken = config.ADMIN_TELEGRAM_BOT_TOKEN;
        this.adminChatId = config.ADMIN_TELEGRAM_CHAT_ID;
    }

    async sendMessage(text) {
        if (!this.botToken || !this.adminChatId) {
            logger.error('Telegram não configurado');
            return;
        }

        try {
            await RetrySystem.withRetry(async () => {
                return await axios.post(`https://api.telegram.org/bot${this.botToken}/sendMessage`, {
                    chat_id: this.adminChatId,
                    text: text,
                    parse_mode: 'HTML'
                }, { timeout: 10000 });
            });
        } catch (error) {
            logger.error('Erro ao enviar mensagem Telegram:', { error: error.message });
        }
    }
    
    // Nova função para notificar suporte
    async notifySupport(userPhone, userName, message) {
        const supportMsg = `
🆘 <b>SOLICITAÇÃO DE SUPORTE</b>

👤 <b>Cliente:</b> ${userName || 'Não informado'}
📱 <b>Telefone:</b> ${userPhone}
💬 <b>Mensagem:</b> ${message}
⏰ <b>Horário:</b> ${new Date().toLocaleString('pt-BR')}

<i>Responda o mais breve possível ao cliente!</i>
        `;
        
        await this.sendMessage(supportMsg);
    }
    
    // Nova função para notificar comprovante
    async notifyPaymentProof(orderId, userPhone, userName) {
        const proofMsg = `
📄 <b>COMPROVANTE RECEBIDO!</b>

📋 <b>Pedido:</b> ${orderId}
👤 <b>Cliente:</b> ${userName}
📱 <b>Telefone:</b> ${userPhone}
⏰ <b>Recebido:</b> ${new Date().toLocaleString('pt-BR')}

<i>⚡ Cliente informou que o pagamento foi realizado!</i>
<i>Verifique e aprove o pedido o mais breve possível.</i>
        `;
        
        await this.sendMessage(proofMsg);
    }

    async sendPhoto(photoPath, caption) {
        if (!this.botToken || !this.adminChatId || !fs.existsSync(photoPath)) {
            return;
        }

        try {
            const FormData = require('form-data');
            const form = new FormData();
            form.append('chat_id', this.adminChatId);
            form.append('photo', fs.createReadStream(photoPath));
            form.append('caption', caption);
            form.append('parse_mode', 'HTML');

            await axios.post(`https://api.telegram.org/bot${this.botToken}/sendPhoto`, form, {
                headers: form.getHeaders()
            });
        } catch (error) {
            logger.error('Erro ao enviar foto Telegram:', { error: error.message });
        }
    }

    async notifyNewOrder(orderData, orderId) {
        const message = `
🆕 <b>NOVO PEDIDO!</b>

📋 <b>ID:</b> ${orderId}
👤 <b>Nome:</b> ${orderData.name}
📱 <b>CPF:</b> ${orderData.cpf}
📅 <b>Dias:</b> ${orderData.days}
📆 <b>Data:</b> ${orderData.entryDate}
⏰ <b>Horário:</b> ${orderData.entryTime}
🏥 <b>CID:</b> ${orderData.cidCode}
💰 <b>Valor:</b> R$ ${orderData.price}

Aguardando pagamento PIX...
        `;

        await this.sendMessage(message);
    }

    async notifyPaymentReceived(orderId) {
        const message = `
✅ <b>PAGAMENTO RECEBIDO!</b>

📋 <b>Pedido:</b> ${orderId}

Gerando documento...
        `;

        await this.sendMessage(message);
    }
}

const telegramService = new TelegramService();

// Telegram Admin Bot integrado
class TelegramAdminBot {
    constructor() {
        this.bot = null;
        this.adminChatId = config.ADMIN_TELEGRAM_CHAT_ID;
        this.isInitialized = false;
    }
    
    async initialize() {
        if (!config.ADMIN_TELEGRAM_BOT_TOKEN || !config.ADMIN_TELEGRAM_CHAT_ID) {
            logger.info('Bot Telegram Admin não configurado - ignorando');
            return;
        }
        
        try {
            this.bot = new TelegramBot(config.ADMIN_TELEGRAM_BOT_TOKEN, { polling: true });
            this.setupEventHandlers();
            this.isInitialized = true;
            
            logger.info('Bot Telegram Admin inicializado');
            await this.sendMessage('🤖 *Bot Admin Iniciado*\n\nDigite /help para ver os comandos disponíveis.');
            
        } catch (error) {
            logger.error('Erro ao inicializar Bot Telegram Admin:', { error: error.message });
        }
    }
    
    async sendMessage(text) {
        if (!this.isInitialized || !this.bot) return;
        
        try {
            await this.bot.sendMessage(this.adminChatId, text, { parse_mode: 'Markdown' });
        } catch (error) {
            logger.error('Erro ao enviar mensagem Telegram Admin:', { error: error.message });
        }
    }
    
    setupEventHandlers() {
        if (!this.bot) return;
        
        // Callback queries para botões inline
        this.bot.on('callback_query', async (callbackQuery) => {
            const chatId = callbackQuery.message.chat.id;
            const messageId = callbackQuery.message.message_id;
            const data = callbackQuery.data;
            
            // Verificar se é o admin autorizado
            if (chatId.toString() !== this.adminChatId) {
                await this.bot.answerCallbackQuery(callbackQuery.id, { text: 'Não autorizado!' });
                return;
            }
            
            try {
                if (data.startsWith('approve_')) {
                    const orderId = data.replace('approve_', '');
                    await this.handleApproveCallback(callbackQuery, orderId);
                    
                } else if (data.startsWith('reject_')) {
                    const orderId = data.replace('reject_', '');
                    await this.handleRejectCallback(callbackQuery, orderId);
                    
                } else if (data.startsWith('confirm_approve_')) {
                    const orderId = data.replace('confirm_approve_', '');
                    await this.confirmApprove(callbackQuery, orderId);
                    
                } else if (data.startsWith('confirm_reject_')) {
                    const orderId = data.replace('confirm_reject_', '');
                    await this.confirmReject(callbackQuery, orderId);
                    
                } else if (data.startsWith('details_')) {
                    const orderId = data.replace('details_', '');
                    await this.showOrderDetails(callbackQuery, orderId);
                    
                } else if (data === 'cancel') {
                    await this.bot.editMessageText('❌ Operação cancelada', {
                        chat_id: chatId,
                        message_id: messageId
                    });
                    await this.bot.answerCallbackQuery(callbackQuery.id, { text: 'Cancelado' });
                    
                } else if (data === 'refresh_pending') {
                    await this.refreshPendingOrders(callbackQuery);
                }
                
            } catch (error) {
                logger.error('Erro no callback query:', { error: error.message, data });
                await this.bot.answerCallbackQuery(callbackQuery.id, { text: 'Erro interno!' });
            }
        });
        
        // Comando /start
        this.bot.onText(/\/start/, async (msg) => {
            if (msg.chat.id.toString() !== this.adminChatId) return;
            
            const welcomeMsg = `🏥 *Bot Admin - Sistema de Atestados*\n\n✅ Bot iniciado com sucesso!\n\nDigite /help para ver todos os comandos disponíveis.`;
            await this.sendMessage(welcomeMsg);
        });
        
        // Comando /help
        this.bot.onText(/\/help/, async (msg) => {
            if (msg.chat.id.toString() !== this.adminChatId) return;
            
            const helpMsg = `📋 *COMANDOS DO BOT ADMIN*\n\n` +
                          `⚡ *COMANDOS RÁPIDOS:*\n` +
                          `🚀 /quick - Acesso super rápido aos pedidos\n` +
                          `📋 /pending - Pedidos com botões clicáveis\n\n` +
                          `📊 *RELATÓRIOS:*\n` +
                          `📈 /stats - Estatísticas gerais\n` +
                          `💰 /revenue - Faturamento detalhado\n\n` +
                          `🔧 *COMANDOS TRADICIONAIS:*\n` +
                          `✅ /approve [ID] - Aprovar via texto\n` +
                          `❌ /reject [ID] - Rejeitar via texto\n` +
                          `🔍 /order [ID] - Detalhes do pedido\n\n` +
                          `💡 *NOVO! Interface com Botões:*\n` +
                          `• Use /pending para ver pedidos com botões\n` +
                          `• Clique em ✅ Aprovar ou ❌ Rejeitar\n` +
                          `• Sem necessidade de digitar IDs!\n` +
                          `• Confirmação automática para segurança`;
            
            await this.sendMessage(helpMsg);
        });
        
        // Comando /stats
        this.bot.onText(/\/stats/, async (msg) => {
            if (msg.chat.id.toString() !== this.adminChatId) return;
            
            try {
                const stats = await this.getOrdersStats();
                
                const statsMsg = `📊 *ESTATÍSTICAS DO SISTEMA*\n\n` +
                               `📋 *Pedidos:*\n` +
                               `• Total: ${stats.total}\n` +
                               `• Pendentes: ${stats.pending}\n` +
                               `• Aprovados: ${stats.approved}\n` +
                               `• Concluídos: ${stats.completed}\n` +
                               `• Rejeitados: ${stats.rejected}\n\n` +
                               `💰 *Faturamento:*\n` +
                               `• Hoje: R$ ${stats.todayRevenue.toFixed(2)}\n` +
                               `• Mês atual: R$ ${stats.monthlyRevenue.toFixed(2)}`;
                
                await this.sendMessage(statsMsg);
                
            } catch (error) {
                await this.sendMessage('❌ Erro ao buscar estatísticas');
                logger.error('Erro ao buscar stats:', { error: error.message });
            }
        });
        
        // Comando /quick - Acesso super rápido
        this.bot.onText(/\/quick/, async (msg) => {
            if (msg.chat.id.toString() !== this.adminChatId) return;
            
            try {
                const orders = await this.getPendingOrders();
                
                if (orders.length === 0) {
                    const keyboard = {
                        inline_keyboard: [
                            [{ text: '🔄 Atualizar', callback_data: 'refresh_pending' }],
                            [{ text: '📊 Ver Estatísticas', callback_data: 'quick_stats' }]
                        ]
                    };
                    
                    await this.bot.sendMessage(this.adminChatId, 
                        '🎉 *PARABÉNS!*\n\n✅ Nenhum pedido pendente no momento.\n\nTodos os pedidos foram processados!', 
                        {
                            reply_markup: keyboard,
                            parse_mode: 'Markdown'
                        }
                    );
                    return;
                }
                
                // Mostrar apenas os 3 primeiros pedidos de forma compacta
                const quickMsg = `⚡ *ACESSO RÁPIDO* ⚡\n\n📊 ${orders.length} pedidos pendentes`;
                
                await this.bot.sendMessage(this.adminChatId, quickMsg, { parse_mode: 'Markdown' });
                
                for (const order of orders.slice(0, 3)) {
                    await this.sendQuickOrderCard(order);
                }
                
                if (orders.length > 3) {
                    const moreKeyboard = {
                        inline_keyboard: [
                            [
                                { text: `📋 Ver todos (${orders.length})`, callback_data: 'refresh_pending' },
                                { text: '🔄 Atualizar', callback_data: 'refresh_pending' }
                            ]
                        ]
                    };
                    
                    await this.bot.sendMessage(this.adminChatId, 
                        `📦 Mostrando 3 de ${orders.length} pedidos.\n\nUse os botões abaixo para ver mais:`, 
                        {
                            reply_markup: moreKeyboard,
                            parse_mode: 'Markdown'
                        }
                    );
                }
                
            } catch (error) {
                await this.sendMessage('❌ Erro no acesso rápido');
                logger.error('Erro no comando quick:', { error: error.message });
            }
        });
        
        // Comando /pending com botões inline
        this.bot.onText(/\/pending/, async (msg) => {
            if (msg.chat.id.toString() !== this.adminChatId) return;
            
            try {
                const orders = await this.getPendingOrders();
                
                if (orders.length === 0) {
                    const keyboard = {
                        inline_keyboard: [[
                            { text: '🔄 Atualizar', callback_data: 'refresh_pending' }
                        ]]
                    };
                    
                    await this.bot.sendMessage(this.adminChatId, '✅ Nenhum pedido pendente no momento.', {
                        reply_markup: keyboard,
                        parse_mode: 'Markdown'
                    });
                    return;
                }
                
                // Enviar cada pedido como uma mensagem separada com botões
                await this.bot.sendMessage(this.adminChatId, `⏳ *PEDIDOS PENDENTES (${orders.length})*`, {
                    parse_mode: 'Markdown'
                });
                
                for (const order of orders.slice(0, 5)) { // Limitar a 5 pedidos por vez
                    await this.sendOrderWithButtons(order);
                }
                
                if (orders.length > 5) {
                    const remainingOrders = orders.length - 5;
                    await this.bot.sendMessage(this.adminChatId, `📋 Mostrando 5 de ${orders.length} pedidos.\n\n*${remainingOrders} pedidos restantes...*\n\nUse /pending novamente para ver mais.`, {
                        parse_mode: 'Markdown'
                    });
                }
                
            } catch (error) {
                await this.sendMessage('❌ Erro ao buscar pedidos pendentes');
                logger.error('Erro ao buscar pedidos pendentes:', { error: error.message });
            }
        });
        
        // Comando /approve (mantido para compatibilidade)
        this.bot.onText(/\/approve (.+)/, async (msg, match) => {
            if (msg.chat.id.toString() !== this.adminChatId) return;
            
            const orderId = match[1].trim();
            await this.processApproval(orderId, msg.chat.id);
        });
        
        // Comando /reject (mantido para compatibilidade)
        this.bot.onText(/\/reject (.+)/, async (msg, match) => {
            if (msg.chat.id.toString() !== this.adminChatId) return;
            
            const orderId = match[1].trim();
            await this.processRejection(orderId, msg.chat.id);
        });
        
        // Comando /order
        this.bot.onText(/\/order (.+)/, async (msg, match) => {
            if (msg.chat.id.toString() !== this.adminChatId) return;
            
            const orderId = match[1].trim();
            
            try {
                const order = await this.getOrderById(orderId);
                
                if (!order) {
                    await this.sendMessage(`❌ Pedido ${orderId} não encontrado`);
                    return;
                }
                
                const phone = order.phone_number.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3');
                const cpf = order.cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
                
                const orderMsg = `📋 *DETALHES DO PEDIDO*\n\n` +
                               `🆔 *ID:* ${order.id}\n` +
                               `📊 *Status:* ${order.status.toUpperCase()}\n\n` +
                               `👤 *Cliente:*\n` +
                               `• Nome: ${order.name}\n` +
                               `• CPF: ${cpf}\n` +
                               `• Telefone: ${phone}\n\n` +
                               `📄 *Atestado:*\n` +
                               `• Dias: ${order.days}\n` +
                               `• Data: ${order.entry_date}\n` +
                               `• Horário: ${order.entry_time}\n` +
                               `• CID: ${order.cid_code}\n\n` +
                               `💰 *Valor:* R$ ${order.price.toFixed(2)}\n\n` +
                               `📅 *Criado:* ${new Date(order.created_at).toLocaleString('pt-BR')}\n` +
                               `📅 *Atualizado:* ${new Date(order.updated_at).toLocaleString('pt-BR')}`;
                
                await this.sendMessage(orderMsg);
                
                if (order.status === 'pending') {
                    const actionMsg = `*Ações disponíveis:*\n• /approve ${orderId}\n• /reject ${orderId}`;
                    await this.sendMessage(actionMsg);
                }
                
            } catch (error) {
                await this.sendMessage(`❌ Erro ao buscar pedido ${orderId}`);
                logger.error('Erro ao buscar pedido:', { orderId, error: error.message });
            }
        });
        
        // Comando /revenue
        this.bot.onText(/\/revenue/, async (msg) => {
            if (msg.chat.id.toString() !== this.adminChatId) return;
            
            try {
                const stats = await this.getOrdersStats();
                
                const weeklyQuery = `
                    SELECT COALESCE(SUM(price), 0) as revenue 
                    FROM orders 
                    WHERE status = 'completed' 
                    AND date(created_at) >= date('now', 'weekday 0', '-6 days')
                `;
                const weeklyResult = await database.get(weeklyQuery);
                const weeklyRevenue = weeklyResult.revenue;
                
                const revenueMsg = `💰 *RELATÓRIO DE FATURAMENTO*\n\n` +
                                 `📅 *Hoje:* R$ ${stats.todayRevenue.toFixed(2)}\n` +
                                 `📅 *Esta semana:* R$ ${weeklyRevenue.toFixed(2)}\n` +
                                 `📅 *Este mês:* R$ ${stats.monthlyRevenue.toFixed(2)}\n\n` +
                                 `📊 *Pedidos concluídos:* ${stats.completed}`;
                
                await this.sendMessage(revenueMsg);
                
            } catch (error) {
                await this.sendMessage('❌ Erro ao buscar relatório de faturamento');
                logger.error('Erro ao buscar revenue:', { error: error.message });
            }
        });
    }
    
    // Métodos para botões inline
    async sendQuickOrderCard(order) {
        try {
            const timeAgo = this.getTimeAgo(new Date(order.created_at));
            
            const quickMsg = `💰 *R$ ${order.price.toFixed(2)}* - ${order.days} dias\n` +
                           `👤 ${order.name}\n` +
                           `🕐 ${timeAgo}`;
            
            const keyboard = {
                inline_keyboard: [
                    [
                        { text: '✅ APROVAR', callback_data: `approve_${order.id}` },
                        { text: '❌ REJEITAR', callback_data: `reject_${order.id}` }
                    ]
                ]
            };
            
            await this.bot.sendMessage(this.adminChatId, quickMsg, {
                reply_markup: keyboard,
                parse_mode: 'Markdown'
            });
            
        } catch (error) {
            logger.error('Erro ao enviar quick order card:', { error: error.message, orderId: order.id });
        }
    }
    
    async sendOrderWithButtons(order) {
        try {
            const phone = order.phone_number.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3');
            const cpf = order.cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
            
            const orderMsg = `📋 *${order.id}*\n\n` +
                           `👤 *Cliente:* ${order.name}\n` +
                           `📱 *Telefone:* ${phone}\n` +
                           `🆔 *CPF:* ${cpf}\n` +
                           `📅 *Dias:* ${order.days}\n` +
                           `💰 *Valor:* R$ ${order.price.toFixed(2)}\n` +
                           `⏰ *Criado:* ${new Date(order.created_at).toLocaleString('pt-BR')}`;
            
            const keyboard = {
                inline_keyboard: [
                    [
                        { text: '✅ Aprovar', callback_data: `approve_${order.id}` },
                        { text: '❌ Rejeitar', callback_data: `reject_${order.id}` }
                    ],
                    [
                        { text: '🔍 Detalhes', callback_data: `details_${order.id}` }
                    ]
                ]
            };
            
            await this.bot.sendMessage(this.adminChatId, orderMsg, {
                reply_markup: keyboard,
                parse_mode: 'Markdown'
            });
            
        } catch (error) {
            logger.error('Erro ao enviar pedido com botões:', { error: error.message, orderId: order.id });
        }
    }
    
    async handleApproveCallback(callbackQuery, orderId) {
        const chatId = callbackQuery.message.chat.id;
        const messageId = callbackQuery.message.message_id;
        
        // Mostrar confirmação
        const keyboard = {
            inline_keyboard: [
                [
                    { text: '✅ Sim, Aprovar', callback_data: `confirm_approve_${orderId}` },
                    { text: '❌ Cancelar', callback_data: 'cancel' }
                ]
            ]
        };
        
        await this.bot.editMessageText(
            `🤔 *Confirmar Aprovação*\n\nTem certeza que deseja aprovar o pedido *${orderId}*?\n\n⚠️ Esta ação não pode ser desfeita.`,
            {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: keyboard,
                parse_mode: 'Markdown'
            }
        );
        
        await this.bot.answerCallbackQuery(callbackQuery.id, { text: 'Confirme a aprovação' });
    }
    
    async handleRejectCallback(callbackQuery, orderId) {
        const chatId = callbackQuery.message.chat.id;
        const messageId = callbackQuery.message.message_id;
        
        // Mostrar confirmação
        const keyboard = {
            inline_keyboard: [
                [
                    { text: '❌ Sim, Rejeitar', callback_data: `confirm_reject_${orderId}` },
                    { text: '🔙 Cancelar', callback_data: 'cancel' }
                ]
            ]
        };
        
        await this.bot.editMessageText(
            `🤔 *Confirmar Rejeição*\n\nTem certeza que deseja rejeitar o pedido *${orderId}*?\n\n⚠️ O cliente será notificado da rejeição.`,
            {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: keyboard,
                parse_mode: 'Markdown'
            }
        );
        
        await this.bot.answerCallbackQuery(callbackQuery.id, { text: 'Confirme a rejeição' });
    }
    
    async confirmApprove(callbackQuery, orderId) {
        await this.processApproval(orderId, callbackQuery.message.chat.id, callbackQuery.message.message_id);
        await this.bot.answerCallbackQuery(callbackQuery.id, { text: '✅ Pedido aprovado!' });
    }
    
    async confirmReject(callbackQuery, orderId) {
        await this.processRejection(orderId, callbackQuery.message.chat.id, callbackQuery.message.message_id);
        await this.bot.answerCallbackQuery(callbackQuery.id, { text: '❌ Pedido rejeitado!' });
    }
    
    async showOrderDetails(callbackQuery, orderId) {
        try {
            const order = await this.getOrderById(orderId);
            
            if (!order) {
                await this.bot.answerCallbackQuery(callbackQuery.id, { text: 'Pedido não encontrado!' });
                return;
            }
            
            const phone = order.phone_number.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3');
            const cpf = order.cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
            
            const detailsMsg = `📋 *DETALHES COMPLETOS*\n\n` +
                             `🆔 *ID:* ${order.id}\n` +
                             `📊 *Status:* ${order.status.toUpperCase()}\n\n` +
                             `👤 *Cliente:*\n` +
                             `• Nome: ${order.name}\n` +
                             `• CPF: ${cpf}\n` +
                             `• Telefone: ${phone}\n\n` +
                             `📄 *Atestado:*\n` +
                             `• Dias: ${order.days}\n` +
                             `• Data: ${order.entry_date}\n` +
                             `• Horário: ${order.entry_time}\n` +
                             `• CID: ${order.cid_code}\n\n` +
                             `💰 *Valor:* R$ ${order.price.toFixed(2)}\n\n` +
                             `📅 *Criado:* ${new Date(order.created_at).toLocaleString('pt-BR')}\n` +
                             `📅 *Atualizado:* ${new Date(order.updated_at).toLocaleString('pt-BR')}`;
            
            const keyboard = {
                inline_keyboard: []
            };
            
            if (order.status === 'pending') {
                keyboard.inline_keyboard.push([
                    { text: '✅ Aprovar', callback_data: `approve_${orderId}` },
                    { text: '❌ Rejeitar', callback_data: `reject_${orderId}` }
                ]);
            }
            
            keyboard.inline_keyboard.push([
                { text: '🔙 Voltar', callback_data: 'refresh_pending' }
            ]);
            
            await this.bot.editMessageText(detailsMsg, {
                chat_id: callbackQuery.message.chat.id,
                message_id: callbackQuery.message.message_id,
                reply_markup: keyboard,
                parse_mode: 'Markdown'
            });
            
            await this.bot.answerCallbackQuery(callbackQuery.id, { text: 'Detalhes carregados' });
            
        } catch (error) {
            logger.error('Erro ao mostrar detalhes:', { error: error.message, orderId });
            await this.bot.answerCallbackQuery(callbackQuery.id, { text: 'Erro ao carregar detalhes!' });
        }
    }
    
    async refreshPendingOrders(callbackQuery) {
        try {
            const orders = await this.getPendingOrders();
            
            let msg = '';
            let keyboard = { inline_keyboard: [] };
            
            if (orders.length === 0) {
                msg = '✅ Nenhum pedido pendente no momento.';
                keyboard.inline_keyboard.push([
                    { text: '🔄 Atualizar', callback_data: 'refresh_pending' }
                ]);
            } else {
                msg = `⏳ *PEDIDOS PENDENTES ATUALIZADOS*\n\n📊 Total: ${orders.length} pedidos`;
                keyboard.inline_keyboard.push([
                    { text: '🔄 Atualizar', callback_data: 'refresh_pending' }
                ]);
            }
            
            await this.bot.editMessageText(msg, {
                chat_id: callbackQuery.message.chat.id,
                message_id: callbackQuery.message.message_id,
                reply_markup: keyboard,
                parse_mode: 'Markdown'
            });
            
            // Enviar novos pedidos se houver
            if (orders.length > 0) {
                for (const order of orders.slice(0, 3)) {
                    await this.sendOrderWithButtons(order);
                }
            }
            
            await this.bot.answerCallbackQuery(callbackQuery.id, { text: `🔄 ${orders.length} pedidos encontrados` });
            
        } catch (error) {
            logger.error('Erro ao atualizar pedidos:', { error: error.message });
            await this.bot.answerCallbackQuery(callbackQuery.id, { text: 'Erro ao atualizar!' });
        }
    }
    
    async processApproval(orderId, chatId, messageId = null) {
        try {
            const loadingMsg = `🔄 Processando aprovação do pedido *${orderId}*...\n\n⏳ Aguarde...`;
            
            if (messageId) {
                await this.bot.editMessageText(loadingMsg, {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'Markdown'
                });
            } else {
                await this.bot.sendMessage(chatId, loadingMsg, { parse_mode: 'Markdown' });
            }
            
            const response = await this.approvePayment(orderId, true);
            
            if (response.success) {
                const order = await this.getOrderById(orderId);
                const successMsg = `✅ *PEDIDO APROVADO COM SUCESSO!*\n\n` +
                                 `📋 *ID:* ${orderId}\n` +
                                 `👤 *Cliente:* ${order.name}\n` +
                                 `💰 *Valor:* R$ ${order.price.toFixed(2)}\n\n` +
                                 `🔄 O documento será gerado automaticamente e enviado para o cliente.\n\n` +
                                 `⏰ ${new Date().toLocaleString('pt-BR')}`;
                
                if (messageId) {
                    await this.bot.editMessageText(successMsg, {
                        chat_id: chatId,
                        message_id: messageId,
                        parse_mode: 'Markdown'
                    });
                } else {
                    await this.bot.sendMessage(chatId, successMsg, { parse_mode: 'Markdown' });
                }
            } else {
                throw new Error(response.error || 'Erro desconhecido');
            }
            
        } catch (error) {
            const errorMsg = `❌ *ERRO NA APROVAÇÃO*\n\n📋 Pedido: ${orderId}\n🚨 Erro: ${error.message}`;
            
            if (messageId) {
                await this.bot.editMessageText(errorMsg, {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'Markdown'
                });
            } else {
                await this.bot.sendMessage(chatId, errorMsg, { parse_mode: 'Markdown' });
            }
            
            logger.error('Erro ao aprovar pedido:', { orderId, error: error.message });
        }
    }
    
    async processRejection(orderId, chatId, messageId = null) {
        try {
            const loadingMsg = `🔄 Processando rejeição do pedido *${orderId}*...\n\n⏳ Aguarde...`;
            
            if (messageId) {
                await this.bot.editMessageText(loadingMsg, {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'Markdown'
                });
            } else {
                await this.bot.sendMessage(chatId, loadingMsg, { parse_mode: 'Markdown' });
            }
            
            const response = await this.approvePayment(orderId, false);
            
            if (response.success) {
                const order = await this.getOrderById(orderId);
                const successMsg = `❌ *PEDIDO REJEITADO*\n\n` +
                                 `📋 *ID:* ${orderId}\n` +
                                 `👤 *Cliente:* ${order.name}\n` +
                                 `💰 *Valor:* R$ ${order.price.toFixed(2)}\n\n` +
                                 `📱 O cliente foi notificado da rejeição.\n\n` +
                                 `⏰ ${new Date().toLocaleString('pt-BR')}`;
                
                if (messageId) {
                    await this.bot.editMessageText(successMsg, {
                        chat_id: chatId,
                        message_id: messageId,
                        parse_mode: 'Markdown'
                    });
                } else {
                    await this.bot.sendMessage(chatId, successMsg, { parse_mode: 'Markdown' });
                }
            } else {
                throw new Error(response.error || 'Erro desconhecido');
            }
            
        } catch (error) {
            const errorMsg = `❌ *ERRO NA REJEIÇÃO*\n\n📋 Pedido: ${orderId}\n🚨 Erro: ${error.message}`;
            
            if (messageId) {
                await this.bot.editMessageText(errorMsg, {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'Markdown'
                });
            } else {
                await this.bot.sendMessage(chatId, errorMsg, { parse_mode: 'Markdown' });
            }
            
            logger.error('Erro ao rejeitar pedido:', { orderId, error: error.message });
        }
    }
    
    // Método utilitário para calcular tempo relativo
    getTimeAgo(date) {
        const now = new Date();
        const diffMs = now - date;
        const diffMinutes = Math.floor(diffMs / (1000 * 60));
        const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        
        if (diffMinutes < 1) return 'agora mesmo';
        if (diffMinutes < 60) return `${diffMinutes}min atrás`;
        if (diffHours < 24) return `${diffHours}h atrás`;
        if (diffDays === 1) return 'ontem';
        if (diffDays < 7) return `${diffDays} dias atrás`;
        
        return date.toLocaleString('pt-BR', { 
            day: '2-digit', 
            month: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });
    }
    
    // Métodos auxiliares para acessar dados
    async getPendingOrders() {
        const query = `
            SELECT o.*, u.phone_number, u.name as user_name 
            FROM orders o 
            JOIN users u ON o.user_id = u.id 
            WHERE o.status = 'pending' 
            ORDER BY o.created_at DESC 
            LIMIT 10
        `;
        return await database.all(query);
    }
    
    async getOrderById(orderId) {
        const query = `
            SELECT o.*, u.phone_number, u.name as user_name 
            FROM orders o 
            JOIN users u ON o.user_id = u.id 
            WHERE o.id = ?
        `;
        return await database.get(query, [orderId]);
    }
    
    async getOrdersStats() {
        const queries = {
            total: 'SELECT COUNT(*) as count FROM orders',
            pending: 'SELECT COUNT(*) as count FROM orders WHERE status = "pending"',
            approved: 'SELECT COUNT(*) as count FROM orders WHERE status = "approved"',
            completed: 'SELECT COUNT(*) as count FROM orders WHERE status = "completed"',
            rejected: 'SELECT COUNT(*) as count FROM orders WHERE status = "rejected"',
            todayRevenue: `
                SELECT COALESCE(SUM(price), 0) as revenue 
                FROM orders 
                WHERE status = 'completed' 
                AND date(created_at) = date('now')
            `,
            monthlyRevenue: `
                SELECT COALESCE(SUM(price), 0) as revenue 
                FROM orders 
                WHERE status = 'completed' 
                AND date(created_at) >= date('now', 'start of month')
            `
        };
        
        const stats = {};
        for (const [key, query] of Object.entries(queries)) {
            const result = await database.get(query);
            stats[key] = result.count !== undefined ? result.count : result.revenue;
        }
        
        return stats;
    }
    
    async approvePayment(orderId, approved) {
        try {
            const response = await axios.post(
                `http://localhost:${config.PORT}/approve-payment/${orderId}`,
                { approved },
                { 
                    timeout: 30000,
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Admin-Key': config.ADMIN_API_KEY,
                        'User-Agent': 'TelegramAdminBot/1.0'
                    }
                }
            );
            
            return response.data;
            
        } catch (error) {
            logger.error('Erro na aprovação via API:', { orderId, error: error.message });
            throw error;
        }
    }
}

// Evolution API Service
class EvolutionAPI {
    constructor() {
        this.baseURL = config.EVOLUTION_API_URL;
        this.apiKey = config.API_KEY;
        this.instanceName = config.INSTANCE_NAME;
    }
    
    _cleanNumber(number) {
        return number.replace(/\D/g, '');
    }
    
    _formatNumber(number) {
        const clean = this._cleanNumber(number);
        return clean.startsWith('55') ? clean : `55${clean}`;
    }
    
    async getBase64FromMediaMessage(messageData) {
        return await apiCircuitBreaker.execute(async () => {
            return await RetrySystem.withRetry(async () => {
                const requestBody = {
                    message: {
                        key: {
                            id: messageData.key.id,
                            remoteJid: messageData.key.remoteJid,
                            fromMe: messageData.key.fromMe || false
                        }
                    },
                    convertToMp4: false
                };
                
                const response = await axios.post(
                    `${this.baseURL}/chat/getBase64FromMediaMessage/${this.instanceName}`,
                    requestBody,
                    {
                        headers: {
                            'apikey': this.apiKey,
                            'Content-Type': 'application/json'
                        },
                        timeout: 45000 // Reduzido de 60s para 45s
                    }
                );
                
                return response.data?.base64 || null;
            }, 2, 3000); // 2 tentativas com delay de 3s
        });
    }
    
    async sendMessage(number, text, options = {}) {
        return await apiCircuitBreaker.execute(async () => {
            return await RetrySystem.withRetry(async () => {
                const formattedNumber = this._formatNumber(number);
                
                const messageData = {
                    number: formattedNumber,
                    text: text,
                    delay: options.delay || 1200,
                    linkPreview: options.linkPreview || false,
                    ...(options.quoted && { quoted: options.quoted }),
                    ...(options.mentioned && { mentioned: options.mentioned }),
                    ...(options.mentionsEveryOne && { mentionsEveryOne: options.mentionsEveryOne })
                };
                
                const response = await axios.post(
                    `${this.baseURL}/message/sendText/${this.instanceName}`,
                    messageData,
                    {
                        headers: {
                            'apikey': this.apiKey,
                            'Content-Type': 'application/json'
                        },
                        timeout: 15000, // Reduzido para evitar travamentos
                        validateStatus: (status) => status < 500
                    }
                );
                
                return response.data;
            }, 2, 1500); // 2 tentativas com delay de 1.5s
        });
    }
    
    async sendMedia(number, mediaBase64, caption = '', mediatype = 'image') {
        try {
            const formattedNumber = this._formatNumber(number);
            
            const mediaData = {
                number: formattedNumber,
                mediatype: mediatype,
                media: mediaBase64,
                ...(caption && { caption: caption }),
                delay: 1200
            };
            
            const response = await axios.post(
                `${this.baseURL}/message/sendMedia/${this.instanceName}`,
                mediaData,
                {
                    headers: {
                        'apikey': this.apiKey,
                        'Content-Type': 'application/json'
                    },
                    timeout: 60000
                }
            );
            
            return response.data;
            
        } catch (error) {
            logger.error('Erro ao enviar mídia:', { error: error.message });
            return null;
        }
    }
}

const evolutionAPI = new EvolutionAPI();

// Processador de Mensagens
class MessageProcessor {
    constructor() {
        this.orderService = null;
    }

    setOrderService(orderService) {
        this.orderService = orderService;
    }

    detectIntent(message, userProfile, currentState) {
        const text = message.toLowerCase().trim();
        
        // Estados de coleta de dados
        if ([BOT_STATES.COLLECTING_DAYS, BOT_STATES.COLLECTING_NAME, BOT_STATES.COLLECTING_CPF, 
             BOT_STATES.COLLECTING_DATE, BOT_STATES.COLLECTING_TIME, BOT_STATES.COLLECTING_CID].includes(currentState)) {
            return { intent: 'data_input', safe: true };
        }

        // Detecção de pagamento/comprovante (NOVA)
        if (currentState === BOT_STATES.AWAITING_PAYMENT && 
            KEYWORDS.PAGAMENTO.some(keyword => text.includes(keyword))) {
            return { intent: 'payment_confirmation', safe: true };
        }

        // Confirmação ou cancelamento
        if (currentState === BOT_STATES.SHOWING_SUMMARY) {
            if (KEYWORDS.CONFIRMAR.some(keyword => text.includes(keyword))) {
                return { intent: 'confirm_order', safe: true };
            }
            if (KEYWORDS.CANCELAR.some(keyword => text.includes(keyword))) {
                return { intent: 'cancel_order', safe: true };
            }
        }

        // Comprar
        if (KEYWORDS.COMPRAR.some(keyword => text.includes(keyword))) {
            return { intent: 'buy_request', safe: true };
        }
        
        if (KEYWORDS.MENU.some(keyword => text.includes(keyword)) || text === '/start') {
            return { intent: 'menu_request', safe: true };
        }
        
        const canDiscussAtestado = userProfile?.is_returning || 
                                userProfile?.message_count > 1 ||
                                KEYWORDS.ATESTADO.some(keyword => text.includes(keyword)) ||
                                [BOT_STATES.SHOWING_SERVICE, BOT_STATES.SHOWING_PRICES, 
                                BOT_STATES.SHOWING_EXAMPLE, BOT_STATES.INTERESTED].includes(currentState);
        
        if (canDiscussAtestado && KEYWORDS.ATESTADO.some(keyword => text.includes(keyword))) {
            return { intent: 'atestado_interest', safe: true };
        }
        
        if (KEYWORDS.PREÇO.some(keyword => text.includes(keyword))) {
            return { intent: 'price_inquiry', safe: canDiscussAtestado };
        }
        
        if (KEYWORDS.EXEMPLO.some(keyword => text.includes(keyword))) {
            return { intent: 'example_request', safe: canDiscussAtestado };
        }
        
        if (KEYWORDS.SUPORTE.some(keyword => text.includes(keyword))) {
            return { intent: 'support_needed', safe: true };
        }
        
        if ([BOT_STATES.SHOWING_SERVICE, BOT_STATES.SHOWING_PRICES, BOT_STATES.SHOWING_EXAMPLE].includes(currentState)) {
            return { intent: 'general_interest', safe: true };
        }
        
        return { intent: 'welcome', safe: true };
    }

    getPriceForDays(days) {
        if (days >= 1 && days <= 5) return config.PRICES['1_5'];
        if (days >= 6 && days <= 10) return config.PRICES['6_10'];
        if (days >= 11 && days <= 15) return config.PRICES['11_15'];
        return null;
    }

    validateCPF(cpf) {
        const cleanCPF = cpf.replace(/\D/g, '');
        if (cleanCPF.length !== 11) return false;
        
        // Verificar se todos os dígitos são iguais
        if (/^(\d)\1{10}$/.test(cleanCPF)) return false;
        
        // Validar dígitos verificadores
        let sum = 0;
        for (let i = 0; i < 9; i++) {
            sum += parseInt(cleanCPF.charAt(i)) * (10 - i);
        }
        let digit1 = 11 - (sum % 11);
        if (digit1 === 10 || digit1 === 11) digit1 = 0;
        if (digit1 !== parseInt(cleanCPF.charAt(9))) return false;
        
        sum = 0;
        for (let i = 0; i < 10; i++) {
            sum += parseInt(cleanCPF.charAt(i)) * (11 - i);
        }
        let digit2 = 11 - (sum % 11);
        if (digit2 === 10 || digit2 === 11) digit2 = 0;
        if (digit2 !== parseInt(cleanCPF.charAt(10))) return false;
        
        return true;
    }

    validateDate(dateStr) {
        const dateRegex = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
        const match = dateStr.match(dateRegex);
        
        if (!match) return false;
        
        const day = parseInt(match[1]);
        const month = parseInt(match[2]);
        const year = parseInt(match[3]);
        
        if (month < 1 || month > 12) return false;
        if (day < 1 || day > 31) return false;
        if (year < 2020 || year > 2030) return false;
        
        const date = new Date(year, month - 1, day);
        return date.getDate() === day && date.getMonth() === (month - 1) && date.getFullYear() === year;
    }

    validateTime(timeStr) {
        const timeRegex = /^(\d{1,2}):(\d{2})$/;
        const match = timeStr.match(timeRegex);
        
        if (!match) return false;
        
        const hour = parseInt(match[1]);
        const minute = parseInt(match[2]);
        
        return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
    }

    async processAudioMessage(user, conversation, audioMessage, messageData) {
        try {
            if (!messageData.key || !messageData.key.id) {
                throw new Error('Dados da mensagem inválidos');
            }
            
            const processingMsg = "🎵 *Áudio recebido!*\n\n⏳ Processando seu áudio, aguarde um momento...";
            await evolutionAPI.sendMessage(user.phone_number, processingMsg);
            await conversationService.saveMessage(conversation.id, user.id, processingMsg, 'outgoing');
            
            const audioBase64 = await evolutionAPI.getBase64FromMediaMessage(messageData);
            
            if (!audioBase64) {
                throw new Error('Falha ao baixar áudio do WhatsApp');
            }
            
            const cleanBase64 = audioBase64.replace(/^data:audio\/[^;]+;base64,/, '');
            const audioBuffer = Buffer.from(cleanBase64, 'base64');
            
            if (audioBuffer.length === 0) {
                throw new Error('Buffer de áudio vazio');
            }
            
            const transcriptionResult = await groqTranscription.transcribeAudio(audioBuffer, {
                filename: `whatsapp_audio_${Date.now()}.ogg`,
                language: 'pt',
                model: 'whisper-large-v3-turbo'
            });
            
            if (transcriptionResult.success && transcriptionResult.text) {
                const transcribedText = transcriptionResult.text.trim();
                
                await conversationService.saveMessage(conversation.id, user.id, `[ÁUDIO TRANSCRITO] ${transcribedText}`, 'incoming');
                
                const intent = this.detectIntent(transcribedText, user, conversation.state);
                await this.handleMessage(user, conversation, transcribedText, intent);
                
            } else {
                throw new Error(transcriptionResult.error || 'Erro desconhecido na transcrição');
            }
            
        } catch (error) {
            logger.error('Erro ao processar áudio:', { error: error.message });
            
            const errorMsg = "❌ *Erro na Transcrição*\n\nDesculpe, não consegui processar seu áudio. Por favor, tente:\n\n• Enviar uma mensagem de texto\n• Gravar um áudio mais claro\n• Verificar sua conexão\n\nOu digite 'suporte' para ajuda personalizada.";
            
            await evolutionAPI.sendMessage(user.phone_number, errorMsg);
            await conversationService.saveMessage(conversation.id, user.id, errorMsg, 'outgoing');
        }
    }
    
    async processMessage(webhookData) {
        // Usar timeout e retry para evitar travamentos
        return await RetrySystem.withRetry(async () => {
            let messagesToProcess = [];
            
            if (webhookData.data) {
                messagesToProcess = Array.isArray(webhookData.data) ? webhookData.data : [webhookData.data];
            } else {
                return;
            }
            
            // Processar mensagens em paralelo para melhor performance
            const processingPromises = messagesToProcess.map(async (messageData) => {
                try {
                    if (!messageData.key || !messageData.key.id || !messageData.message || messageData.key.fromMe) {
                        return;
                    }
                    
                    let number = messageData.key.remoteJid.replace(/@[sc]\.whatsapp\.net/, '');
                    let messageText = '';
                    let isAudioMessage = false;
                    let audioMessage = null;
                    const message = messageData.message;
                    
                    if (message.conversation) {
                        messageText = message.conversation;
                    } else if (message.extendedTextMessage?.text) {
                        messageText = message.extendedTextMessage.text;
                    } else if (message.imageMessage?.caption) {
                        messageText = message.imageMessage.caption;
                    } else if (message.videoMessage?.caption) {
                        messageText = message.videoMessage.caption;
                    } else if (message.documentMessage?.caption) {
                        messageText = message.documentMessage.caption;
                    } else if (message.audioMessage) {
                        isAudioMessage = true;
                        audioMessage = message.audioMessage;
                        messageText = '[AUDIO_MESSAGE]';
                        
                        if (!audioMessage.url && !audioMessage.directPath) {
                            return;
                        }
                    }
                    
                    if (!messageText || messageText.trim().length === 0) {
                        return;
                    }
                    
                    // Operações críticas com circuit breaker
                    const user = await dbCircuitBreaker.execute(async () => {
                        return await userService.findOrCreateUser(number);
                    });
                    
                    let conversation = await dbCircuitBreaker.execute(async () => {
                        return await conversationService.getActiveConversation(user.id);
                    });
                    
                    if (!conversation) {
                        conversation = await dbCircuitBreaker.execute(async () => {
                            return await conversationService.startConversation(user.id, BOT_STATES.INITIAL);
                        });
                    }
                    
                    if (isAudioMessage && audioMessage) {
                        await this.processAudioMessage(user, conversation, audioMessage, messageData);
                    } else {
                        messageText = messageText.trim();
                        
                        const intent = this.detectIntent(messageText, user, conversation.state);
                        
                        await dbCircuitBreaker.execute(async () => {
                            await conversationService.saveMessage(conversation.id, user.id, messageText, 'incoming');
                        });
                        
                        await this.handleMessage(user, conversation, messageText, intent);
                    }
                    
                } catch (messageError) {
                    logger.error('Erro ao processar mensagem individual:', { 
                        error: messageError.message,
                        messageId: messageData.key?.id 
                    });
                    // Continuar processando outras mensagens mesmo se uma falhar
                }
            });
            
            // Aguardar todas as mensagens com timeout
            await Promise.allSettled(processingPromises);
            
        }, 2, 2000); // 2 tentativas com delay de 2s
    }

    async handleMessage(user, conversation, message, intent) {
        const currentState = conversation.state;
        let responseMessage = '';
        let newState = currentState;

        switch (intent.intent) {
            case 'menu_request':
                await this.handleMenuRequest(user, conversation);
                return;

            case 'atestado_interest':
                await this.handleAtestadoInterest(user, conversation);
                return;

            case 'price_inquiry':
                await this.handlePriceInquiry(user, conversation);
                return;

            case 'example_request':
                await this.handleExampleRequest(user, conversation);
                return;

            case 'buy_request':
                await this.handleBuyRequest(user, conversation);
                return;

            case 'data_input':
                await this.handleDataInput(user, conversation, message);
                return;

            case 'confirm_order':
                await this.handleConfirmOrder(user, conversation);
                return;

            case 'cancel_order':
                await this.handleCancelOrder(user, conversation);
                return;

            case 'payment_confirmation':
                await this.handlePaymentConfirmation(user, conversation, message);
                return;

            case 'support_needed':
                await this.handleSupportRequest(user, conversation, message);
                return;

            case 'general_interest':
                await this.handleGeneralInterest(user, conversation);
                return;

            default:
                await this.handleWelcome(user, conversation);
                return;
        }
    }

    async handleMenuRequest(user, conversation) {
        const welcomeMsg = `Olá! Seja muito bem-vindo(a) 😊${user.is_returning ? ' Que bom te ver novamente!' : ''}\n\nComo posso te ajudar hoje?\n\n📋 *Menu de Opções:*\n• Digite "atestado" - Ver nossos serviços\n• Digite "preços" - Tabela de valores\n• Digite "exemplo" - Ver modelo\n• Digite "comprar" - Fazer pedido\n• Digite "suporte" - Falar com equipe`;
        
        await evolutionAPI.sendMessage(user.phone_number, welcomeMsg);
        await conversationService.saveMessage(conversation.id, user.id, welcomeMsg, 'outgoing');
        await conversationService.updateConversationState(conversation.id, BOT_STATES.GREETING);
    }

    async handleAtestadoInterest(user, conversation) {
        const serviceMsg = `✅ *Nosso Sistema de Documentos Médicos*\n\n🏥 Oferecemos atestados médicos digitais de forma rápida e segura.\n\n📱 *Como funciona:*\n• Você fornece os dados necessários\n• Realizamos o pagamento via PIX\n• Geramos seu documento em minutos\n• Enviamos a imagem em alta qualidade\n\n💬 *Próximos passos:*\n• Digite "preços" para ver valores\n• Digite "exemplo" para ver modelo\n• Digite "comprar" para fazer pedido`;
        
        await evolutionAPI.sendMessage(user.phone_number, serviceMsg);
        await conversationService.saveMessage(conversation.id, user.id, serviceMsg, 'outgoing');
        await conversationService.updateConversationState(conversation.id, BOT_STATES.SHOWING_SERVICE);
    }

    async handlePriceInquiry(user, conversation) {
        const priceMsg = `💰 *TABELA DE PREÇOS*\n\n📅 *1 a 5 dias:* R$ ${config.PRICES['1_5']}\n📅 *6 a 10 dias:* R$ ${config.PRICES['6_10']}\n📅 *11 a 15 dias:* R$ ${config.PRICES['11_15']}\n\n✅ *Incluso:*\n• Documento em alta qualidade\n• Entrega imediata após pagamento\n• Suporte técnico\n• Dados médicos realistas\n\n💳 *Pagamento:* PIX instantâneo\n\n🛒 Digite "comprar" para fazer seu pedido!`;
        
        await evolutionAPI.sendMessage(user.phone_number, priceMsg);
        await conversationService.saveMessage(conversation.id, user.id, priceMsg, 'outgoing');
        await conversationService.updateConversationState(conversation.id, BOT_STATES.SHOWING_PRICES);
    }

    async handleExampleRequest(user, conversation) {
        const exampleMsg = "📋 *Exemplo de Documento*\n\nVou enviar uma imagem de exemplo:";
        
        await evolutionAPI.sendMessage(user.phone_number, exampleMsg);
        await conversationService.saveMessage(conversation.id, user.id, exampleMsg, 'outgoing');

        const imagePath = './images/exemplo-atestado.jpg';
        
        if (fs.existsSync(imagePath)) {
            try {
                const imageBuffer = fs.readFileSync(imagePath);
                const base64Image = imageBuffer.toString('base64');
                
                await evolutionAPI.sendMedia(
                    user.phone_number,
                    base64Image,
                    "📄 Exemplo de documento gerado\n\n🛒 Digite 'comprar' para fazer seu pedido!",
                    "image"
                );
                
                await conversationService.saveMessage(conversation.id, user.id, '[IMAGEM_EXEMPLO_ENVIADA]', 'outgoing');
                
            } catch (error) {
                logger.error('Erro ao enviar imagem de exemplo:', { error: error.message });
                
                const errorMsg = "❌ Imagem de exemplo não disponível. Digite 'comprar' para fazer seu pedido!";
                await evolutionAPI.sendMessage(user.phone_number, errorMsg);
                await conversationService.saveMessage(conversation.id, user.id, errorMsg, 'outgoing');
            }
        } else {
            const notFoundMsg = "❌ Imagem de exemplo não disponível no momento.\n\n🛒 Digite 'comprar' para fazer seu pedido!";
            await evolutionAPI.sendMessage(user.phone_number, notFoundMsg);
            await conversationService.saveMessage(conversation.id, user.id, notFoundMsg, 'outgoing');
        }
        
        await conversationService.updateConversationState(conversation.id, BOT_STATES.SHOWING_EXAMPLE);
    }

    async handleBuyRequest(user, conversation) {
        await this.orderService.clearOrderData(conversation.id);
        
        const buyMsg = `🛒 *Fazer Pedido de Atestado*\n\nVamos começar coletando algumas informações:\n\n📅 *Quantos dias de afastamento você precisa?*\n\n💡 *Preços:*\n• 1-5 dias: R$ ${config.PRICES['1_5']}\n• 6-10 dias: R$ ${config.PRICES['6_10']}\n• 11-15 dias: R$ ${config.PRICES['11_15']}\n\n✏️ Digite apenas o número de dias (ex: 3)`;
        
        await evolutionAPI.sendMessage(user.phone_number, buyMsg);
        await conversationService.saveMessage(conversation.id, user.id, buyMsg, 'outgoing');
        await conversationService.updateConversationState(conversation.id, BOT_STATES.COLLECTING_DAYS);
    }

    async handleDataInput(user, conversation, message) {
        const currentState = conversation.state;
        
        switch (currentState) {
            case BOT_STATES.COLLECTING_DAYS:
                await this.handleDaysInput(user, conversation, message);
                break;
            case BOT_STATES.COLLECTING_NAME:
                await this.handleNameInput(user, conversation, message);
                break;
            case BOT_STATES.COLLECTING_CPF:
                await this.handleCPFInput(user, conversation, message);
                break;
            case BOT_STATES.COLLECTING_DATE:
                await this.handleDateInput(user, conversation, message);
                break;
            case BOT_STATES.COLLECTING_TIME:
                await this.handleTimeInput(user, conversation, message);
                break;
            case BOT_STATES.COLLECTING_CID:
                await this.handleCIDInput(user, conversation, message);
                break;
        }
    }

    async handleDaysInput(user, conversation, message) {
        const days = parseInt(message.trim());
        
        if (isNaN(days) || days < 1 || days > 15) {
            const errorMsg = "❌ *Número inválido*\n\nPor favor, digite um número entre 1 e 15 dias.\n\nExemplo: 3";
            await evolutionAPI.sendMessage(user.phone_number, errorMsg);
            await conversationService.saveMessage(conversation.id, user.id, errorMsg, 'outgoing');
            return;
        }

        const price = this.getPriceForDays(days);
        await this.orderService.saveOrderData(conversation.id, 'days', days);
        await this.orderService.saveOrderData(conversation.id, 'price', price);

        const nameMsg = `✅ *${days} dias - R$ ${price}*\n\n👤 *Agora preciso do seu nome completo:*\n\n✏️ Digite seu nome exatamente como aparece nos seus documentos.`;
        
        await evolutionAPI.sendMessage(user.phone_number, nameMsg);
        await conversationService.saveMessage(conversation.id, user.id, nameMsg, 'outgoing');
        await conversationService.updateConversationState(conversation.id, BOT_STATES.COLLECTING_NAME);
    }

    async handleNameInput(user, conversation, message) {
        const name = message.trim();
        
        if (name.length < 5 || !/^[a-zA-ZÀ-ÿ\s]+$/.test(name)) {
            const errorMsg = "❌ *Nome inválido*\n\nPor favor, digite seu nome completo (apenas letras e espaços).\n\nExemplo: João Silva Santos";
            await evolutionAPI.sendMessage(user.phone_number, errorMsg);
            await conversationService.saveMessage(conversation.id, user.id, errorMsg, 'outgoing');
            return;
        }

        await this.orderService.saveOrderData(conversation.id, 'name', name);

        const cpfMsg = `✅ *Nome: ${name}*\n\n📄 *Agora preciso do seu CPF:*\n\n✏️ Digite apenas os números do CPF (sem pontos ou hífen).\n\nExemplo: 12345678901`;
        
        await evolutionAPI.sendMessage(user.phone_number, cpfMsg);
        await conversationService.saveMessage(conversation.id, user.id, cpfMsg, 'outgoing');
        await conversationService.updateConversationState(conversation.id, BOT_STATES.COLLECTING_CPF);
    }

    async handleCPFInput(user, conversation, message) {
        const cpf = message.trim().replace(/\D/g, '');
        
        if (!this.validateCPF(cpf)) {
            const errorMsg = "❌ *CPF inválido*\n\nPor favor, digite um CPF válido (apenas números).\n\nExemplo: 12345678901";
            await evolutionAPI.sendMessage(user.phone_number, errorMsg);
            await conversationService.saveMessage(conversation.id, user.id, errorMsg, 'outgoing');
            return;
        }

        await this.orderService.saveOrderData(conversation.id, 'cpf', cpf);

        const dateMsg = `✅ *CPF confirmado*\n\n📅 *Data de entrada no atestado:*\n\n✏️ Digite no formato DD/MM/AAAA\n\nExemplo: 15/03/2024`;
        
        await evolutionAPI.sendMessage(user.phone_number, dateMsg);
        await conversationService.saveMessage(conversation.id, user.id, dateMsg, 'outgoing');
        await conversationService.updateConversationState(conversation.id, BOT_STATES.COLLECTING_DATE);
    }

    async handleDateInput(user, conversation, message) {
        const date = message.trim();
        
        if (!this.validateDate(date)) {
            const errorMsg = "❌ *Data inválida*\n\nPor favor, digite uma data válida no formato DD/MM/AAAA.\n\nExemplo: 15/03/2024";
            await evolutionAPI.sendMessage(user.phone_number, errorMsg);
            await conversationService.saveMessage(conversation.id, user.id, errorMsg, 'outgoing');
            return;
        }

        await this.orderService.saveOrderData(conversation.id, 'entryDate', date);

        const timeMsg = `✅ *Data: ${date}*\n\n⏰ *Horário de entrada:*\n\n✏️ Digite no formato HH:MM\n\nExemplo: 08:30`;
        
        await evolutionAPI.sendMessage(user.phone_number, timeMsg);
        await conversationService.saveMessage(conversation.id, user.id, timeMsg, 'outgoing');
        await conversationService.updateConversationState(conversation.id, BOT_STATES.COLLECTING_TIME);
    }

    async handleTimeInput(user, conversation, message) {
        const time = message.trim();
        
        if (!this.validateTime(time)) {
            const errorMsg = "❌ *Horário inválido*\n\nPor favor, digite um horário válido no formato HH:MM.\n\nExemplo: 08:30";
            await evolutionAPI.sendMessage(user.phone_number, errorMsg);
            await conversationService.saveMessage(conversation.id, user.id, errorMsg, 'outgoing');
            return;
        }

        await this.orderService.saveOrderData(conversation.id, 'entryTime', time);

        const cidMsg = `✅ *Horário: ${time}*\n\n🏥 *Código CID (motivo médico):*\n\n💡 *Sugestões comuns:*\n• H10 - Dor de cabeça\n• K59 - Problemas intestinais\n• R50 - Febre\n• M79 - Dores musculares\n\n✏️ Digite o código desejado ou deixe em branco para usar H10:`;
        
        await evolutionAPI.sendMessage(user.phone_number, cidMsg);
        await conversationService.saveMessage(conversation.id, user.id, cidMsg, 'outgoing');
        await conversationService.updateConversationState(conversation.id, BOT_STATES.COLLECTING_CID);
    }

    async handleCIDInput(user, conversation, message) {
        let cid = message.trim().toUpperCase();
        
        if (!cid || cid === '') {
            cid = 'H10';
        }

        // Validação básica do CID
        if (!/^[A-Z]\d{1,2}(\.\d)?$/.test(cid)) {
            cid = 'H10'; // Fallback para código válido
        }

        await this.orderService.saveOrderData(conversation.id, 'cidCode', cid);
        await this.showOrderSummary(user, conversation);
    }

    async showOrderSummary(user, conversation) {
        const orderData = await this.orderService.getOrderData(conversation.id);
        
        const summaryMsg = `📋 *RESUMO DO PEDIDO*\n\n👤 *Nome:* ${orderData.name}\n📄 *CPF:* ${orderData.cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')}\n📅 *Dias:* ${orderData.days}\n📆 *Data:* ${orderData.entryDate}\n⏰ *Horário:* ${orderData.entryTime}\n🏥 *CID:* ${orderData.cidCode}\n\n💰 *Valor Total: R$ ${orderData.price}*\n\n✅ Confirme os dados:\n• Digite "sim" para confirmar\n• Digite "não" para cancelar`;
        
        await evolutionAPI.sendMessage(user.phone_number, summaryMsg);
        await conversationService.saveMessage(conversation.id, user.id, summaryMsg, 'outgoing');
        await conversationService.updateConversationState(conversation.id, BOT_STATES.SHOWING_SUMMARY);
    }

    async handleConfirmOrder(user, conversation) {
        const orderData = await this.orderService.getOrderData(conversation.id);
        
        try {
            const orderId = await this.orderService.createOrder(user.id, orderData);
            
            // Notificar admin no Telegram
            await telegramService.notifyNewOrder(orderData, orderId);
            
            const pixMsg = `✅ *PEDIDO CONFIRMADO!*\n\n📋 *ID do Pedido:* ${orderId}\n💰 *Valor:* R$ ${orderData.price}\n\n💳 *DADOS PARA PAGAMENTO PIX:*\n\n🔑 *Chave PIX:* ${config.PIX_KEY}\n\n📋 *Instruções:*\n1. Faça o PIX no valor exato\n2. Envie o comprovante aqui\n3. Seu documento será gerado automaticamente\n\n⏰ *Prazo:* 30 minutos para pagamento\n\n❓ Após enviar o comprovante, digite "pago" para confirmar.`;
            
            await evolutionAPI.sendMessage(user.phone_number, pixMsg);
            await conversationService.saveMessage(conversation.id, user.id, pixMsg, 'outgoing');
            await conversationService.updateConversationState(conversation.id, BOT_STATES.AWAITING_PAYMENT);
            
        } catch (error) {
            logger.error('Erro ao criar pedido:', { error: error.message });
            
            const errorMsg = "❌ *Erro ao processar pedido*\n\nHouve um erro interno. Por favor, tente novamente ou digite 'suporte'.";
            await evolutionAPI.sendMessage(user.phone_number, errorMsg);
            await conversationService.saveMessage(conversation.id, user.id, errorMsg, 'outgoing');
        }
    }

    async handleCancelOrder(user, conversation) {
        await this.orderService.clearOrderData(conversation.id);
        
        const cancelMsg = "❌ *Pedido cancelado*\n\nSeus dados foram removidos. Digite 'comprar' para fazer um novo pedido.";
        
        await evolutionAPI.sendMessage(user.phone_number, cancelMsg);
        await conversationService.saveMessage(conversation.id, user.id, cancelMsg, 'outgoing');
        await conversationService.updateConversationState(conversation.id, BOT_STATES.GREETING);
    }

    // Nova função para tratar confirmação de pagamento
    async handlePaymentConfirmation(user, conversation, message) {
        try {
            // Buscar pedido ativo do usuário
            const activeOrder = await this.orderService.getActiveOrderByUserId(user.id);
            
            if (!activeOrder) {
                const noOrderMsg = "⚠️ Não encontrei nenhum pedido pendente.\n\nSe você fez um pedido recentemente, digite 'menu' para verificar.";
                await evolutionAPI.sendMessage(user.phone_number, noOrderMsg);
                await conversationService.saveMessage(conversation.id, user.id, noOrderMsg, 'outgoing');
                return;
            }
            
            // Confirmar recebimento do comprovante
            const confirmMsg = "✅ *Comprovante Recebido!*\n\n📋 **ID do Pedido:** " + activeOrder.id + "\n\n🕰️ **Processamento:**\n• Verificando pagamento...\n• Aprovação em até 30 minutos\n• Documento será gerado automaticamente\n\n📞 **Suporte:** Se demorar mais que 30 min, digite 'suporte'";
            
            await evolutionAPI.sendMessage(user.phone_number, confirmMsg);
            await conversationService.saveMessage(conversation.id, user.id, confirmMsg, 'outgoing');
            await conversationService.updateConversationState(conversation.id, BOT_STATES.PAYMENT_PROOF_SENT);
            
            // Notificar admin via Telegram
            await telegramService.notifyPaymentProof(activeOrder.id, user.phone_number, user.name || 'Não informado');
            
            logger.info('Comprovante de pagamento recebido:', { 
                orderId: activeOrder.id, 
                userPhone: logger.maskNumber(user.phone_number) 
            });
            
        } catch (error) {
            logger.error('Erro ao processar confirmação de pagamento:', { error: error.message });
            
            const errorMsg = "⚠️ Houve um problema ao processar sua solicitação.\n\nPor favor, digite 'suporte' para falar com nossa equipe.";
            await evolutionAPI.sendMessage(user.phone_number, errorMsg);
            await conversationService.saveMessage(conversation.id, user.id, errorMsg, 'outgoing');
        }
    }

    async handleSupportRequest(user, conversation, message = null) {
        try {
            const supportMsg = "👥 *Conectando com Suporte*\n\n✅ Sua solicitação foi enviada para nossa equipe!\n\n🕰️ **Tempo de resposta:**\n• Horário comercial: até 1 hora\n• Fora do horário: até 4 horas\n\n📱 **Enquanto aguarda:**\n• Digite 'menu' - Voltar ao início\n• Digite 'comprar' - Fazer pedido";
            
            await evolutionAPI.sendMessage(user.phone_number, supportMsg);
            await conversationService.saveMessage(conversation.id, user.id, supportMsg, 'outgoing');
            await conversationService.updateConversationState(conversation.id, BOT_STATES.SUPPORT);
            
            // Notificar admin via Telegram
            const userMessage = message || 'Solicitação geral de suporte';
            await telegramService.notifySupport(user.phone_number, user.name || 'Não informado', userMessage);
            
            logger.info('Solicitação de suporte enviada:', { 
                userPhone: logger.maskNumber(user.phone_number),
                message: userMessage 
            });
            
        } catch (error) {
            logger.error('Erro ao processar solicitação de suporte:', { error: error.message });
            
            const fallbackMsg = "⚠️ Problema técnico temporário.\n\nTente novamente em alguns minutos ou contate-nos diretamente.";
            await evolutionAPI.sendMessage(user.phone_number, fallbackMsg);
            await conversationService.saveMessage(conversation.id, user.id, fallbackMsg, 'outgoing');
        }
    }

    async handleGeneralInterest(user, conversation) {
        const interestMsg = `Entendi seu interesse! 😊\n\nNosso sistema oferece documentos médicos de forma rápida e segura.\n\n💬 *O que gostaria de fazer?*\n• Digite "preços" para ver valores\n• Digite "exemplo" para ver modelo\n• Digite "comprar" para fazer pedido\n• Digite "suporte" para falar conosco`;
        
        await evolutionAPI.sendMessage(user.phone_number, interestMsg);
        await conversationService.saveMessage(conversation.id, user.id, interestMsg, 'outgoing');
        await conversationService.updateConversationState(conversation.id, BOT_STATES.INTERESTED);
    }

    async handleWelcome(user, conversation) {
        const welcomeMsg = `Olá! Seja bem-vindo(a) 😊\n\n🏥 Oferecemos atestados médicos digitais de forma rápida e segura.\n\n📱 *Como posso ajudar?*\n• Digite "atestado" para saber mais\n• Digite "preços" para ver valores\n• Digite "comprar" para fazer pedido`;
        
        await evolutionAPI.sendMessage(user.phone_number, welcomeMsg);
        await conversationService.saveMessage(conversation.id, user.id, welcomeMsg, 'outgoing');
        await conversationService.updateConversationState(conversation.id, BOT_STATES.GREETING);
    }
}

const messageProcessor = new MessageProcessor();

// Configuração do Express
const app = express();

if (config.TRUST_PROXY) {
    app.set('trust proxy', 1);
}

app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
}));

app.use(cors({
    origin: true,
    credentials: true
}));

app.use(compression());

// Rate limiting otimizado para processamento simultâneo
const limiter = rateLimit({
    windowMs: 10 * 60 * 1000, // 10 minutos
    max: 200, // Aumentado para suportar mais usuários simultâneos
    message: {
        error: 'Sistema ocupado, tente novamente em alguns segundos',
        retryAfter: 10 * 60
    },
    standardHeaders: true,
    legacyHeaders: false,
    // Bypass otimizado para admin e operações críticas
    skip: (req) => {
        return (
            req.headers['x-admin-key'] === config.ADMIN_API_KEY ||
            req.headers['user-agent']?.includes('TelegramAdminBot') ||
            req.path === '/webhook' // Webhook sempre permitido
        );
    },
    validate: {
        xForwardedForHeader: config.TRUST_PROXY
    },
    // Rate limiting diferenciado por tipo de endpoint
    keyGenerator: (req) => {
        if (req.path === '/webhook') {
            return `webhook-${req.ip}`;
        }
        return `api-${req.ip}`;
    }
});

app.use(limiter);
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Webhook para WhatsApp
// Webhook melhorado com processamento assíncrono
app.post('/webhook', async (req, res) => {
    // Responder imediatamente para evitar timeout
    res.status(200).json({ 
        status: 'received',
        timestamp: new Date().toISOString()
    });
    
    // Processar mensagem de forma assíncrona
    setImmediate(async () => {
        try {        
            const { event, data, instance } = req.body;
            
            if (event === 'messages.upsert' || event === 'MESSAGES_UPSERT') {
                if (data) {
                    const webhookData = { data };
                    await messageProcessor.processMessage(webhookData);
                }
            }
            
        } catch (error) {
            logger.error('Erro no processamento assíncrono do webhook:', { 
                error: error.message,
                stack: error.stack 
            });
        }
    });
});

// Endpoint para aprovação de pagamento (Telegram Bot Admin) - CORRIGIDO
app.post('/approve-payment/:orderId', async (req, res) => {
    try {
        const { orderId } = req.params;
        const { approved } = req.body;
        
        // Log da requisição
        logger.info('Requisição de aprovação recebida:', { 
            orderId, 
            approved, 
            ip: req.ip,
            userAgent: req.headers['user-agent'],
            adminKey: req.headers['x-admin-key'] ? 'presente' : 'ausente'
        });
        
        const orderService = new OrderService(database);
        const order = await orderService.getOrder(orderId);
        
        if (!order) {
            logger.warn('Pedido não encontrado:', { orderId });
            return res.status(404).json({ error: 'Pedido não encontrado' });
        }
        
        if (order.status !== 'pending') {
            logger.warn('Pedido já processado:', { orderId, currentStatus: order.status });
            return res.status(400).json({ 
                error: 'Pedido já foi processado', 
                currentStatus: order.status 
            });
        }
        
        if (approved) {
            await orderService.updateOrderStatus(orderId, 'approved');
            logger.info('Pedido aprovado:', { orderId });
            
            // Buscar usuário e conversa
            const user = await userService.findUserById(order.user_id);
            const conversation = await conversationService.getActiveConversation(user.id);
            
            if (user && conversation) {
                try {
                    // Enviar confirmação para o cliente
                    const approvedMsg = "✅ *PAGAMENTO APROVADO!*\n\n🔄 Gerando seu documento...\n\nAguarde alguns instantes.";
                    await evolutionAPI.sendMessage(user.phone_number, approvedMsg);
                    await conversationService.saveMessage(conversation.id, user.id, approvedMsg, 'outgoing');
                    await conversationService.updateConversationState(conversation.id, BOT_STATES.GENERATING_DOCUMENT);
                    
                    // Notificar Telegram
                    await telegramService.notifyPaymentReceived(orderId);
                    
                    // Gerar documento
                    setTimeout(() => {
                        generateDocumentForOrder(order, user, conversation);
                    }, 2000);
                    
                    logger.info('Processamento de aprovação concluído:', { orderId });
                    
                } catch (notificationError) {
                    logger.error('Erro ao notificar aprovação:', { 
                        orderId, 
                        error: notificationError.message 
                    });
                }
            } else {
                logger.warn('Usuário ou conversa não encontrados:', { 
                    orderId, 
                    userId: order.user_id,
                    userFound: !!user,
                    conversationFound: !!conversation
                });
            }
            
        } else {
            await orderService.updateOrderStatus(orderId, 'rejected');
            logger.info('Pedido rejeitado:', { orderId });
            
            const user = await userService.findUserById(order.user_id);
            if (user) {
                try {
                    const conversation = await conversationService.getActiveConversation(user.id);
                    if (conversation) {
                        const rejectedMsg = "❌ *Pagamento não aprovado*\n\nHouve algum problema com o pagamento. Entre em contato com o suporte para mais informações.";
                        await evolutionAPI.sendMessage(user.phone_number, rejectedMsg);
                        await conversationService.saveMessage(conversation.id, user.id, rejectedMsg, 'outgoing');
                    }
                    
                    logger.info('Cliente notificado sobre rejeição:', { orderId });
                    
                } catch (notificationError) {
                    logger.error('Erro ao notificar rejeição:', { 
                        orderId, 
                        error: notificationError.message 
                    });
                }
            }
        }
        
        res.json({ 
            success: true, 
            orderId, 
            approved,
            newStatus: approved ? 'approved' : 'rejected'
        });
        
    } catch (error) {
        logger.error('Erro ao processar aprovação de pagamento:', { 
            orderId: req.params.orderId,
            approved: req.body.approved,
            error: error.message,
            stack: error.stack
        });
        
        res.status(500).json({ 
            error: 'Erro interno do servidor',
            message: error.message
        });
    }
});

// Função para gerar documento
async function generateDocumentForOrder(order, user, conversation) {
    try {
        const documentData = {
            orderId: order.id,
            nome: order.name,
            cpf: order.cpf,
            dataEntrada: order.entry_date,
            horarioEntrada: order.entry_time,
            qtdDias: order.days,
            cid: order.cid_code,
            medico: 'aleatorio'
        };
        
        const result = await generateDocument(documentData);
        
        if (result.success) {
            // Enviar documento para o cliente
            const imageBuffer = fs.readFileSync(result.imagePath);
            const base64Image = imageBuffer.toString('base64');
            
            await evolutionAPI.sendMedia(
                user.phone_number,
                base64Image,
                `✅ *DOCUMENTO GERADO COM SUCESSO!*\n\n📋 *Pedido:* ${order.id}\n📄 Seu atestado médico está pronto!\n\n⭐ Obrigado pela preferência!`,
                "image"
            );
            
            await conversationService.saveMessage(conversation.id, user.id, '[DOCUMENTO_GERADO_ENVIADO]', 'outgoing');
            await conversationService.updateConversationState(conversation.id, BOT_STATES.COMPLETED);
            
            // Atualizar status do pedido
            const orderService = new OrderService(database);
            await orderService.updateOrderStatus(order.id, 'completed');
            
            // Enviar documento para admin via Telegram
            await telegramService.sendPhoto(result.imagePath, `✅ <b>DOCUMENTO GERADO</b>\n\nPedido: ${order.id}\nCliente: ${order.name}`);
            
        } else {
            throw new Error('Falha na geração do documento');
        }
        
    } catch (error) {
        logger.error('Erro ao gerar documento:', { error: error.message });
        
        const errorMsg = "❌ *Erro na geração do documento*\n\nHouve um problema técnico. Nossa equipe foi notificada e entrará em contato em breve.";
        await evolutionAPI.sendMessage(user.phone_number, errorMsg);
        await conversationService.saveMessage(conversation.id, user.id, errorMsg, 'outgoing');
    }
}

// Middleware de tratamento de erros
app.use((error, req, res, next) => {
    logger.error('Erro no servidor:', { error: error.message });
    
    res.status(500).json({ 
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? error.message : 'Erro interno'
    });
});

app.use((req, res) => {
    res.status(404).json({
        error: 'Rota não encontrada',
        path: req.originalUrl,
        method: req.method
    });
});

// Manutenção automática
async function performMaintenance() {
    try {
        const inactiveConversations = await database.cleanupInactiveConversations();
        const oldConversations = await conversationService.cleanupOldConversations();
        
        // Limpeza de arquivos antigos do document-generator
        cleanupOldFiles(24);
        
        logger.info('Manutenção concluída', { 
            inactiveConversations, 
            oldConversationsRemoved: oldConversations.conversations 
        });
    } catch (error) {
        logger.error('Erro na manutenção automática:', { error: error.message });
    }
}

setInterval(performMaintenance, 4 * 60 * 60 * 1000);

// Inicialização
async function initialize() {
    try {
        logger.info('Iniciando Bot WhatsApp - Evolution API v2.4.0 com Geração de Documentos');
        
        database = new Database();
        await database.initialize();
        
        // Criar tabelas necessárias
        await createTables();
        
        userService = new UserService(database);
        conversationService = new ConversationService(database);
        
        const orderService = new OrderService(database);
        messageProcessor.setOrderService(orderService);
        
        if (config.GROQ_API_KEY) {
            try {
                groqTranscription = new GroqTranscription(config.GROQ_API_KEY, {
                    model: 'whisper-large-v3-turbo',
                    language: 'pt',
                    temperature: 0
                });
                
                logger.info('Groq Transcription inicializado com sucesso');
                
            } catch (error) {
                logger.error('Erro ao inicializar Groq Transcription:', { error: error.message });
            }
        }
        
        // Inicializar bot Telegram Admin
        telegramAdminBot = new TelegramAdminBot();
        await telegramAdminBot.initialize();
        
        await performMaintenance();
        
        logger.info('Inicialização concluída com sucesso');
        
    } catch (error) {
        logger.error('Erro na inicialização:', { error: error.message });
        process.exit(1);
    }
}

// Criar tabelas do banco
async function createTables() {
    try {
        // Tabela de pedidos
        await database.run(`
            CREATE TABLE IF NOT EXISTS orders (
                id TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL,
                days INTEGER NOT NULL,
                name TEXT NOT NULL,
                cpf TEXT NOT NULL,
                entry_date TEXT NOT NULL,
                entry_time TEXT NOT NULL,
                cid_code TEXT NOT NULL,
                price REAL NOT NULL,
                status TEXT DEFAULT 'pending',
                created_at TEXT NOT NULL,
                updated_at TEXT DEFAULT (datetime('now')),
                FOREIGN KEY (user_id) REFERENCES users (id)
            )
        `);

        // Tabela de dados temporários do pedido
        await database.run(`
            CREATE TABLE IF NOT EXISTS order_data (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                conversation_id INTEGER NOT NULL,
                data_key TEXT NOT NULL,
                data_value TEXT NOT NULL,
                created_at TEXT NOT NULL,
                UNIQUE(conversation_id, data_key),
                FOREIGN KEY (conversation_id) REFERENCES conversations (id)
            )
        `);

        logger.info('Tabelas criadas/verificadas com sucesso');
        
    } catch (error) {
        logger.error('Erro ao criar tabelas:', { error: error.message });
        throw error;
    }
}

const PORT = config.PORT;
app.listen(PORT, async () => {
    logger.info('Servidor iniciado', { 
        port: PORT, 
        evolutionAPI: config.EVOLUTION_API_URL,
        instance: config.INSTANCE_NAME,
        transcription: config.GROQ_API_KEY ? 'enabled' : 'disabled',
        documentGenerator: 'enabled'
    });
    
    await initialize();
});

// Handlers de processo
process.on('SIGTERM', async () => {
    logger.info('Encerrando servidor graciosamente...');
    
    // Desligar bot Telegram Admin
    if (telegramAdminBot && telegramAdminBot.bot) {
        try {
            await telegramAdminBot.bot.stopPolling();
            logger.info('Bot Telegram Admin desligado');
        } catch (error) {
            logger.error('Erro ao desligar Bot Telegram Admin:', { error: error.message });
        }
    }
    
    if (database) {
        await database.close();
    }
    process.exit(0);
});

process.on('SIGINT', async () => {
    logger.info('Encerrando servidor graciosamente...');
    
    // Desligar bot Telegram Admin
    if (telegramAdminBot && telegramAdminBot.bot) {
        try {
            await telegramAdminBot.bot.stopPolling();
            logger.info('Bot Telegram Admin desligado');
        } catch (error) {
            logger.error('Erro ao desligar Bot Telegram Admin:', { error: error.message });
        }
    }
    
    if (database) {
        await database.close();
    }
    process.exit(0);
});

process.on('uncaughtException', (error) => {
    logger.error('Erro crítico não capturado:', { error: error.message });
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    logger.error('Promise rejeitada não tratada:', { reason });
    process.exit(1);
});

module.exports = app;