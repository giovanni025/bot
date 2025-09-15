const sqlite3 = require('sqlite3').verbose();
const path = require('path');

class Database {
  constructor() {
    this.dbPath = path.join(__dirname, '..', 'data', 'iptv_bot.db');
    this.db = null;
  }

  async init() {
    return new Promise((resolve, reject) => {
      // Criar diretório se não existir
      const fs = require('fs');
      const dir = path.dirname(this.dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      this.db = new sqlite3.Database(this.dbPath, (err) => {
        if (err) {
          console.error('❌ Erro ao conectar no banco:', err.message);
          reject(err);
        } else {
          console.log('✅ Conectado ao banco SQLite');
          this.createTables().then(resolve).catch(reject);
        }
      });
    });
  }

  async createTables() {
    return new Promise((resolve, reject) => {
      const tables = [
        // Tabela de usuários
        `CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          phone TEXT UNIQUE NOT NULL,
          name TEXT,
          city TEXT,
          device TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          last_interaction DATETIME DEFAULT CURRENT_TIMESTAMP,
          message_count INTEGER DEFAULT 0,
          current_state TEXT DEFAULT 'menu_principal'
        )`,

        // Tabela de testes gratuitos
        `CREATE TABLE IF NOT EXISTS free_tests (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER,
          name TEXT NOT NULL,
          city TEXT NOT NULL,
          device TEXT NOT NULL,
          test_login TEXT,
          test_password TEXT,
          status TEXT DEFAULT 'pending',
          expires_at DATETIME,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          approved_at DATETIME,
          FOREIGN KEY (user_id) REFERENCES users (id)
        )`,

        // Tabela de assinaturas
        `CREATE TABLE IF NOT EXISTS subscriptions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER,
          plan TEXT NOT NULL,
          login TEXT,
          password TEXT,
          price REAL NOT NULL,
          status TEXT DEFAULT 'pending',
          expires_at DATETIME,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          approved_at DATETIME,
          FOREIGN KEY (user_id) REFERENCES users (id)
        )`,

        // Tabela de renovações
        `CREATE TABLE IF NOT EXISTS renewals (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER,
          current_login TEXT NOT NULL,
          plan TEXT NOT NULL,
          price REAL NOT NULL,
          status TEXT DEFAULT 'pending',
          payment_proof TEXT,
          expires_at DATETIME,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          approved_at DATETIME,
          FOREIGN KEY (user_id) REFERENCES users (id)
        )`,

        // Tabela de comprovantes de pagamento
        `CREATE TABLE IF NOT EXISTS payment_proofs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER,
          phone TEXT NOT NULL,
          request_type TEXT NOT NULL,
          request_id INTEGER NOT NULL,
          proof_data TEXT,
          status TEXT DEFAULT 'pending',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          reviewed_at DATETIME,
          FOREIGN KEY (user_id) REFERENCES users (id)
        )`,

        // Tabela de mensagens (log)
        `CREATE TABLE IF NOT EXISTS messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER,
          phone TEXT NOT NULL,
          message_content TEXT NOT NULL,
          message_type TEXT DEFAULT 'received',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users (id)
        )`,

        // Tabela de solicitações de suporte
        `CREATE TABLE IF NOT EXISTS support_requests (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER,
          phone TEXT NOT NULL,
          problem_description TEXT NOT NULL,
          status TEXT DEFAULT 'open',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          resolved_at DATETIME,
          FOREIGN KEY (user_id) REFERENCES users (id)
        )`,

        // Tabela de configurações
        `CREATE TABLE IF NOT EXISTS settings (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          key_name TEXT UNIQUE NOT NULL,
          key_value TEXT NOT NULL,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`
      ];

      let completed = 0;
      tables.forEach((sql) => {
        this.db.run(sql, (err) => {
          if (err) {
            console.error('❌ Erro ao criar tabela:', err.message);
            reject(err);
          } else {
            completed++;
            if (completed === tables.length) {
              console.log('✅ Tabelas criadas/verificadas');
              this.insertDefaultSettings().then(resolve).catch(reject);
            }
          }
        });
      });
    });
  }

  async insertDefaultSettings() {
    const defaultSettings = [
      { key_name: 'pix_key', key_value: 'usuario@exemplo.com' },
      { key_name: 'pix_name', key_value: 'IPTV Premium' },
      { key_name: 'test_duration_hours', key_value: '6' },
      { key_name: 'monthly_plan_price', key_value: '45.00' },
      { key_name: 'quarterly_plan_price', key_value: '120.00' },
      { key_name: 'semiannual_plan_price', key_value: '210.00' },
      { key_name: 'annual_plan_price', key_value: '420.00' },
      { key_name: 'iptv_server_url', key_value: 'http://tv.exemplo.com:8080' },
      { key_name: 'admin_telegram_id', key_value: '0' },
      { key_name: 'business_hours', key_value: 'Segunda à Sexta: 8h às 18h' }
    ];

    return new Promise((resolve) => {
      let completed = 0;
      defaultSettings.forEach(setting => {
        this.db.run(
          'INSERT OR REPLACE INTO settings (key_name, key_value) VALUES (?, ?)',
          [setting.key_name, setting.key_value],
          (err) => {
            if (err) console.error('❌ Erro ao inserir configuração:', err.message);
            completed++;
            if (completed === defaultSettings.length) {
              console.log('✅ Configurações padrão verificadas');
              resolve();
            }
          }
        );
      });
    });
  }

  // Métodos auxiliares para queries
  get(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  }

  all(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  run(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, function(err) {
        if (err) reject(err);
        else resolve({ id: this.lastID, changes: this.changes });
      });
    });
  }

  close() {
    return new Promise((resolve) => {
      this.db.close((err) => {
        if (err) console.error('❌ Erro ao fechar banco:', err.message);
        else console.log('✅ Conexão com banco fechada');
        resolve();
      });
    });
  }
}

// Instância singleton
const database = new Database();

module.exports = database;