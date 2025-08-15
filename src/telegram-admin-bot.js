// telegram-admin-bot.js - Bot Telegram para Administração - VERSÃO CORRIGIDA
require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Importar o Database do sistema principal
const Database = require('./database/database');

// Configurações
const config = {
    TELEGRAM_BOT_TOKEN: process.env.ADMIN_TELEGRAM_BOT_TOKEN,
    ADMIN_CHAT_ID: process.env.ADMIN_TELEGRAM_CHAT_ID,
    WEBHOOK_URL: process.env.WEBHOOK_URL || 'http://localhost:3002',
    DATABASE_PATH: process.env.DATABASE_PATH || './data/bot.db',
    ADMIN_API_KEY: process.env.ADMIN_API_KEY || 'ADMIN_SECRET_KEY_2024' // Chave especial para bypass do rate limit
};

// Verificar configurações obrigatórias
if (!config.TELEGRAM_BOT_TOKEN) {
    console.error('❌ ADMIN_TELEGRAM_BOT_TOKEN não configurado');
    process.exit(1);
}

if (!config.ADMIN_CHAT_ID) {
    console.error('❌ ADMIN_TELEGRAM_CHAT_ID não configurado');
    process.exit(1);
}

// Logger simples
class Logger {
    static log(level, message, data = null) {
        const timestamp = new Date().toISOString();
        const logEntry = { timestamp, level: level.toUpperCase(), message, ...(data && { data }) };
        console.log(JSON.stringify(logEntry));
    }
    
    static info(message, data = null) { this.log('info', message, data); }
    static error(message, data = null) { this.log('error', message, data); }
    static warn(message, data = null) { this.log('warn', message, data); }
}

// Admin Service - Versão melhorada
class AdminService {
    constructor(database) {
        this.db = database;
    }
    
    async getPendingOrders() {
        const query = `
            SELECT o.*, u.phone_number, u.name as user_name 
            FROM orders o 
            JOIN users u ON o.user_id = u.id 
            WHERE o.status = 'pending' 
            ORDER BY o.created_at DESC 
            LIMIT 10
        `;
        return await this.db.all(query);
    }
    
    async getOrderById(orderId) {
        const query = `
            SELECT o.*, u.phone_number, u.name as user_name 
            FROM orders o 
            JOIN users u ON o.user_id = u.id 
            WHERE o.id = ?
        `;
        return await this.db.get(query, [orderId]);
    }
    
    async updateOrderStatus(orderId, status) {
        const query = 'UPDATE orders SET status = ?, updated_at = datetime("now") WHERE id = ?';
        return await this.db.run(query, [status, orderId]);
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
            const result = await this.db.get(query);
            stats[key] = result.count !== undefined ? result.count : result.revenue;
        }
        
        return stats;
    }

    // Novo método para processar pagamento diretamente no banco
    async processPayment(orderId, approved) {
        try {
            const order = await this.getOrderById(orderId);
            
            if (!order) {
                throw new Error('Pedido não encontrado');
            }
            
            if (order.status !== 'pending') {
                throw new Error(`Pedido já foi processado (Status: ${order.status})`);
            }
            
            const newStatus = approved ? 'approved' : 'rejected';
            await this.updateOrderStatus(orderId, newStatus);
            
            return { success: true, order, newStatus };
            
        } catch (error) {
            Logger.error('Erro ao processar pagamento:', { orderId, error: error.message });
            return { success: false, error: error.message };
        }
    }

    async createTablesIfNotExist() {
        try {
            // Criar tabela de pedidos se não existir
            await this.db.run(`
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

            // Criar tabela de dados temporários do pedido se não existir
            await this.db.run(`
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

            Logger.info('Tabelas do sistema de pedidos criadas/verificadas');
        } catch (error) {
            Logger.error('Erro ao criar tabelas do sistema:', { error: error.message });
            throw error;
        }
    }
}

