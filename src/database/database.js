// database/database.js
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

class Database {
    constructor() {
        this.dbPath = path.join(__dirname, '..', 'data', 'bot.db');
        this.db = null;
        this.ensureDataDirectory();
    }
    
    ensureDataDirectory() {
        const dataDir = path.dirname(this.dbPath);
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }
    }
    
    async initialize() {
        return new Promise((resolve, reject) => {
            this.db = new sqlite3.Database(this.dbPath, (err) => {
                if (err) {
                    console.error('Erro ao conectar com o banco:', err);
                    reject(err);
                } else {
                    console.log('✅ Banco de dados conectado');
                    this.createTables().then(resolve).catch(reject);
                }
            });
        });
    }
    
    async createTables() {
        const createUsersTable = `
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                phone_number TEXT UNIQUE NOT NULL,
                name TEXT,
                is_returning BOOLEAN DEFAULT FALSE,
                first_contact DATETIME DEFAULT CURRENT_TIMESTAMP,
                last_contact DATETIME DEFAULT CURRENT_TIMESTAMP,
                message_count INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `;
        
        const createConversationsTable = `
            CREATE TABLE IF NOT EXISTS conversations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                state TEXT DEFAULT 'initial',
                is_active BOOLEAN DEFAULT TRUE,
                started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                last_activity DATETIME DEFAULT CURRENT_TIMESTAMP,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users (id)
            )
        `;
        
        const createMessagesTable = `
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                conversation_id INTEGER NOT NULL,
                user_id INTEGER NOT NULL,
                message_text TEXT NOT NULL,
                direction TEXT NOT NULL CHECK (direction IN ('incoming', 'outgoing')),
                sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (conversation_id) REFERENCES conversations (id),
                FOREIGN KEY (user_id) REFERENCES users (id)
            )
        `;
        
        const createIndexes = [
            'CREATE INDEX IF NOT EXISTS idx_users_phone ON users (phone_number)',
            'CREATE INDEX IF NOT EXISTS idx_conversations_user_active ON conversations (user_id, is_active)',
            'CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages (conversation_id)',
            'CREATE INDEX IF NOT EXISTS idx_conversations_last_activity ON conversations (last_activity)'
        ];
        
        try {
            await this.run(createUsersTable);
            await this.run(createConversationsTable);
            await this.run(createMessagesTable);
            
            for (const indexQuery of createIndexes) {
                await this.run(indexQuery);
            }
            
            console.log('✅ Tabelas criadas/verificadas com sucesso');
        } catch (error) {
            console.error('Erro ao criar tabelas:', error);
            throw error;
        }
    }
    
    // Método para executar queries com Promise
    run(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.run(sql, params, function(err) {
                if (err) {
                    reject(err);
                } else {
                    resolve({ id: this.lastID, changes: this.changes });
                }
            });
        });
    }
    
    // Método para buscar um registro
    get(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.get(sql, params, (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(row);
                }
            });
        });
    }
    
    // Método para buscar múltiplos registros
    all(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.all(sql, params, (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });
    }
    
    // Limpar conversas inativas (mais de 30 minutos sem atividade)
    async cleanupInactiveConversations() {
        const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
        
        try {
            const result = await this.run(
                `UPDATE conversations 
                 SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP 
                 WHERE is_active = TRUE AND last_activity < ?`,
                [thirtyMinutesAgo]
            );
            
            if (result.changes > 0) {
                console.log(`🧹 ${result.changes} conversas inativas foram encerradas`);
            }
            
            return result.changes;
        } catch (error) {
            console.error('Erro ao limpar conversas inativas:', error);
            return 0;
        }
    }
    
    async close() {
        return new Promise((resolve) => {
            if (this.db) {
                this.db.close((err) => {
                    if (err) {
                        console.error('Erro ao fechar banco:', err);
                    } else {
                        console.log('🔒 Banco de dados fechado');
                    }
                    resolve();
                });
            } else {
                resolve();
            }
        });
    }
}

module.exports = Database;