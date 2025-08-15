const cron = require('node-cron');

class SchedulerService {
    constructor(database, evolutionAPI) {
        this.db = database;
        this.evolutionAPI = evolutionAPI;
        this.jobs = new Map();
    }

    async scheduleMessage(userId, messageText, scheduledFor) {
        try {
            const result = await this.db.run(
                `INSERT INTO scheduled_messages (user_id, message_text, scheduled_for, status)
                 VALUES (?, ?, ?, 'pending')`,
                [userId, messageText, scheduledFor]
            );

            return result.id;
        } catch (error) {
            console.error('Erro ao agendar mensagem:', error);
            throw error;
        }
    }

    async processPendingMessages() {
        try {
            const pendingMessages = await this.db.all(`
                SELECT sm.*, u.phone_number
                FROM scheduled_messages sm
                JOIN users u ON sm.user_id = u.id
                WHERE sm.status = 'pending'
                AND sm.scheduled_for <= CURRENT_TIMESTAMP
            `);

            for (const message of pendingMessages) {
                try {
                    await this.evolutionAPI.sendMessage(
                        message.phone_number,
                        message.message_text
                    );

                    await this.db.run(
                        'UPDATE scheduled_messages SET status = "sent", sent_at = CURRENT_TIMESTAMP WHERE id = ?',
                        [message.id]
                    );

                    console.log(`✅ Mensagem agendada enviada para ${message.phone_number}`);
                } catch (error) {
                    console.error(`❌ Erro ao enviar mensagem agendada para ${message.phone_number}:`, error);
                    
                    await this.db.run(
                        'UPDATE scheduled_messages SET status = "failed" WHERE id = ?',
                        [message.id]
                    );
                }
            }
        } catch (error) {
            console.error('Erro ao processar mensagens pendentes:', error);
        }
    }

    startScheduler() {
        // Processar mensagens agendadas a cada minuto
        cron.schedule('* * * * *', () => {
            this.processPendingMessages();
        });

        // Follow-up automático de leads (diário às 9h)
        cron.schedule('0 9 * * *', async () => {
            await this.processLeadFollowups();
        });

        console.log('📅 Agendador iniciado');
    }

    async processLeadFollowups() {
        try {
            const LeadService = require('./leadService');
            const leadService = new LeadService(this.db);
            
            const leadsForFollowup = await leadService.getLeadsForFollowup();

            for (const lead of leadsForFollowup) {
                const followupMessage = this.generateFollowupMessage(lead);
                
                await this.evolutionAPI.sendMessage(
                    lead.phone_number,
                    followupMessage
                );

                await leadService.addLeadNote(
                    lead.user_id,
                    'Follow-up automático enviado'
                );

                console.log(`📞 Follow-up enviado para ${lead.phone_number}`);
            }
        } catch (error) {
            console.error('Erro no follow-up automático:', error);
        }
    }

    generateFollowupMessage(lead) {
        const messages = [
            `Olá! 😊 Notei que você demonstrou interesse em nossos serviços. Tem alguma dúvida que posso esclarecer?`,
            `Oi! 👋 Que tal dar continuidade à nossa conversa? Estou aqui para ajudar com qualquer informação que precisar.`,
            `Olá novamente! 🌟 Gostaria de saber mais sobre nossos serviços ou tem alguma pergunta específica?`
        ];

        return messages[Math.floor(Math.random() * messages.length)];
    }
}

module.exports = SchedulerService;