// Webhook Service - Versão melhorada com retry e headers especiais
class WebhookService {
    static async approvePayment(orderId, approved, retries = 3) {
        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                const response = await axios.post(
                    `${config.WEBHOOK_URL}/approve-payment/${orderId}`,
                    { approved },
                    { 
                        timeout: 30000,
                        headers: {
                            'Content-Type': 'application/json',
                            'X-Admin-Key': config.ADMIN_API_KEY, // Header especial para bypass do rate limit
                            'User-Agent': 'TelegramAdminBot/1.0'
                        },
                        validateStatus: (status) => status < 500 // Aceitar 4xx mas tentar novamente em 5xx
                    }
                );
                
                return response.data;
                
            } catch (error) {
                Logger.warn(`Tentativa ${attempt}/${retries} falhou:`, { 
                    orderId, 
                    error: error.message,
                    status: error.response?.status 
                });
                
                // Se for erro 429, aguardar mais tempo antes de tentar novamente
                if (error.response?.status === 429) {
                    const waitTime = attempt * 5000; // 5s, 10s, 15s
                    Logger.info(`Rate limit atingido, aguardando ${waitTime/1000}s...`);
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                }
                
                // Se for a última tentativa, lance o erro
                if (attempt === retries) {
                    throw error;
                }
                
                // Aguardar antes da próxima tentativa
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }
    }

    // Método alternativo que funciona diretamente no banco
    static async approvePaymentDirect(adminService, orderId, approved) {
        return await adminService.processPayment(orderId, approved);
    }
}

// Telegram Bot Admin - Versão aprimorada
class TelegramAdminBot {
    constructor() {
        this.bot = new TelegramBot(config.TELEGRAM_BOT_TOKEN, { polling: true });
        this.database = new Database();
        this.adminService = null;
        this.adminChatId = config.ADMIN_CHAT_ID;
        
        this.setupEventHandlers();
    }
    
    async initialize() {
        try {
            await this.database.initialize();
            
            this.adminService = new AdminService(this.database);
            await this.adminService.createTablesIfNotExist();
            
            Logger.info('Bot Telegram Admin inicializado');
            
            // Enviar mensagem de inicialização
            await this.sendMessage('🤖 *Bot Admin Iniciado*\n\nDigite /help para ver os comandos disponíveis.');
            
        } catch (error) {
            Logger.error('Erro na inicialização:', { error: error.message });
            process.exit(1);
        }
    }
    
