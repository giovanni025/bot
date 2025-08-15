// webhook-server.js - Servidor específico para webhook na porta 3002
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');

// Configurações
const PORT = 3002;
const config = {
    EVOLUTION_API_URL: process.env.EVOLUTION_API_URL || 'https://evolution.pxbetapp.win',
    API_KEY: process.env.API_KEY || '',
    INSTANCE_NAME: process.env.INSTANCE_NAME || 'bot'
};

// Sistema de Log
class Logger {
    log(level, message, data = null) {
        const timestamp = new Date().toISOString();
        const logEntry = {
            timestamp,
            level: level.toUpperCase(),
            message,
            ...(data && { data })
        };
        
        console.log(JSON.stringify(logEntry));
    }
    
    error(message, data = null) { this.log('error', message, data); }
    warn(message, data = null) { this.log('warn', message, data); }
    info(message, data = null) { this.log('info', message, data); }
    debug(message, data = null) { this.log('debug', message, data); }
    
    maskNumber(number) {
        if (!number || number.length < 8) return number;
        const cleanNumber = number.replace(/\D/g, '');
        return cleanNumber.slice(0, 4) + '*'.repeat(cleanNumber.length - 8) + cleanNumber.slice(-4);
    }
}

const logger = new Logger();

// Processador de Mensagens Simplificado
class MessageProcessor {
    constructor() {
        this.messageCount = 0;
    }

    async processWebhookEvent(eventData) {
        try {
            const { event, data, instance } = eventData;
            
            logger.info(`📨 Evento recebido: ${event}`, {
                instance,
                hasData: !!data,
                dataType: Array.isArray(data) ? 'array' : typeof data
            });

            switch (event) {
                case 'MESSAGES_UPSERT':
                case 'messages.upsert':
                    await this.handleMessagesUpsert(data, instance);
                    break;
                    
                case 'CONNECTION_UPDATE':
                case 'connection.update':
                    await this.handleConnectionUpdate(data, instance);
                    break;
                    
                case 'QRCODE_UPDATED':
                case 'qrcode.updated':
                    await this.handleQrCodeUpdate(data, instance);
                    break;
                    
                case 'APPLICATION_STARTUP':
                case 'application.startup':
                    logger.info('🚀 Aplicação iniciada', { instance });
                    break;
                    
                case 'PRESENCE_UPDATE':
                case 'presence.update':
                    logger.debug('👤 Atualização de presença', { instance });
                    break;
                    
                case 'CONTACTS_UPDATE':
                case 'contacts.update':
                    logger.debug('📞 Contatos atualizados', { instance });
                    break;
                    
                case 'CHATS_UPDATE':
                case 'chats.update':
                    logger.debug('💬 Chats atualizados', { instance });
                    break;
                    
                default:
                    logger.debug(`🔍 Evento não tratado: ${event}`, { instance });
            }
            
        } catch (error) {
            logger.error('❌ Erro ao processar evento webhook:', error.message);
        }
    }

    async handleMessagesUpsert(data, instance) {
        if (!data) return;
        
        logger.info('💌 Processando mensagens', { instance });
        
        // Tratar diferentes formatos de dados
        let messages = [];
        
        if (Array.isArray(data)) {
            messages = data;
        } else if (data.messages && Array.isArray(data.messages)) {
            messages = data.messages;
        } else if (data.key && data.message) {
            messages = [data];
        } else {
            logger.warn('📨 Formato de dados de mensagem não reconhecido:', { dataKeys: Object.keys(data) });
            return;
        }
        
        for (const messageData of messages) {
            await this.processMessage(messageData, instance);
        }
    }

    async processMessage(messageData, instance) {
        try {
            const { key, message, messageTimestamp } = messageData;
            
            if (!key || !message || key.fromMe) {
                return; // Ignorar mensagens próprias ou inválidas
            }

            this.messageCount++;
            
            const remoteJid = key.remoteJid;
            const number = remoteJid.replace(/@[sc]\.whatsapp\.net/, '');
            const timestamp = new Date(parseInt(messageTimestamp) * 1000);
            
            // Extrair texto da mensagem
            let messageText = '';
            let messageType = 'unknown';
            
            if (message.conversation) {
                messageText = message.conversation;
                messageType = 'text';
            } else if (message.extendedTextMessage?.text) {
                messageText = message.extendedTextMessage.text;
                messageType = 'extended_text';
            } else if (message.imageMessage) {
                messageText = message.imageMessage.caption || '[Imagem]';
                messageType = 'image';
            } else if (message.documentMessage) {
                messageText = `[Documento: ${message.documentMessage.fileName}]`;
                messageType = 'document';
            } else if (message.audioMessage) {
                messageText = '[Áudio]';
                messageType = 'audio';
            } else if (message.videoMessage) {
                messageText = '[Vídeo]';
                messageType = 'video';
            } else {
                messageText = '[Mensagem não suportada]';
                messageType = 'other';
                logger.debug('Tipo de mensagem não reconhecido:', Object.keys(message));
            }

            logger.info(`💬 Mensagem #${this.messageCount}`, {
                from: logger.maskNumber(number),
                type: messageType,
                text: messageText.substring(0, 100),
                timestamp: timestamp.toISOString(),
                instance
            });

            // Processar a mensagem (aqui você pode adicionar sua lógica de bot)
            await this.handleUserMessage(number, messageText, messageType, instance);
            
        } catch (error) {
            logger.error('❌ Erro ao processar mensagem:', error.message);
        }
    }

