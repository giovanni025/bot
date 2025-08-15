// services/conversationService.js
class ConversationService {
    constructor(database) {
        this.db = database;
    }
    
    // Buscar conversa ativa do usuário
    async getActiveConversation(userId) {
        try {
            const conversation = await this.db.get(
                `SELECT * FROM conversations 
                 WHERE user_id = ? AND is_active = TRUE 
                 ORDER BY last_activity DESC 
                 LIMIT 1`,
                [userId]
            );
            
            if (conversation) {
                console.log(`💬 Conversa ativa encontrada: ID ${conversation.id}, Estado: ${conversation.state}, Usuário: ${userId}`);
            }
            
            return conversation || null;
        } catch (error) {
            console.error('Erro ao buscar conversa ativa:', error);
            return null;
        }
    }
    
    // Iniciar nova conversa
    async startConversation(userId, initialState = 'initial') {
        try {
            const now = new Date().toISOString();
            
            // Primeiro, encerrar qualquer conversa ativa anterior
            await this.endActiveConversations(userId);
            
            // Criar nova conversa
            const result = await this.db.run(
                `INSERT INTO conversations (user_id, state, is_active, started_at, last_activity, created_at, updated_at)
                 VALUES (?, ?, TRUE, ?, ?, ?, ?)`,
                [userId, initialState, now, now, now, now]
            );
            
            if (result.id) {
                console.log(`🆕 Nova conversa iniciada: ID ${result.id}, Usuário: ${userId}, Estado: ${initialState}`);
                
                // Retornar a conversa criada
                return await this.getConversationById(result.id);
            } else {
                throw new Error('Falha ao criar conversa - ID não retornado');
            }
        } catch (error) {
            console.error('Erro ao iniciar conversa:', error);
            throw error;
        }
    }
    
    // Buscar conversa por ID
    async getConversationById(conversationId) {
        try {
            const conversation = await this.db.get(
                'SELECT * FROM conversations WHERE id = ?',
                [conversationId]
            );
            
            return conversation || null;
        } catch (error) {
            console.error('Erro ao buscar conversa por ID:', error);
            return null;
        }
    }
    
    // Atualizar estado da conversa
    async updateConversationState(conversationId, newState) {
        try {
            const now = new Date().toISOString();
            
            const result = await this.db.run(
                `UPDATE conversations 
                 SET state = ?, last_activity = ?, updated_at = ? 
                 WHERE id = ? AND is_active = TRUE`,
                [newState, now, now, conversationId]
            );
            
            if (result.changes > 0) {
                console.log(`🔄 Estado da conversa ${conversationId} atualizado para: ${newState}`);
                return true;
            } else {
                console.warn(`⚠️ Conversa ${conversationId} não encontrada ou inativa`);
                return false;
            }
        } catch (error) {
            console.error('Erro ao atualizar estado da conversa:', error);
            return false;
        }
    }
    
    // Atualizar última atividade da conversa
    async updateLastActivity(conversationId) {
        try {
            const now = new Date().toISOString();
            
            const result = await this.db.run(
                'UPDATE conversations SET last_activity = ?, updated_at = ? WHERE id = ?',
                [now, now, conversationId]
            );
            
            return result.changes > 0;
        } catch (error) {
            console.error('Erro ao atualizar última atividade:', error);
            return false;
        }
    }
    
    // Encerrar conversas ativas do usuário
    async endActiveConversations(userId) {
        try {
            const now = new Date().toISOString();
            
            const result = await this.db.run(
                'UPDATE conversations SET is_active = FALSE, updated_at = ? WHERE user_id = ? AND is_active = TRUE',
                [now, userId]
            );
            
            if (result.changes > 0) {
                console.log(`🔚 ${result.changes} conversas ativas encerradas para usuário ${userId}`);
            }
            
            return result.changes;
        } catch (error) {
            console.error('Erro ao encerrar conversas ativas:', error);
            return 0;
        }
    }
    
    // Encerrar conversa específica
    async endConversation(conversationId) {
        try {
            const now = new Date().toISOString();
            
            const result = await this.db.run(
                'UPDATE conversations SET is_active = FALSE, updated_at = ? WHERE id = ?',
                [now, conversationId]
            );
            
            if (result.changes > 0) {
                console.log(`🔚 Conversa ${conversationId} encerrada`);
            }
            
            return result.changes > 0;
        } catch (error) {
            console.error('Erro ao encerrar conversa:', error);
            return false;
        }
    }
    