    setupEventHandlers() {
        // Comando /start
        this.bot.onText(/\/start/, async (msg) => {
            if (msg.chat.id.toString() !== this.adminChatId) {
                return;
            }
            
            const welcomeMsg = `🏥 *Bot Admin - Sistema de Atestados*\n\n✅ Bot iniciado com sucesso!\n\nDigite /help para ver todos os comandos disponíveis.`;
            
            await this.sendMessage(welcomeMsg);
        });
        
        // Comando /help
        this.bot.onText(/\/help/, async (msg) => {
            if (msg.chat.id.toString() !== this.adminChatId) {
                return;
            }
            
            const helpMsg = `📋 *COMANDOS DISPONÍVEIS*\n\n` +
                          `📊 /stats - Estatísticas gerais\n` +
                          `📋 /pending - Pedidos pendentes\n` +
                          `✅ /approve [ID] - Aprovar pedido\n` +
                          `❌ /reject [ID] - Rejeitar pedido\n` +
                          `🔍 /order [ID] - Ver detalhes do pedido\n` +
                          `💰 /revenue - Relatório de faturamento\n` +
                          `🔧 /fix [ID] - Forçar processamento\n` +
                          `🧹 /cleanup - Limpeza de arquivos antigos\n` +
                          `ℹ️ /help - Este menu\n\n` +
                          `*Uso:*\n` +
                          `• /approve ORD123456789\n` +
                          `• /reject ORD123456789\n` +
                          `• /order ORD123456789`;
            
            await this.sendMessage(helpMsg);
        });
        
        // Comando /stats
        this.bot.onText(/\/stats/, async (msg) => {
            if (msg.chat.id.toString() !== this.adminChatId) {
                return;
            }
            
            try {
                const stats = await this.adminService.getOrdersStats();
                
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
                Logger.error('Erro ao buscar stats:', { error: error.message });
            }
        });
        
        // Comando /pending
        this.bot.onText(/\/pending/, async (msg) => {
            if (msg.chat.id.toString() !== this.adminChatId) {
                return;
            }
            
            try {
                const orders = await this.adminService.getPendingOrders();
                
                if (orders.length === 0) {
                    await this.sendMessage('✅ Nenhum pedido pendente no momento.');
                    return;
                }
                
                let pendingMsg = `⏳ *PEDIDOS PENDENTES (${orders.length})*\n\n`;
                
                orders.forEach((order, index) => {
                    const phone = order.phone_number.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3');
                    pendingMsg += `${index + 1}. 📋 *${order.id}*\n`;
                    pendingMsg += `👤 ${order.name}\n`;
                    pendingMsg += `📱 ${phone}\n`;
                    pendingMsg += `💰 R$ ${order.price.toFixed(2)}\n`;
                    pendingMsg += `📅 ${order.days} dias\n`;
                    pendingMsg += `⏰ ${new Date(order.created_at).toLocaleString('pt-BR')}\n\n`;
                });
                
                pendingMsg += `*Para aprovar:* /approve [ID]\n*Para rejeitar:* /reject [ID]`;
                
                await this.sendMessage(pendingMsg);
                
            } catch (error) {
                await this.sendMessage('❌ Erro ao buscar pedidos pendentes');
                Logger.error('Erro ao buscar pedidos pendentes:', { error: error.message });
            }
        });
        
        // Comando /approve - Versão melhorada
        this.bot.onText(/\/approve (.+)/, async (msg, match) => {
            if (msg.chat.id.toString() !== this.adminChatId) {
                return;
            }
            
            const orderId = match[1].trim();
            
            try {
                await this.sendMessage(`🔄 Processando aprovação do pedido ${orderId}...`);
                
                // Tentar primeiro via webhook
                try {
                    await WebhookService.approvePayment(orderId, true);
                    Logger.info('Pedido aprovado via webhook:', { orderId });
                    
                } catch (webhookError) {
                    Logger.warn('Webhook falhou, usando processamento direto:', { orderId, error: webhookError.message });
                    
                    // Se o webhook falhar, processar diretamente no banco
                    const result = await WebhookService.approvePaymentDirect(this.adminService, orderId, true);
                    
                    if (!result.success) {
                        throw new Error(result.error);
                    }
                    
                    Logger.info('Pedido aprovado via processamento direto:', { orderId });
                }
                
                const order = await this.adminService.getOrderById(orderId);
                await this.sendMessage(`✅ *PEDIDO APROVADO*\n\n📋 ID: ${orderId}\n👤 Cliente: ${order.name}\n💰 Valor: R$ ${order.price.toFixed(2)}\n\n🔄 Documento será gerado automaticamente...`);
                
            } catch (error) {
                await this.sendMessage(`❌ Erro ao aprovar pedido ${orderId}: ${error.message}`);
                Logger.error('Erro ao aprovar pedido:', { orderId, error: error.message });
            }
        });
        
        // Comando /reject - Versão melhorada
        this.bot.onText(/\/reject (.+)/, async (msg, match) => {
            if (msg.chat.id.toString() !== this.adminChatId) {
                return;
            }
            
            const orderId = match[1].trim();
            
            try {
                await this.sendMessage(`🔄 Processando rejeição do pedido ${orderId}...`);
                
                // Tentar primeiro via webhook
                try {
                    await WebhookService.approvePayment(orderId, false);
                    Logger.info('Pedido rejeitado via webhook:', { orderId });
                    
                } catch (webhookError) {
                    Logger.warn('Webhook falhou, usando processamento direto:', { orderId, error: webhookError.message });
                    
                    // Se o webhook falhar, processar diretamente no banco
                    const result = await WebhookService.approvePaymentDirect(this.adminService, orderId, false);
                    
                    if (!result.success) {
                        throw new Error(result.error);
                    }
                    
                    Logger.info('Pedido rejeitado via processamento direto:', { orderId });
                }
                
                const order = await this.adminService.getOrderById(orderId);
                await this.sendMessage(`❌ *PEDIDO REJEITADO*\n\n📋 ID: ${orderId}\n👤 Cliente: ${order.name}\n💰 Valor: R$ ${order.price.toFixed(2)}\n\n📱 Cliente foi notificado.`);
                
            } catch (error) {
                await this.sendMessage(`❌ Erro ao rejeitar pedido ${orderId}: ${error.message}`);
                Logger.error('Erro ao rejeitar pedido:', { orderId, error: error.message });
            }
        });

        // Novo comando /fix para forçar processamento
        this.bot.onText(/\/fix (.+)/, async (msg, match) => {
            if (msg.chat.id.toString() !== this.adminChatId) {
                return;
            }
            
            const orderId = match[1].trim();
            
            try {
                const order = await this.adminService.getOrderById(orderId);
                
                if (!order) {
                    await this.sendMessage(`❌ Pedido ${orderId} não encontrado`);
                    return;
                }
                
                // Forçar processamento direto no banco
                const result = await WebhookService.approvePaymentDirect(this.adminService, orderId, true);
                
                if (result.success) {
                    await this.sendMessage(`🔧 *PROCESSAMENTO FORÇADO*\n\n📋 ID: ${orderId}\n✅ Status atualizado para: ${result.newStatus}\n\n⚠️ Verifique manualmente se o documento foi gerado.`);
                } else {
                    await this.sendMessage(`❌ Erro no processamento forçado: ${result.error}`);
                }
                
            } catch (error) {
                await this.sendMessage(`❌ Erro ao forçar processamento: ${error.message}`);
                Logger.error('Erro no processamento forçado:', { orderId, error: error.message });
            }
        });
        
        // Comando /order
        this.bot.onText(/\/order (.+)/, async (msg, match) => {
            if (msg.chat.id.toString() !== this.adminChatId) {
                return;
            }
            
            const orderId = match[1].trim();
            
            try {
                const order = await this.adminService.getOrderById(orderId);
                
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
                
                // Botões de ação se pedido estiver pendente
                if (order.status === 'pending') {
                    const actionMsg = `*Ações disponíveis:*\n• /approve ${orderId}\n• /reject ${orderId}\n• /fix ${orderId} (processamento forçado)`;
                    await this.sendMessage(actionMsg);
                }
                
            } catch (error) {
                await this.sendMessage(`❌ Erro ao buscar pedido ${orderId}`);
                Logger.error('Erro ao buscar pedido:', { orderId, error: error.message });
            }
        });
        
        // Comando /revenue
        this.bot.onText(/\/revenue/, async (msg) => {
            if (msg.chat.id.toString() !== this.adminChatId) {
                return;
            }
            
            try {
                const stats = await this.adminService.getOrdersStats();
                
                // Buscar faturamento da semana
                const weeklyQuery = `
                    SELECT COALESCE(SUM(price), 0) as revenue 
                    FROM orders 
                    WHERE status = 'completed' 
                    AND date(created_at) >= date('now', 'weekday 0', '-6 days')
                `;
                const weeklyResult = await this.database.get(weeklyQuery);
                const weeklyRevenue = weeklyResult.revenue;
                
                const revenueMsg = `💰 *RELATÓRIO DE FATURAMENTO*\n\n` +
                                 `📅 *Hoje:* R$ ${stats.todayRevenue.toFixed(2)}\n` +
                                 `📅 *Esta semana:* R$ ${weeklyRevenue.toFixed(2)}\n` +
                                 `📅 *Este mês:* R$ ${stats.monthlyRevenue.toFixed(2)}\n\n` +
                                 `📊 *Pedidos concluídos:* ${stats.completed}`;
                
                await this.sendMessage(revenueMsg);
                
            } catch (error) {
                await this.sendMessage('❌ Erro ao gerar relatório de faturamento');
                Logger.error('Erro ao buscar revenue:', { error: error.message });
            }
        });
        
        // Comando /cleanup
        this.bot.onText(/\/cleanup/, async (msg) => {
            if (msg.chat.id.toString() !== this.adminChatId) {
                return;
            }
            
            try {
                // Tentar chamar limpeza de arquivos se o módulo existir
                try {
                    const { cleanupOldFiles } = require('./document-generator');
                    cleanupOldFiles(24);
                    await this.sendMessage('🧹 *Limpeza realizada*\n\nArquivos temporários antigos foram removidos.');
                } catch (requireError) {
                    // Se não conseguir importar o módulo, fazer limpeza básica
                    await this.database.cleanupInactiveConversations();
                    await this.sendMessage('🧹 *Limpeza básica realizada*\n\nConversas inativas foram limpas.');
                }
                
            } catch (error) {
                await this.sendMessage('❌ Erro na limpeza de arquivos');
                Logger.error('Erro na limpeza:', { error: error.message });
            }
        });
        
        // Callback queries (botões inline) - Versão melhorada
        this.bot.on('callback_query', async (query) => {
            const data = query.data;
            const chatId = query.message.chat.id;
            
            if (chatId.toString() !== this.adminChatId) {
                return;
            }
            
            try {
                if (data.startsWith('approve_')) {
                    const orderId = data.replace('approve_', '');
                    
                    // Tentar via webhook primeiro, depois diretamente
                    try {
                        await WebhookService.approvePayment(orderId, true);
                    } catch (webhookError) {
                        await WebhookService.approvePaymentDirect(this.adminService, orderId, true);
                    }
                    
                    await this.bot.editMessageText(
                        `✅ *PEDIDO APROVADO*\n\nID: ${orderId}\nDocumento será gerado...`,
                        {
                            chat_id: chatId,
                            message_id: query.message.message_id,
                            parse_mode: 'Markdown'
                        }
                    );
                    
                } else if (data.startsWith('reject_')) {
                    const orderId = data.replace('reject_', '');
                    
                    // Tentar via webhook primeiro, depois diretamente
                    try {
                        await WebhookService.approvePayment(orderId, false);
                    } catch (webhookError) {
                        await WebhookService.approvePaymentDirect(this.adminService, orderId, false);
                    }
                    
                    await this.bot.editMessageText(
                        `❌ *PEDIDO REJEITADO*\n\nID: ${orderId}\nCliente foi notificado.`,
                        {
                            chat_id: chatId,
                            message_id: query.message.message_id,
                            parse_mode: 'Markdown'
                        }
                    );
                }
                
                await this.bot.answerCallbackQuery(query.id);
                
            } catch (error) {
                Logger.error('Erro no callback query:', { error: error.message });
                await this.bot.answerCallbackQuery(query.id, {
                    text: 'Erro ao processar ação. Tente usar comando /fix se necessário.',
                    show_alert: true
                });
            }
        });
        
        // Tratamento de erros
        this.bot.on('error', (error) => {
            Logger.error('Erro no bot Telegram:', { error: error.message });
        });
        
        this.bot.on('polling_error', (error) => {
            Logger.error('Erro no polling Telegram:', { error: error.message });
        });
    }
    
