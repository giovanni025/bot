// Carregar variáveis de ambiente PRIMEIRO
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');
const database = require('./database/setup');
const telegramAdmin = require('./services/telegram-admin');
const { evolutionWebhooks } = require('./routes/evolution');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Middlewares
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Variáveis globais
const connectedClients = new Set();

// Função de broadcast para WebSocket
const broadcast = (data) => {
  io.emit('webhook_update', data);
  console.log('Broadcasting:', data.type);
};

// Configuração do Socket.IO
io.on('connection', (socket) => {
  console.log('Cliente conectado:', socket.id);
  connectedClients.add(socket.id);

  socket.on('disconnect', () => {
    console.log('Cliente desconectado:', socket.id);
    connectedClients.delete(socket.id);
  });

  // Evento para solicitar status das instâncias
  socket.on('request_instances_status', () => {
    socket.emit('instances_status', {
      connected: connectedClients.size,
      timestamp: new Date().toISOString()
    });
  });
});

// Inicializar banco de dados
async function initializeDatabase() {
  try {
    await database.init();
    console.log('✅ Banco de dados inicializado');
  } catch (error) {
    console.error('❌ Erro ao inicializar banco:', error);
    process.exit(1);
  }
}

// Inicializar Telegram Admin
async function initializeTelegramAdmin() {
  try {
    await telegramAdmin.init();
  } catch (error) {
    console.error('❌ Erro ao inicializar Telegram Admin:', error);
  }
}

// Inicializar webhooks da Evolution API
const evolutionHandler = evolutionWebhooks(broadcast);
evolutionHandler.registerRoutes(app);

// Rota para download de arquivos grandes
app.get('/download/:filename', (req, res) => {
  try {
    const filename = req.params.filename;
    const tempDir = process.env.TEMP_FILES_DIR || './temp';
    const filePath = path.join(tempDir, filename);
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Arquivo não encontrado' });
    }
    
    res.download(filePath, filename, (err) => {
      if (err) {
        console.error('Erro no download:', err);
        res.status(500).json({ error: 'Erro ao baixar arquivo' });
      }
    });
  } catch (error) {
    console.error('Erro na rota de download:', error);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// Rotas básicas
app.get('/', async (req, res) => {
  try {
    const stats = await getSystemStats();
    res.json({
      message: 'IPTV Bot Server Running',
      version: '2.0.0',
      endpoints: {
        webhook: '/webhook',
        health: '/health',
        stats: '/stats'
      },
      connectedClients: connectedClients.size,
      environment: {
        port: process.env.PORT || 3002,
        evolutionUrl: process.env.EVOLUTION_API_URL || 'Not configured',
        hasTelegramBot: !!process.env.TELEGRAM_BOT_TOKEN,
        hasDatabase: true
      },
      stats
    });
  } catch (error) {
    res.status(500).json({ error: 'Error fetching stats', message: error.message });
  }
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    connectedClients: connectedClients.size,
    database: 'connected',
    telegramBot: telegramAdmin.isInitialized ? 'active' : 'inactive'
  });
});

app.get('/stats', async (req, res) => {
  try {
    const stats = await getSystemStats();
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching stats', message: error.message });
  }
});

// Função para buscar estatísticas do sistema
async function getSystemStats() {
  try {
    const totalUsers = await database.get('SELECT COUNT(*) as count FROM users');
    const activeTests = await database.get('SELECT COUNT(*) as count FROM free_tests WHERE expires_at > datetime("now")');
    const activeSubs = await database.get('SELECT COUNT(*) as count FROM subscriptions WHERE status = "active" AND expires_at > datetime("now")');
    const todayUsers = await database.get('SELECT COUNT(*) as count FROM users WHERE DATE(created_at) = DATE("now")');
    const todayMessages = await database.get('SELECT COUNT(*) as count FROM messages WHERE DATE(created_at) = DATE("now")');
    const openSupport = await database.get('SELECT COUNT(*) as count FROM support_requests WHERE status = "open"');

    return {
      users: {
        total: totalUsers.count,
        today: todayUsers.count
      },
      tests: {
        active: activeTests.count
      },
      subscriptions: {
        active: activeSubs.count
      },
      messages: {
        today: todayMessages.count
      },
      support: {
        open: openSupport.count
      },
      lastUpdate: new Date().toISOString()
    };
  } catch (error) {
    console.error('❌ Erro ao buscar estatísticas:', error);
    return {
      error: 'Unable to fetch stats',
      message: error.message
    };
  }
}

// Middleware de tratamento de erros
app.use((error, req, res, next) => {
  console.error('Error:', error);
  res.status(500).json({
    error: 'Internal server error',
    message: error.message
  });
});

// Inicialização do servidor
async function startServer() {
  const PORT = process.env.PORT || 3002;
  const HOST = process.env.HOST || '0.0.0.0';

  try {
    // Inicializar componentes
    await initializeDatabase();
    await initializeTelegramAdmin();

    // Iniciar servidor
    server.listen(PORT, HOST, () => {
      console.log(`
🚀 IPTV Bot Server v2.0 iniciado!
📡 Servidor: http://${HOST}:${PORT}
🔗 WebSocket: ws://${HOST}:${PORT}
📱 Webhooks Evolution API configurados
🤖 Bot IPTV pronto para receber mensagens

📋 Configurações:
🔑 Evolution API: ${process.env.EVOLUTION_API_URL || 'Not configured'}
🤖 Telegram Bot: ${process.env.TELEGRAM_BOT_TOKEN ? 'Configured' : 'Not configured'}
👤 Admin ID: ${process.env.ADMIN_TELEGRAM_ID || 'Not configured'}
📱 Instance: ${process.env.INSTANCE_NAME || 'default'}
📊 Database: SQLite (Conectado)
      `);
    });

  } catch (error) {
    console.error('❌ Erro ao iniciar servidor:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully');
  
  try {
    await database.close();
    server.close(() => {
      console.log('Process terminated');
    });
  } catch (error) {
    console.error('Error during shutdown:', error);
    process.exit(1);
  }
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, shutting down gracefully');
  
  try {
    await database.close();
    server.close(() => {
      console.log('Process terminated');
    });
  } catch (error) {
    console.error('Error during shutdown:', error);
    process.exit(1);
  }
});

// Iniciar o servidor
startServer();