    // Salvar mensagem na conversa
    async saveMessage(conversationId, userId, messageText, direction) {
        try {
            const now = new Date().toISOString();
            
            // Salvar a mensagem
            const result = await this.db.run(
                `INSERT INTO messages (conversation_id, user_id, message_text, direction, sent_at, created_at)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [conversationId, userId, messageText, direction, now, now]
            );
            
            // Atualizar última atividade da conversa
            await this.updateLastActivity(conversationId);
            
            if (result.id) {
                console.log(`💬 Mensagem salva: ID ${result.id}, Conversa: ${conversationId}, Direção: ${direction}`);
                return result.id;
            } else {
                throw new Error('Falha ao salvar mensagem - ID não retornado');
            }
        } catch (error) {
            console.error('Erro ao salvar mensagem:', error);
            return null;
        }
    }
    
    // Obter histórico de mensagens da conversa
    async getConversationMessages(conversationId, limit = 50) {
        try {
            const messages = await this.db.all(
                `SELECT m.*, u.phone_number 
                 FROM messages m
                 JOIN users u ON m.user_id = u.id
                 WHERE m.conversation_id = ? 
                 ORDER BY m.sent_at DESC 
                 LIMIT ?`,
                [conversationId, limit]
            );
            
            return messages.reverse(); // Retornar em ordem cronológica
        } catch (error) {
            console.error('Erro ao obter mensagens da conversa:', error);
            return [];
        }
    }
    
    // Obter últimas conversas do usuário
    async getUserConversations(userId, limit = 10) {
        try {
            const conversations = await this.db.all(
                `SELECT c.*, COUNT(m.id) as message_count
                 FROM conversations c
                 LEFT JOIN messages m ON c.id = m.conversation_id
                 WHERE c.user_id = ?
                 GROUP BY c.id
                 ORDER BY c.last_activity DESC
                 LIMIT ?`,
                [userId, limit]
            );
            
            return conversations;
        } catch (error) {
            console.error('Erro ao obter conversas do usuário:', error);
            return [];
        }
    }
    
    // Buscar conversas por estado
    async getConversationsByState(state, isActive = true) {
        try {
            const conversations = await this.db.all(
                `SELECT c.*, u.phone_number
                 FROM conversations c
                 JOIN users u ON c.user_id = u.id
                 WHERE c.state = ? AND c.is_active = ?
                 ORDER BY c.last_activity DESC`,
                [state, isActive]
            );
            
            return conversations;
        } catch (error) {
            console.error('Erro ao buscar conversas por estado:', error);
            return [];
        }
    }
    
    // Obter estatísticas gerais das conversas
    async getConversationStats() {
        try {
            const stats = await this.db.get(
                `SELECT 
                    COUNT(*) as total_conversations,
                    COUNT(CASE WHEN is_active = TRUE THEN 1 END) as active_conversations,
                    COUNT(DISTINCT user_id) as unique_users,
                    COUNT(CASE WHEN DATE(started_at) = DATE('now') THEN 1 END) as today_conversations
                 FROM conversations`
            );
            
            const stateStats = await this.db.all(
                `SELECT state, COUNT(*) as count
                 FROM conversations 
                 WHERE is_active = TRUE
                 GROUP BY state
                 ORDER BY count DESC`
            );
            
            return {
                general: stats,
                by_state: stateStats
            };
        } catch (error) {
            console.error('Erro ao obter estatísticas das conversas:', error);
            return null;
        }
    }
    
    // Limpar conversas antigas (mais de 7 dias e inativas)
    async cleanupOldConversations() {
        try {
            const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
            
            // Primeiro, remover mensagens das conversas antigas
            const messagesResult = await this.db.run(
                `DELETE FROM messages 
                 WHERE conversation_id IN (
                     SELECT id FROM conversations 
                     WHERE is_active = FALSE AND last_activity < ?
                 )`,
                [sevenDaysAgo]
            );
            
            // Depois, remover as conversas antigas
            const conversationsResult = await this.db.run(
                'DELETE FROM conversations WHERE is_active = FALSE AND last_activity < ?',
                [sevenDaysAgo]
            );
            
            if (conversationsResult.changes > 0) {
                console.log(`🧹 ${conversationsResult.changes} conversas antigas removidas (${messagesResult.changes} mensagens)`);
            }
            
            return {
                conversations: conversationsResult.changes,
                messages: messagesResult.changes
            };
        } catch (error) {
            console.error('Erro ao limpar conversas antigas:', error);
            return { conversations: 0, messages: 0 };
        }
    }
    
    // Verificar se usuário tem conversa ativa
    async hasActiveConversation(userId) {
        try {
            const count = await this.db.get(
                'SELECT COUNT(*) as count FROM conversations WHERE user_id = ? AND is_active = TRUE',
                [userId]
            );
            
            return (count?.count || 0) > 0;
        } catch (error) {
            console.error('Erro ao verificar conversa ativa:', error);
            return false;
        }
    }
}

module.exports = ConversationService;