    async sendMessage(text, options = {}) {
        try {
            return await this.bot.sendMessage(this.adminChatId, text, {
                parse_mode: 'Markdown',
                disable_web_page_preview: true,
                ...options
            });
        } catch (error) {
            Logger.error('Erro ao enviar mensagem Telegram:', { error: error.message });
        }
    }
    
    async sendPhoto(photoPath, caption = '') {
        try {
            if (!fs.existsSync(photoPath)) {
                Logger.warn('Foto não encontrada:', { photoPath });
                return;
            }
            
            return await this.bot.sendPhoto(this.adminChatId, photoPath, {
                caption: caption,
                parse_mode: 'HTML'
            });
        } catch (error) {
            Logger.error('Erro ao enviar foto Telegram:', { error: error.message });
        }
    }
    
    async notifyNewOrder(orderData, orderId) {
        try {
            const message = `🆕 *NOVO PEDIDO RECEBIDO!*\n\n` +
                          `📋 *ID:* ${orderId}\n` +
                          `👤 *Cliente:* ${orderData.name}\n` +
                          `📱 *CPF:* ${orderData.cpf}\n` +
                          `📅 *Dias:* ${orderData.days}\n` +
                          `📆 *Data:* ${orderData.entryDate}\n` +
                          `⏰ *Horário:* ${orderData.entryTime}\n` +
                          `🏥 *CID:* ${orderData.cidCode}\n` +
                          `💰 *Valor:* R$ ${orderData.price}\n\n` +
                          `⏳ Aguardando pagamento PIX...`;
            
            const keyboard = {
                inline_keyboard: [
                    [
                        { text: '✅ Aprovar', callback_data: `approve_${orderId}` },
                        { text: '❌ Rejeitar', callback_data: `reject_${orderId}` }
                    ],
                    [
                        { text: '🔍 Ver detalhes', callback_data: `details_${orderId}` }
                    ]
                ]
            };
            
            await this.bot.sendMessage(this.adminChatId, message, {
                parse_mode: 'Markdown',
                reply_markup: keyboard
            });
            
        } catch (error) {
            Logger.error('Erro ao notificar novo pedido:', { error: error.message });
        }
    }
    
