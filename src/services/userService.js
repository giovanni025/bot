// services/userService.js
class UserService {
    constructor(database) {
        this.db = database;
    }
    
    // Normalizar número de telefone
    _normalizePhoneNumber(phoneNumber) {
        // Remove todos os caracteres não numéricos
        let cleanNumber = phoneNumber.replace(/\D/g, '');
        
        // Se não começa com 55 (código do Brasil), adiciona
        if (!cleanNumber.startsWith('55')) {
            cleanNumber = '55' + cleanNumber;
        }
        
        return cleanNumber;
    }
    
    // Buscar usuário por número de telefone
    async findUserByPhone(phoneNumber) {
        try {
            const normalizedPhone = this._normalizePhoneNumber(phoneNumber);
            
            const user = await this.db.get(
                'SELECT * FROM users WHERE phone_number = ?',
                [normalizedPhone]
            );
            
            return user || null;
        } catch (error) {
            console.error('Erro ao buscar usuário por telefone:', error);
            return null;
        }
    }
    
    // Buscar usuário por ID
    async findUserById(userId) {
        try {
            const user = await this.db.get(
                'SELECT * FROM users WHERE id = ?',
                [userId]
            );
            
            return user || null;
        } catch (error) {
            console.error('Erro ao buscar usuário por ID:', error);
            return null;
        }
    }
    
    // Criar novo usuário
    async createUser(phoneNumber, name = null) {
        try {
            const normalizedPhone = this._normalizePhoneNumber(phoneNumber);
            const now = new Date().toISOString();
            
            const result = await this.db.run(
                `INSERT INTO users (phone_number, name, first_contact, last_contact, message_count, created_at, updated_at)
                 VALUES (?, ?, ?, ?, 0, ?, ?)`,
                [normalizedPhone, name, now, now, now, now]
            );
            
            if (result.id) {
                console.log(`👤 Novo usuário criado: ID ${result.id}, Telefone: ${this._maskPhone(normalizedPhone)}`);
                
                // Retornar o usuário criado
                return await this.findUserById(result.id);
            } else {
                throw new Error('Falha ao criar usuário - ID não retornado');
            }
        } catch (error) {
            console.error('Erro ao criar usuário:', error);
            throw error;
        }
    }
    
    // Buscar ou criar usuário (método principal)
    async findOrCreateUser(phoneNumber, name = null) {
        try {
            const normalizedPhone = this._normalizePhoneNumber(phoneNumber);
            
            // Primeiro, tenta buscar usuário existente
            let user = await this.findUserByPhone(normalizedPhone);
            
            if (user) {
                // Usuário existe - atualizar dados de último contato
                await this.updateLastContact(user.id);
                
                // Se é um usuário que já retornou, marcar como returning
                if (!user.is_returning && user.message_count > 0) {
                    await this.markAsReturning(user.id);
                    user.is_returning = true;
                }
                
                console.log(`👤 Usuário existente: ID ${user.id}, Telefone: ${this._maskPhone(normalizedPhone)}, Returning: ${user.is_returning}`);
                return user;
            } else {
                // Usuário não existe - criar novo
                user = await this.createUser(normalizedPhone, name);
                return user;
            }
        } catch (error) {
            console.error('Erro ao buscar/criar usuário:', error);
            throw error;
        }
    }
    
    // Atualizar último contato do usuário
    async updateLastContact(userId) {
        try {
            const now = new Date().toISOString();
            
            const result = await this.db.run(
                `UPDATE users 
                 SET last_contact = ?, 
                     message_count = message_count + 1, 
                     updated_at = ?
                 WHERE id = ?`,
                [now, now, userId]
            );
            
            return result.changes > 0;
        } catch (error) {
            console.error('Erro ao atualizar último contato:', error);
            return false;
        }
    }
    
    // Marcar usuário como retornante
    async markAsReturning(userId) {
        try {
            const now = new Date().toISOString();
            
            const result = await this.db.run(
                'UPDATE users SET is_returning = TRUE, updated_at = ? WHERE id = ?',
                [now, userId]
            );
            
            if (result.changes > 0) {
                console.log(`🔄 Usuário ${userId} marcado como retornante`);
            }
            
            return result.changes > 0;
        } catch (error) {
            console.error('Erro ao marcar usuário como retornante:', error);
            return false;
        }
    }
    
    // Atualizar nome do usuário
    async updateUserName(userId, name) {
        try {
            const now = new Date().toISOString();
            
            const result = await this.db.run(
                'UPDATE users SET name = ?, updated_at = ? WHERE id = ?',
                [name, now, userId]
            );
            
            return result.changes > 0;
        } catch (error) {
            console.error('Erro ao atualizar nome do usuário:', error);
            return false;
        }
    }
    
    // Obter estatísticas do usuário
    async getUserStats(userId) {
        try {
            const stats = await this.db.get(
                `SELECT 
                    COUNT(DISTINCT c.id) as total_conversations,
                    COUNT(m.id) as total_messages,
                    MAX(c.last_activity) as last_conversation,
                    u.first_contact,
                    u.message_count
                 FROM users u
                 LEFT JOIN conversations c ON u.id = c.user_id
                 LEFT JOIN messages m ON c.id = m.conversation_id
                 WHERE u.id = ?
                 GROUP BY u.id`,
                [userId]
            );
            
            return stats || {
                total_conversations: 0,
                total_messages: 0,
                last_conversation: null,
                first_contact: null,
                message_count: 0
            };
        } catch (error) {
            console.error('Erro ao obter estatísticas do usuário:', error);
            return null;
        }
    }
    
    // Listar usuários ativos (últimas 24 horas)
    async getActiveUsers() {
        try {
            const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
            
            const users = await this.db.all(
                'SELECT * FROM users WHERE last_contact > ? ORDER BY last_contact DESC',
                [yesterday]
            );
            
            return users;
        } catch (error) {
            console.error('Erro ao listar usuários ativos:', error);
            return [];
        }
    }
    
    // Método auxiliar para mascarar número de telefone nos logs
    _maskPhone(phoneNumber) {
        if (!phoneNumber || phoneNumber.length < 8) return phoneNumber;
        return phoneNumber.slice(0, 4) + '*'.repeat(phoneNumber.length - 8) + phoneNumber.slice(-4);
    }
    
    // Limpar dados antigos (usuários inativos há mais de 30 dias)
    async cleanupOldUsers() {
        try {
            const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
            
            // Primeiro, remover conversas antigas
            await this.db.run(
                'DELETE FROM conversations WHERE user_id IN (SELECT id FROM users WHERE last_contact < ?)',
                [thirtyDaysAgo]
            );
            
            // Depois, remover usuários antigos
            const result = await this.db.run(
                'DELETE FROM users WHERE last_contact < ?',
                [thirtyDaysAgo]
            );
            
            if (result.changes > 0) {
                console.log(`🧹 ${result.changes} usuários antigos foram removidos`);
            }
            
            return result.changes;
        } catch (error) {
            console.error('Erro ao limpar usuários antigos:', error);
            return 0;
        }
    }
}

module.exports = UserService;