    async handleUserMessage(number, text, type, instance) {
        // Aqui você pode implementar a lógica do seu bot
        // Por exemplo:
        
        if (text.toLowerCase().includes('oi') || text.toLowerCase().includes('olá')) {
            logger.info(`👋 Saudação detectada de ${logger.maskNumber(number)}`);
            // Aqui você chamaria a função para responder
        }
        
        if (text.toLowerCase().includes('preço') || text.toLowerCase().includes('valor')) {
            logger.info(`💰 Interesse em preços de ${logger.maskNumber(number)}`);
            // Aqui você chamaria a função para mostrar preços
        }
        
        // Adicione mais lógicas conforme necessário
    }

    async handleConnectionUpdate(data, instance) {
        if (!data) return;
        
        const { state, connection } = data;
        
        logger.info(`🔗 Atualização de conexão`, {
            instance,
            state,
            connection
        });
        
        switch (state) {
            case 'open':
                logger.info('✅ WhatsApp conectado!', { instance });
                break;
            case 'close':
                logger.warn('❌ WhatsApp desconectado!', { instance });
                break;
            case 'connecting':
                logger.info('🔄 Conectando ao WhatsApp...', { instance });
                break;
        }
    }

    async handleQrCodeUpdate(data, instance) {
        if (!data) return;
        
        logger.info('📱 QR Code atualizado', {
            instance,
            hasQrCode: !!data.qrcode
        });
        
        if (data.qrcode) {
            logger.info('🔗 QR Code disponível para escaneamento');
            // Aqui você pode salvar o QR code ou enviá-lo para algum lugar
        }
    }
}

const messageProcessor = new MessageProcessor();

// Configurar Express
const app = express();

// Middlewares
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Middleware de log
app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - start;
        logger.debug(`${req.method} ${req.path} - ${res.statusCode} - ${duration}ms`);
    });
    next();
});

// Rotas

// Health check
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        messagesProcessed: messageProcessor.messageCount,
        version: '1.0.0'
    });
});

// Página inicial
app.get('/', (req, res) => {
    res.json({
        service: 'Webhook Server - Evolution API',
        status: 'online',
        port: PORT,
        endpoints: {
            webhook: '/webhook',
            health: '/health',
            stats: '/stats'
        },
        timestamp: new Date().toISOString(),
        messagesProcessed: messageProcessor.messageCount
    });
});

// Endpoint principal do webhook
app.post('/webhook', async (req, res) => {
    try {
        const eventData = req.body;
        
        // Log da requisição (limitando o tamanho para não poluir)
        logger.debug('📨 Webhook recebido', {
            event: eventData.event,
            hasData: !!eventData.data,
            instance: eventData.instance,
            bodySize: JSON.stringify(eventData).length
        });
        
        // Processar o evento
        await messageProcessor.processWebhookEvent(eventData);
        
        // Responder rapidamente
        res.status(200).json({
            status: 'received',
            timestamp: new Date().toISOString(),
            event: eventData.event
        });
        
    } catch (error) {
        logger.error('❌ Erro no webhook:', error.message);
        res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            timestamp: new Date().toISOString()
        });
    }
});

// Endpoint de estatísticas
app.get('/stats', (req, res) => {
    res.json({
        messagesProcessed: messageProcessor.messageCount,
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        timestamp: new Date().toISOString()
    });
});

// Endpoint de teste
app.get('/test', (req, res) => {
    res.json({
        message: 'Webhook server está funcionando!',
        url: `${req.protocol}://${req.get('host')}/webhook`,
        timestamp: new Date().toISOString()
    });
});

// Handler para rotas não encontradas
app.use('*', (req, res) => {
    res.status(404).json({
        error: 'Rota não encontrada',
        path: req.originalUrl,
        method: req.method
    });
});

// Middleware de tratamento de erros
app.use((error, req, res, next) => {
    logger.error('❌ Erro no servidor:', error.message);
    res.status(500).json({
        error: 'Internal server error',
        message: error.message
    });
});

// Iniciar servidor
app.listen(PORT, () => {
    logger.info(`🌐 Servidor webhook rodando na porta ${PORT}`);
    logger.info(`📡 Evolution API: ${config.EVOLUTION_API_URL}`);
    logger.info(`🤖 Instância: ${config.INSTANCE_NAME}`);
    logger.info(`🎯 Webhook endpoint: http://localhost:${PORT}/webhook`);
    logger.info(`🏥 Health check: http://localhost:${PORT}/health`);
    logger.info('=' .repeat(60));
    logger.info('✅ Servidor pronto para receber webhooks!');
});

// Handlers de processo
process.on('SIGTERM', () => {
    logger.info('🛑 Encerrando servidor graciosamente...');
    process.exit(0);
});

process.on('SIGINT', () => {
    logger.info('🛑 Encerrando servidor graciosamente...');
    process.exit(0);
});

process.on('uncaughtException', (error) => {
    logger.error('❌ Erro crítico não capturado:', error.message);
    process.exit(1);
});

process.on('unhandledRejection', (reason) => {
    logger.error('❌ Promise rejeitada não tratada:', reason);
    process.exit(1);
});

module.exports = app;