    async notifyPaymentReceived(orderId) {
        try {
            const message = `✅ *PAGAMENTO PROCESSADO!*\n\n📋 *Pedido:* ${orderId}\n\n🔄 Gerando documento...`;
            
            await this.sendMessage(message);
            
        } catch (error) {
            Logger.error('Erro ao notificar pagamento:', { error: error.message });
        }
    }
    
    async notifyDocumentGenerated(orderId, documentPath) {
        try {
            const message = `✅ *DOCUMENTO GERADO COM SUCESSO!*\n\n📋 *Pedido:* ${orderId}\n\n📄 Cliente recebeu o atestado.`;
            
            if (documentPath && fs.existsSync(documentPath)) {
                await this.sendPhoto(documentPath, message);
            } else {
                await this.sendMessage(message);
            }
            
        } catch (error) {
            Logger.error('Erro ao notificar documento gerado:', { error: error.message });
        }
    }
}

// Inicialização
async function main() {
    Logger.info('Iniciando Bot Telegram Admin...');
    
    const adminBot = new TelegramAdminBot();
    await adminBot.initialize();
    
    // Handlers de processo
    process.on('SIGTERM', async () => {
        Logger.info('Encerrando bot graciosamente...');
        if (adminBot.database) {
            await adminBot.database.close();
        }
        process.exit(0);
    });
    
    process.on('SIGINT', async () => {
        Logger.info('Encerrando bot graciosamente...');
        if (adminBot.database) {
            await adminBot.database.close();
        }
        process.exit(0);
    });
    
    process.on('uncaughtException', (error) => {
        Logger.error('Erro crítico não capturado:', { error: error.message });
        process.exit(1);
    });
    
    process.on('unhandledRejection', (reason, promise) => {
        Logger.error('Promise rejeitada não tratada:', { reason });
        process.exit(1);
    });
    
    Logger.info('Bot Telegram Admin rodando...');
}

// Executar se for chamado diretamente
if (require.main === module) {
    main().catch(error => {
        Logger.error('Erro na inicialização:', { error: error.message });
        process.exit(1);
    });
}

module.exports = { TelegramAdminBot };