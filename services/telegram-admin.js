const TelegramBot = require('node-telegram-bot-api');
const database = require('../database/setup');
const moment = require('moment');

// Lazy loading do botHandler para evitar dependência circular
let botHandlerModule = null;

async function getBotHandler() {
  if (!botHandlerModule) {
    try {
      botHandlerModule = require('./bot-handler');
    } catch (error) {
      console.log('⚠️ Bot handler não disponível:', error.message);
      return null;
    }
  }
  return botHandlerModule?.botHandler || null;
}

class TelegramAdmin {
  constructor() {
    this.botToken = process.env.TELEGRAM_BOT_TOKEN;
    this.adminChatId = process.env.ADMIN_TELEGRAM_ID;
    this.bot = null;
    this.isInitialized = false;
  }

  async init() {
    if (!this.botToken) {
      console.log('⚠️ TELEGRAM_BOT_TOKEN não configurado - Admin Telegram desabilitado');
      return;
    }

    if (!this.adminChatId) {
      console.log('⚠️ ADMIN_TELEGRAM_ID não configurado - Admin Telegram desabilitado');
      return;
    }

    try {
      this.bot = new TelegramBot(this.botToken, { polling: true });
      this.setupHandlers();
      this.isInitialized = true;
      
      // Enviar menu inicial
      await this.sendMainMenu('🚀 IPTV Bot Admin Pro iniciado!\n\nSistema de gestão avançado ativo.');
      console.log('✅ Telegram Admin Bot Pro inicializado');
      
    } catch (error) {
      console.error('❌ Erro ao inicializar Telegram Admin:', error.message);
    }
  }

  setupHandlers() {
    // Comando /start e /menu
    this.bot.onText(/\/(start|menu)/, async (msg) => {
      if (msg.chat.id.toString() !== this.adminChatId) return;
      await this.sendMainMenu('🎛️ *IPTV Bot Admin Pro*');
    });

    // Comando /debug - informações do sistema
    this.bot.onText(/\/debug/, async (msg) => {
      if (msg.chat.id.toString() !== this.adminChatId) return;
      await this.sendDebugInfo(msg.chat.id);
    });

    // Comando /logs - mensagens recentes
    this.bot.onText(/\/logs/, async (msg) => {
      if (msg.chat.id.toString() !== this.adminChatId) return;
      await this.sendRecentLogs(msg.chat.id);
    });

    // COMANDOS ESPECÍFICOS - MOVIDOS PARA SETUP INICIAL
    this.bot.onText(/\/setplan (\d+) (.+) (.+)/, async (msg, match) => {
      if (msg.chat.id.toString() !== this.adminChatId) return;
      const planId = match[1];
      const login = match[2];
      const senha = match[3];
      await this.setPlanCredentials(msg, planId, login, senha);
    });

    this.bot.onText(/\/settest (\d+) (.+) (.+)/, async (msg, match) => {
      if (msg.chat.id.toString() !== this.adminChatId) return;
      const testId = match[1];
      const login = match[2];
      const senha = match[3];
      await this.setTestCredentials(msg, testId, login, senha);
    });

    // Handler para callbacks dos botões
    this.bot.on('callback_query', async (callbackQuery) => {
      if (callbackQuery.message.chat.id.toString() !== this.adminChatId) return;
      
      const action = callbackQuery.data;
      const messageId = callbackQuery.message.message_id;
      
      try {
        // Confirmar callback
        await this.bot.answerCallbackQuery(callbackQuery.id);
        await this.handleCallback(action, messageId, callbackQuery.message.chat.id);
      } catch (error) {
        console.error('Erro no callback:', error);
        await this.bot.answerCallbackQuery(callbackQuery.id, { 
          text: 'Erro ao processar comando',
          show_alert: true 
        });
      }
    });
  }

  // Enviar menu principal
  async sendMainMenu(text) {
    const keyboard = {
      inline_keyboard: [
        [
          { text: '📊 Dashboard', callback_data: 'dashboard' },
          { text: '👥 Usuários', callback_data: 'users_menu' }
        ],
        [
          { text: '🎯 Testes Pendentes', callback_data: 'pending_tests' },
          { text: '💎 Planos Pendentes', callback_data: 'pending_plans' }
        ],
        [
          { text: '🔄 Renovações Pendentes', callback_data: 'pending_renewals' },
          { text: '🛠️ Suporte', callback_data: 'support_menu' }
        ],
        [
          { text: '⚙️ Configurações', callback_data: 'settings_menu' },
          { text: '📈 Relatórios', callback_data: 'reports_menu' }
        ]
      ]
    };

    await this.bot.sendMessage(this.adminChatId, text, {
      parse_mode: 'Markdown',
      reply_markup: keyboard
    });
  }

  // Handler principal para callbacks
  async handleCallback(action, messageId, chatId) {
    try {
      switch (action) {
        case 'dashboard':
          await this.showDashboard(messageId, chatId);
          break;
        case 'users_menu':
          await this.showUsersMenu(messageId, chatId);
          break;
        case 'pending_tests':
          await this.showPendingTests(messageId, chatId);
          break;
        case 'pending_plans':
          await this.showPendingPlans(messageId, chatId);
          break;
        case 'pending_renewals':
          await this.showPendingRenewals(messageId, chatId);
          break;
        case 'support_menu':
          await this.showSupportMenu(messageId, chatId);
          break;
        case 'settings_menu':
          await this.showSettingsMenu(messageId, chatId);
          break;
        case 'reports_menu':
          await this.showReportsMenu(messageId, chatId);
          break;
        case 'back_main':
          await this.editToMainMenu(messageId, chatId);
          break;
        case 'refresh':
          await this.showDashboard(messageId, chatId); // Sempre volta ao dashboard no refresh
          break;
        // Handlers específicos para aprovações
        default:
          if (action.startsWith('approve_test_')) {
            await this.handleTestApproval(action, messageId, chatId);
          } else if (action.startsWith('reject_test_')) {
            await this.handleTestRejection(action, messageId, chatId);
          } else if (action.startsWith('approve_plan_')) {
            await this.handlePlanApproval(action, messageId, chatId);
          } else if (action.startsWith('reject_plan_')) {
            await this.handlePlanRejection(action, messageId, chatId);
          } else if (action.startsWith('approve_renewal_')) {
            await this.handleRenewalApproval(action, messageId, chatId);
          } else if (action.startsWith('reject_renewal_')) {
            await this.handleRenewalRejection(action, messageId, chatId);
          }
          break;
      }
    } catch (error) {
      console.error('Erro no handleCallback:', error);
      await this.bot.sendMessage(chatId, `❌ Erro ao processar comando: ${error.message}`);
    }
  }

  // Dashboard
  async showDashboard(messageId, chatId) {
    try {
      const totalUsers = await database.get('SELECT COUNT(*) as count FROM users');
      const pendingTests = await database.get('SELECT COUNT(*) as count FROM free_tests WHERE status = "pending"');
      const pendingPlans = await database.get('SELECT COUNT(*) as count FROM subscriptions WHERE status = "pending"');
      const pendingRenewals = await database.get('SELECT COUNT(*) as count FROM renewals WHERE status = "pending"');
      const activeTests = await database.get('SELECT COUNT(*) as count FROM free_tests WHERE status = "active" AND expires_at > datetime("now")');
      const activeSubscriptions = await database.get('SELECT COUNT(*) as count FROM subscriptions WHERE status = "active" AND expires_at > datetime("now")');
      const todayUsers = await database.get('SELECT COUNT(*) as count FROM users WHERE DATE(created_at) = DATE("now")');
      const openSupport = await database.get('SELECT COUNT(*) as count FROM support_requests WHERE status = "open"');

      const text = `📊 *Dashboard - IPTV Bot Pro*

👥 *Usuários:*
├ Total: ${totalUsers?.count || 0}
├ Novos hoje: ${todayUsers?.count || 0}
└ Suporte aberto: ${openSupport?.count || 0}

🎯 *Testes:*
├ Pendentes: *${pendingTests?.count || 0}*
└ Ativos: ${activeTests?.count || 0}

💎 *Planos:*
├ Pendentes: *${pendingPlans?.count || 0}*
└ Ativos: ${activeSubscriptions?.count || 0}

🔄 *Renovações:*
└ Pendentes: *${pendingRenewals?.count || 0}*

⏰ *Última atualização:* ${moment().format('DD/MM/YYYY HH:mm')}

${(pendingTests?.count > 0 || pendingPlans?.count > 0 || pendingRenewals?.count > 0) ? '🚨 *Atenção:* Existem solicitações pendentes!' : '✅ *Tudo em dia!*'}`;

      const keyboard = {
        inline_keyboard: [
          [
            { text: '🔄 Atualizar', callback_data: 'refresh' },
            { text: '🏠 Menu Principal', callback_data: 'back_main' }
          ]
        ]
      };

      await this.bot.editMessageText(text, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: keyboard
      });
    } catch (error) {
      console.error('Erro no dashboard:', error);
      await this.bot.sendMessage(chatId, `❌ Erro ao carregar dashboard: ${error.message}`);
    }
  }

  // Menu de usuários
  async showUsersMenu(messageId, chatId) {
    try {
      const recentUsers = await database.all(`
        SELECT phone, name, city, created_at, last_interaction
        FROM users 
        ORDER BY created_at DESC 
        LIMIT 10
      `);

      const totalUsers = await database.get('SELECT COUNT(*) as count FROM users');
      const todayUsers = await database.get('SELECT COUNT(*) as count FROM users WHERE DATE(created_at) = DATE("now")');
      const weekUsers = await database.get('SELECT COUNT(*) as count FROM users WHERE created_at >= datetime("now", "-7 days")');

      let text = `👥 *GERENCIAMENTO DE USUÁRIOS*

📊 *ESTATÍSTICAS:*
├ Total de usuários: ${totalUsers?.count || 0}
├ Novos hoje: ${todayUsers?.count || 0}
└ Novos esta semana: ${weekUsers?.count || 0}

👤 *USUÁRIOS RECENTES:*\n`;

      if (!recentUsers || recentUsers.length === 0) {
        text += '\n📭 Nenhum usuário cadastrado ainda.';
      } else {
        recentUsers.forEach((user, index) => {
          const date = moment(user.created_at).format('DD/MM HH:mm');
          const lastSeen = user.last_interaction ? moment(user.last_interaction).format('DD/MM HH:mm') : 'N/A';
          text += `\n${index + 1}. 📱 ${user.phone}`;
          if (user.name) text += `\n   👤 ${user.name}`;
          if (user.city) text += `\n   🏙️ ${user.city}`;
          text += `\n   📅 Cadastro: ${date}`;
          text += `\n   ⏰ Última atividade: ${lastSeen}\n`;
        });
      }

      const keyboard = {
        inline_keyboard: [
          [
            { text: '🔍 Buscar Usuário', callback_data: 'search_user' },
            { text: '📊 Estatísticas', callback_data: 'user_stats' }
          ],
          [
            { text: '🔄 Atualizar', callback_data: 'refresh' },
            { text: '🏠 Menu Principal', callback_data: 'back_main' }
          ]
        ]
      };

      await this.bot.editMessageText(text, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: keyboard
      });
    } catch (error) {
      console.error('Erro no menu usuários:', error);
      await this.bot.sendMessage(chatId, `❌ Erro ao carregar usuários: ${error.message}`);
    }
  }

  // Testes pendentes
  async showPendingTests(messageId, chatId) {
    try {
      const tests = await database.all(`
        SELECT ft.*, u.phone, u.name, u.city, u.device
        FROM free_tests ft
        JOIN users u ON ft.user_id = u.id
        WHERE ft.status = 'pending'
        ORDER BY ft.created_at ASC
        LIMIT 5
      `);

      let text = `🎯 *Testes Grátis Pendentes*\n\n`;
      let keyboard = { inline_keyboard: [] };

      if (!tests || tests.length === 0) {
        text += `✅ Nenhum teste pendente!`;
        keyboard.inline_keyboard.push([
          { text: '🔄 Atualizar', callback_data: 'refresh' },
          { text: '🏠 Menu Principal', callback_data: 'back_main' }
        ]);
      } else {
        tests.forEach((test, index) => {
          const date = moment(test.created_at).format('DD/MM HH:mm');
          text += `${index + 1}. 📱 *${test.phone}*\n`;
          text += `   👤 ${test.name || 'N/A'}\n`;
          text += `   🏙️ ${test.city || 'N/A'} | 📺 ${test.device || 'N/A'}\n`;
          text += `   📅 ${date}\n\n`;

          // Botões de aprovação/rejeição para cada teste
          keyboard.inline_keyboard.push([
            { text: `✅ Aprovar ${index + 1}`, callback_data: `approve_test_${test.id}` },
            { text: `❌ Rejeitar ${index + 1}`, callback_data: `reject_test_${test.id}` }
          ]);
        });

        keyboard.inline_keyboard.push([
          { text: '🔄 Atualizar', callback_data: 'refresh' },
          { text: '🏠 Menu Principal', callback_data: 'back_main' }
        ]);
      }

      await this.bot.editMessageText(text, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: keyboard
      });
    } catch (error) {
      console.error('Erro nos testes pendentes:', error);
      await this.bot.sendMessage(chatId, `❌ Erro ao carregar testes: ${error.message}`);
    }
  }

  // Planos pendentes
  async showPendingPlans(messageId, chatId) {
    try {
      const plans = await database.all(`
        SELECT s.*, u.phone, u.name, pp.proof_data
        FROM subscriptions s
        JOIN users u ON s.user_id = u.id
        LEFT JOIN payment_proofs pp ON pp.request_id = s.id AND pp.request_type = 'subscription'
        WHERE s.status = 'pending'
        ORDER BY s.created_at ASC
        LIMIT 5
      `);

      let text = `💎 *Planos Pendentes*\n\n`;
      let keyboard = { inline_keyboard: [] };

      if (!plans || plans.length === 0) {
        text += `✅ Nenhum plano pendente!`;
        keyboard.inline_keyboard.push([
          { text: '🔄 Atualizar', callback_data: 'refresh' },
          { text: '🏠 Menu Principal', callback_data: 'back_main' }
        ]);
      } else {
        plans.forEach((plan, index) => {
          const date = moment(plan.created_at).format('DD/MM HH:mm');
          text += `${index + 1}. 📱 *${plan.phone}*\n`;
          text += `   👤 ${plan.name || 'N/A'}\n`;
          text += `   📦 ${plan.plan} - R$ ${plan.price}\n`;
          text += `   📅 ${date}\n`;
          if (plan.proof_data) {
            text += `   💳 Comprovante enviado\n`;
          }
          text += `\n`;

          keyboard.inline_keyboard.push([
            { text: `✅ Aprovar ${index + 1}`, callback_data: `approve_plan_${plan.id}` },
            { text: `❌ Rejeitar ${index + 1}`, callback_data: `reject_plan_${plan.id}` }
          ]);
        });

        keyboard.inline_keyboard.push([
          { text: '🔄 Atualizar', callback_data: 'refresh' },
          { text: '🏠 Menu Principal', callback_data: 'back_main' }
        ]);
      }

      await this.bot.editMessageText(text, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: keyboard
      });
    } catch (error) {
      console.error('Erro nos planos pendentes:', error);
      await this.bot.sendMessage(chatId, `❌ Erro ao carregar planos: ${error.message}`);
    }
  }

  // Renovações pendentes
  async showPendingRenewals(messageId, chatId) {
    try {
      const renewals = await database.all(`
        SELECT r.*, u.phone, u.name
        FROM renewals r
        JOIN users u ON r.user_id = u.id
        WHERE r.status = 'pending'
        ORDER BY r.created_at ASC
        LIMIT 5
      `);

      let text = `🔄 *Renovações Pendentes*\n\n`;
      let keyboard = { inline_keyboard: [] };

      if (!renewals || renewals.length === 0) {
        text += `✅ Nenhuma renovação pendente!`;
        keyboard.inline_keyboard.push([
          { text: '🔄 Atualizar', callback_data: 'refresh' },
          { text: '🏠 Menu Principal', callback_data: 'back_main' }
        ]);
      } else {
        renewals.forEach((renewal, index) => {
          const date = moment(renewal.created_at).format('DD/MM HH:mm');
          text += `${index + 1}. 📱 *${renewal.phone}*\n`;
          text += `   👤 ${renewal.name || 'N/A'}\n`;
          text += `   👤 Login: ${renewal.current_login}\n`;
          text += `   📦 ${renewal.plan} - R$ ${renewal.price}\n`;
          text += `   📅 ${date}\n`;
          if (renewal.payment_proof) {
            text += `   💳 Comprovante enviado\n`;
          }
          text += `\n`;

          keyboard.inline_keyboard.push([
            { text: `✅ Aprovar ${index + 1}`, callback_data: `approve_renewal_${renewal.id}` },
            { text: `❌ Rejeitar ${index + 1}`, callback_data: `reject_renewal_${renewal.id}` }
          ]);
        });

        keyboard.inline_keyboard.push([
          { text: '🔄 Atualizar', callback_data: 'refresh' },
          { text: '🏠 Menu Principal', callback_data: 'back_main' }
        ]);
      }

      await this.bot.editMessageText(text, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: keyboard
      });
    } catch (error) {
      console.error('Erro nas renovações pendentes:', error);
      await this.bot.sendMessage(chatId, `❌ Erro ao carregar renovações: ${error.message}`);
    }
  }

  // Menu de suporte
  async showSupportMenu(messageId, chatId) {
    try {
      const openTickets = await database.all(`
        SELECT sr.*, u.phone, u.name
        FROM support_requests sr
        JOIN users u ON sr.user_id = u.id
        WHERE sr.status = 'open'
        ORDER BY sr.created_at ASC
        LIMIT 5
      `);

      let text = `🛠️ *SUPORTE TÉCNICO*

📊 *Chamados abertos:* ${openTickets?.length || 0}

`;

      if (!openTickets || openTickets.length === 0) {
        text += '✅ *Nenhum chamado de suporte aberto!*';
      } else {
        text += '🎫 *CHAMADOS RECENTES:*\n';
        openTickets.forEach((ticket, index) => {
          const date = moment(ticket.created_at).format('DD/MM HH:mm');
          text += `\n${index + 1}. 📱 ${ticket.phone}`;
          if (ticket.name) text += ` (${ticket.name})`;
          text += `\n   ❓ ${(ticket.problem_description || '').substring(0, 80)}${(ticket.problem_description || '').length > 80 ? '...' : ''}`;
          text += `\n   📅 ${date}\n`;
        });
      }

      const keyboard = {
        inline_keyboard: [
          [
            { text: '📋 Ver Todos Chamados', callback_data: 'all_support' },
            { text: '🔄 Atualizar', callback_data: 'refresh' }
          ],
          [
            { text: '🏠 Menu Principal', callback_data: 'back_main' }
          ]
        ]
      };

      await this.bot.editMessageText(text, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: keyboard
      });
    } catch (error) {
      console.error('Erro no menu suporte:', error);
      await this.bot.sendMessage(chatId, `❌ Erro ao carregar suporte: ${error.message}`);
    }
  }

  // Menu de relatórios
  async showReportsMenu(messageId, chatId) {
    const keyboard = {
      inline_keyboard: [
        [
          { text: '📊 Relatório Diário', callback_data: 'daily_report' },
          { text: '📈 Relatório Semanal', callback_data: 'weekly_report' }
        ],
        [
          { text: '💰 Vendas do Mês', callback_data: 'monthly_sales' },
          { text: '👥 Usuários Ativos', callback_data: 'active_users' }
        ],
        [
          { text: '🏠 Menu Principal', callback_data: 'back_main' }
        ]
      ]
    };

    await this.bot.editMessageText('📈 *RELATÓRIOS E ESTATÍSTICAS*\n\nSelecione o tipo de relatório:', {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: keyboard
    });
  }

  // Menu de configurações
  async showSettingsMenu(messageId, chatId) {
    const keyboard = {
      inline_keyboard: [
        [
          { text: '💳 Alterar PIX', callback_data: 'change_pix' },
          { text: '💰 Alterar Preços', callback_data: 'change_prices' }
        ],
        [
          { text: '🌐 Alterar Servidor', callback_data: 'change_server' },
          { text: '⏰ Ver Config Completa', callback_data: 'view_settings' }
        ],
        [
          { text: '🏠 Menu Principal', callback_data: 'back_main' }
        ]
      ]
    };

    await this.bot.editMessageText('⚙️ *Configurações do Sistema*', {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: keyboard
    });
  }

  // Aprovação de teste
  async handleTestApproval(action, messageId, chatId) {
    const testId = action.replace('approve_test_', '');
    
    // Solicitar login e senha via prompt
    await this.bot.sendMessage(chatId, `🎯 *Aprovar Teste ID: ${testId}*\n\nEnvie o comando no formato:\n\n\`/settest ${testId} LOGIN SENHA\`\n\nExemplo: \`/settest ${testId} teste123 abc456\``, {
      parse_mode: 'Markdown'
    });
  }

  // Aprovação de plano
  async handlePlanApproval(action, messageId, chatId) {
    const planId = action.replace('approve_plan_', '');
    
    await this.bot.sendMessage(chatId, `💎 *Aprovar Plano ID: ${planId}*\n\nEnvie o comando no formato:\n\n\`/setplan ${planId} LOGIN SENHA\`\n\nExemplo: \`/setplan ${planId} user123 pass456\``, {
      parse_mode: 'Markdown'
    });
  }

  // Comando para definir credenciais do teste - CORRIGIDO
  async setTestCredentials(msg, testId, login, senha) {
    try {
      // Pegar dados do teste
      const test = await database.get(`
        SELECT ft.*, u.phone, u.name
        FROM free_tests ft
        JOIN users u ON ft.user_id = u.id
        WHERE ft.id = ? AND ft.status = 'pending'
      `, [testId]);

      if (!test) {
        await this.bot.sendMessage(msg.chat.id, `❌ Teste ID ${testId} não encontrado ou já processado.`);
        return;
      }

      // Definir data de expiração
      const settings = await this.getSettings();
      const hours = parseInt(settings.test_duration_hours || 6);
      const expiresAt = moment().add(hours, 'hours').format('YYYY-MM-DD HH:mm:ss');

      // Atualizar teste no banco
      await database.run(`
        UPDATE free_tests 
        SET test_login = ?, test_password = ?, expires_at = ?, status = 'active', approved_at = CURRENT_TIMESTAMP 
        WHERE id = ?
      `, [login, senha, expiresAt, testId]);

      // Importar botHandler para notificar usuário
      try {
        const botHandler = await getBotHandler();
        if (botHandler && typeof botHandler.notifyTestApproved === 'function') {
          await botHandler.notifyTestApproved(test.phone, login, senha, expiresAt);
        }
      } catch (error) {
        console.log('⚠️ Aviso: Não foi possível notificar o usuário automaticamente:', error.message);
      }

      await this.bot.sendMessage(msg.chat.id, `✅ *Teste aprovado com sucesso!*\n\n👤 Usuário: ${test.phone}\n🔐 Login: ${login}\n🔐 Senha: ${senha}\n⏰ Expira: ${moment(expiresAt).format('DD/MM/YYYY HH:mm')}\n\n📱 Usuário foi notificado automaticamente!`, {
        parse_mode: 'Markdown'
      });

    } catch (error) {
      console.error('Erro ao aprovar teste:', error);
      await this.bot.sendMessage(msg.chat.id, `❌ Erro ao aprovar teste: ${error.message}`);
    }
  }

  // Comando para definir credenciais do plano - CORRIGIDO
  async setPlanCredentials(msg, planId, login, senha) {
    try {
      const plan = await database.get(`
        SELECT s.*, u.phone, u.name
        FROM subscriptions s
        JOIN users u ON s.user_id = u.id
        WHERE s.id = ? AND s.status = 'pending'
      `, [planId]);

      if (!plan) {
        await this.bot.sendMessage(msg.chat.id, `❌ Plano ID ${planId} não encontrado ou já processado.`);
        return;
      }

      // Calcular data de expiração
      let months = 1;
      const planName = (plan.plan || '').toLowerCase();
      switch(planName) {
        case 'trimestral': months = 3; break;
        case 'semestral': months = 6; break;
        case 'anual': months = 12; break;
        default: months = 1; break;
      }
      
      const expiresAt = moment().add(months, 'months').format('YYYY-MM-DD HH:mm:ss');

      // Atualizar plano
      await database.run(`
        UPDATE subscriptions 
        SET login = ?, password = ?, expires_at = ?, status = 'active', approved_at = CURRENT_TIMESTAMP 
        WHERE id = ?
      `, [login, senha, expiresAt, planId]);

      // Notificar usuário
      try {
        const botHandler = await getBotHandler();
        if (botHandler && typeof botHandler.notifyPlanApproved === 'function') {
          await botHandler.notifyPlanApproved(plan.phone, login, senha, plan.plan, expiresAt);
        }
      } catch (error) {
        console.log('⚠️ Aviso: Não foi possível notificar o usuário automaticamente:', error.message);
      }

      await this.bot.sendMessage(msg.chat.id, `✅ *Plano aprovado com sucesso!*\n\n👤 Usuário: ${plan.phone}\n📦 Plano: ${plan.plan}\n🔐 Login: ${login}\n🔐 Senha: ${senha}\n⏰ Expira: ${moment(expiresAt).format('DD/MM/YYYY HH:mm')}\n\n📱 Usuário foi notificado automaticamente!`, {
        parse_mode: 'Markdown'
      });

    } catch (error) {
      console.error('Erro ao aprovar plano:', error);
      await this.bot.sendMessage(msg.chat.id, `❌ Erro ao aprovar plano: ${error.message}`);
    }
  }

  // Aprovação de renovação
  async handleRenewalApproval(action, messageId, chatId) {
    const renewalId = action.replace('approve_renewal_', '');
    
    try {
      const renewal = await database.get(`
        SELECT r.*, u.phone, u.name
        FROM renewals r
        JOIN users u ON r.user_id = u.id
        WHERE r.id = ? AND r.status = 'pending'
      `, [renewalId]);

      if (!renewal) {
        await this.bot.sendMessage(chatId, `❌ Renovação ID ${renewalId} não encontrada ou já processada.`);
        return;
      }

      // Calcular nova data de expiração
      let months = 1;
      const planName = (renewal.plan || '').toLowerCase();
      switch(planName) {
        case 'trimestral': months = 3; break;
        case 'semestral': months = 6; break;
        case 'anual': months = 12; break;
        default: months = 1; break;
      }
      
      const expiresAt = moment().add(months, 'months').format('YYYY-MM-DD HH:mm:ss');

      // Atualizar renovação
      await database.run(`
        UPDATE renewals 
        SET expires_at = ?, status = 'approved', approved_at = CURRENT_TIMESTAMP 
        WHERE id = ?
      `, [expiresAt, renewalId]);

      // Notificar usuário
      try {
        const botHandler = await getBotHandler();
        if (botHandler && typeof botHandler.notifyRenewalApproved === 'function') {
          await botHandler.notifyRenewalApproved(renewal.phone, renewal.current_login, renewal.plan, expiresAt);
        }
      } catch (error) {
        console.log('⚠️ Aviso: Não foi possível notificar o usuário automaticamente:', error.message);
      }

      await this.bot.sendMessage(chatId, `✅ *Renovação aprovada com sucesso!*\n\n👤 Usuário: ${renewal.phone}\n👤 Login: ${renewal.current_login}\n📦 Plano: ${renewal.plan}\n⏰ Nova expiração: ${moment(expiresAt).format('DD/MM/YYYY HH:mm')}\n\n📱 Usuário foi notificado automaticamente!`, {
        parse_mode: 'Markdown'
      });

    } catch (error) {
      console.error('Erro ao aprovar renovação:', error);
      await this.bot.sendMessage(chatId, `❌ Erro ao aprovar renovação: ${error.message}`);
    }
  }

  // Handlers para rejeições
  async handleTestRejection(action, messageId, chatId) {
    const testId = action.replace('reject_test_', '');
    
    try {
      const test = await database.get(`
        SELECT ft.*, u.phone, u.name
        FROM free_tests ft
        JOIN users u ON ft.user_id = u.id
        WHERE ft.id = ? AND ft.status = 'pending'
      `, [testId]);

      if (!test) {
        await this.bot.sendMessage(chatId, `❌ Teste ID ${testId} não encontrado ou já processado.`);
        return;
      }

      // Atualizar status para rejeitado
      await database.run('UPDATE free_tests SET status = "rejected" WHERE id = ?', [testId]);

      // Notificar usuário
      try {
        const botHandler = await getBotHandler();
        if (botHandler && typeof botHandler.sendMessage === 'function') {
          await botHandler.sendMessage(test.phone, '❌ *TESTE RECUSADO*\n\nSua solicitação de teste foi recusada. Entre em contato com o suporte para mais informações.\n\n🏠 Digite *MENU* para outras opções.');
        }
      } catch (error) {
        console.log('⚠️ Aviso: Não foi possível notificar o usuário automaticamente:', error.message);
      }

      await this.bot.sendMessage(chatId, `❌ *Teste rejeitado!*\n\n👤 Usuário: ${test.phone}\n📅 ${moment().format('DD/MM/YYYY HH:mm')}\n\n📱 Usuário foi notificado.`, {
        parse_mode: 'Markdown'
      });

    } catch (error) {
      console.error('Erro ao rejeitar teste:', error);
      await this.bot.sendMessage(chatId, `❌ Erro ao rejeitar teste: ${error.message}`);
    }
  }

  async handlePlanRejection(action, messageId, chatId) {
    const planId = action.replace('reject_plan_', '');
    
    try {
      const plan = await database.get(`
        SELECT s.*, u.phone, u.name
        FROM subscriptions s
        JOIN users u ON s.user_id = u.id
        WHERE s.id = ? AND s.status = 'pending'
      `, [planId]);

      if (!plan) {
        await this.bot.sendMessage(chatId, `❌ Plano ID ${planId} não encontrado ou já processado.`);
        return;
      }

      // Atualizar status para rejeitado
      await database.run('UPDATE subscriptions SET status = "rejected" WHERE id = ?', [planId]);

      // Notificar usuário
      try {
        const botHandler = await getBotHandler();
        if (botHandler && typeof botHandler.sendMessage === 'function') {
          await botHandler.sendMessage(plan.phone, '❌ *PLANO RECUSADO*\n\nSeu pagamento foi recusado. Verifique os dados e tente novamente ou entre em contato com o suporte.\n\n🏠 Digite *MENU* para outras opções.');
        }
      } catch (error) {
        console.log('⚠️ Aviso: Não foi possível notificar o usuário automaticamente:', error.message);
      }

      await this.bot.sendMessage(chatId, `❌ *Plano rejeitado!*\n\n👤 Usuário: ${plan.phone}\n📦 Plano: ${plan.plan}\n📅 ${moment().format('DD/MM/YYYY HH:mm')}\n\n📱 Usuário foi notificado.`, {
        parse_mode: 'Markdown'
      });

    } catch (error) {
      console.error('Erro ao rejeitar plano:', error);
      await this.bot.sendMessage(chatId, `❌ Erro ao rejeitar plano: ${error.message}`);
    }
  }

  async handleRenewalRejection(action, messageId, chatId) {
    const renewalId = action.replace('reject_renewal_', '');
    
    try {
      const renewal = await database.get(`
        SELECT r.*, u.phone, u.name
        FROM renewals r
        JOIN users u ON r.user_id = u.id
        WHERE r.id = ? AND r.status = 'pending'
      `, [renewalId]);

      if (!renewal) {
        await this.bot.sendMessage(chatId, `❌ Renovação ID ${renewalId} não encontrada ou já processada.`);
        return;
      }

      // Atualizar status para rejeitado
      await database.run('UPDATE renewals SET status = "rejected" WHERE id = ?', [renewalId]);

      // Notificar usuário
      try {
        const botHandler = await getBotHandler();
        if (botHandler && typeof botHandler.sendMessage === 'function') {
          await botHandler.sendMessage(renewal.phone, '❌ *RENOVAÇÃO RECUSADA*\n\nSeu pagamento foi recusado. Verifique os dados e tente novamente ou entre em contato com o suporte.\n\n🏠 Digite *MENU* para outras opções.');
        }
      } catch (error) {
        console.log('⚠️ Aviso: Não foi possível notificar o usuário automaticamente:', error.message);
      }

      await this.bot.sendMessage(chatId, `❌ *Renovação rejeitada!*\n\n👤 Usuário: ${renewal.phone}\n👤 Login: ${renewal.current_login}\n📅 ${moment().format('DD/MM/YYYY HH:mm')}\n\n📱 Usuário foi notificado.`, {
        parse_mode: 'Markdown'
      });

    } catch (error) {
      console.error('Erro ao rejeitar renovação:', error);
      await this.bot.sendMessage(chatId, `❌ Erro ao rejeitar renovação: ${error.message}`);
    }
  }

  // Voltar ao menu principal
  async editToMainMenu(messageId, chatId) {
    await this.bot.editMessageText('🎛️ *IPTV Bot Admin Pro*', {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '📊 Dashboard', callback_data: 'dashboard' },
            { text: '👥 Usuários', callback_data: 'users_menu' }
          ],
          [
            { text: '🎯 Testes Pendentes', callback_data: 'pending_tests' },
            { text: '💎 Planos Pendentes', callback_data: 'pending_plans' }
          ],
          [
            { text: '🔄 Renovações Pendentes', callback_data: 'pending_renewals' },
            { text: '🛠️ Suporte', callback_data: 'support_menu' }
          ],
          [
            { text: '⚙️ Configurações', callback_data: 'settings_menu' },
            { text: '📈 Relatórios', callback_data: 'reports_menu' }
          ]
        ]
      }
    });
  }

  // Métodos auxiliares
  async getSettings() {
    try {
      const settings = await database.all('SELECT key_name, key_value FROM settings');
      const result = {};
      settings.forEach(setting => {
        result[setting.key_name] = setting.key_value;
      });
      return result;
    } catch (error) {
      console.error('Erro ao buscar configurações:', error);
      return {};
    }
  }

  // Notificações para novas solicitações
  async notifyTestRequest(phone, name, city, device, testId) {
    if (!this.isInitialized) return;
    
    const keyboard = {
      inline_keyboard: [
        [
          { text: '✅ Aprovar Teste', callback_data: `approve_test_${testId}` },
          { text: '❌ Rejeitar', callback_data: `reject_test_${testId}` }
        ],
        [
          { text: '📊 Ver Dashboard', callback_data: 'dashboard' }
        ]
      ]
    };

    const message = `🎯 *Novo Teste Solicitado*

📱 *Telefone:* ${phone}
👤 *Nome:* ${name}
🏙️ *Cidade:* ${city}
📺 *Dispositivo:* ${device}
⏰ *Solicitado:* ${moment().format('DD/MM/YYYY HH:mm')}

ID do Teste: \`${testId}\``;

    try {
      await this.bot.sendMessage(this.adminChatId, message, {
        parse_mode: 'Markdown',
        reply_markup: keyboard
      });
    } catch (error) {
      console.error('Erro ao notificar teste:', error);
    }
  }

  async notifyPlanPayment(phone, plan, price, proof, planId) {
  async notifyPlanPayment(phone, plan, price, proof, planId, mediaData = null) {
    if (!this.isInitialized) return;
    
    const keyboard = {
      inline_keyboard: [
        [
          { text: '✅ Aprovar Plano', callback_data: `approve_plan_${planId}` },
          { text: '❌ Rejeitar', callback_data: `reject_plan_${planId}` }
        ],
        [
          { text: '📊 Ver Dashboard', callback_data: 'dashboard' }
        ]
      ]
    };

    let message = `💎 *Novo Plano com Pagamento*

📱 *Telefone:* ${phone}
📦 *Plano:* ${plan}
💰 *Valor:* R$ ${price}
⏰ *Solicitado:* ${moment().format('DD/MM/YYYY HH:mm')}

ID do Plano: \`${planId}\``;

    try {
      // Se há mídia, enviar o arquivo junto
      if (mediaData) {
        await this.sendMediaToAdmin(mediaData, message, keyboard);
      } else {
        message += `\n💳 *Comprovante:* ${proof ? proof.substring(0, 100) + '...' : 'Texto enviado'}`;
        await this.bot.sendMessage(this.adminChatId, message, {
          parse_mode: 'Markdown',
          reply_markup: keyboard
        });
      }
    } catch (error) {
      console.error('Erro ao notificar plano:', error);
    }
  }

  async notifyRenewalPayment(phone, login, plan, price, proof, renewalId, mediaData = null) {
    if (!this.isInitialized) return;
    
    const keyboard = {
      inline_keyboard: [
        [
          { text: '✅ Aprovar Renovação', callback_data: `approve_renewal_${renewalId}` },
          { text: '❌ Rejeitar', callback_data: `reject_renewal_${renewalId}` }
        ],
        [
          { text: '📊 Ver Dashboard', callback_data: 'dashboard' }
        ]
      ]
    };

    let message = `🔄 *Nova Renovação com Pagamento*

📱 *Telefone:* ${phone}
👤 *Login Atual:* ${login}
📦 *Plano:* ${plan}
💰 *Valor:* R$ ${price}
⏰ *Solicitado:* ${moment().format('DD/MM/YYYY HH:mm')}

ID da Renovação: \`${renewalId}\``;

    try {
      // Se há mídia, enviar o arquivo junto
      if (mediaData) {
        await this.sendMediaToAdmin(mediaData, message, keyboard);
      } else {
        message += `\n💳 *Comprovante:* ${proof ? proof.substring(0, 100) + '...' : 'Texto enviado'}`;
        await this.bot.sendMessage(this.adminChatId, message, {
          parse_mode: 'Markdown',
          reply_markup: keyboard
        });
      }
    } catch (error) {
      console.error('Erro ao notificar renovação:', error);
    }
  }

  // Outros métodos de notificação
  async notifyNewUser(phone, name) {
    if (!this.isInitialized) return;
    const message = `👤 *Novo Usuário*\n\n📱 Telefone: ${phone}\n👤 Nome: ${name}\n⏰ ${moment().format('DD/MM/YYYY HH:mm')}`;
    await this.sendToAdmin(message, { parse_mode: 'Markdown' });
  }

  async notifySupportRequest(phone, problem) {
    if (!this.isInitialized) return;
    const message = `🛠️ *Suporte Solicitado*\n\n📱 Telefone: ${phone}\n❓ Problema: ${problem}\n⏰ ${moment().format('DD/MM/YYYY HH:mm')}`;
    await this.sendToAdmin(message, { parse_mode: 'Markdown' });
  }

  async notifyHumanRequest(phone, message) {
    if (!this.isInitialized) return;
    const msg = `👥 *Atendente Solicitado*\n\n📱 Telefone: ${phone}\n💬 Mensagem: ${message}\n⏰ ${moment().format('DD/MM/YYYY HH:mm')}`;
    await this.sendToAdmin(msg, { parse_mode: 'Markdown' });
  }

  async sendToAdmin(message, options = {}) {
    if (!this.isInitialized || !this.adminChatId) return;
    
    try {
      await this.bot.sendMessage(this.adminChatId, message, options);
    } catch (error) {
      console.error('❌ Erro ao enviar para admin:', error.message);
    }
  }

  /**
   * Envia mídia para o admin no Telegram
   */
  async sendMediaToAdmin(mediaData, caption, keyboard = null) {
    if (!this.isInitialized || !this.adminChatId || !mediaData) return;
    
    try {
      console.log(`📤 Enviando mídia para admin: ${mediaData.fileName}`);
      
      const options = {
        caption: caption,
        parse_mode: 'Markdown'
      };
      
      if (keyboard) {
        options.reply_markup = keyboard;
      }

      // Se é um arquivo grande (link), enviar como mensagem de texto
      if (mediaData.type === 'file_link') {
        const linkMessage = `${caption}\n\n📎 *Comprovante (arquivo grande):*\n🔗 ${mediaData.downloadUrl}\n📁 Arquivo: ${mediaData.fileName}\n📊 Tamanho: ${(mediaData.size / 1024 / 1024).toFixed(2)}MB`;
        
        await this.bot.sendMessage(this.adminChatId, linkMessage, {
          parse_mode: 'Markdown',
          reply_markup: keyboard
        });
        return;
      }

      // Se é buffer, enviar diretamente
      if (mediaData.type === 'buffer' && mediaData.buffer) {
        const mimeType = mediaData.mimeType || '';
        
        if (mimeType.startsWith('image/')) {
          await this.bot.sendPhoto(this.adminChatId, mediaData.buffer, options);
        } else if (mimeType.startsWith('video/')) {
          await this.bot.sendVideo(this.adminChatId, mediaData.buffer, options);
        } else if (mimeType.startsWith('audio/')) {
          await this.bot.sendAudio(this.adminChatId, mediaData.buffer, options);
        } else {
          // Documento genérico
          await this.bot.sendDocument(this.adminChatId, mediaData.buffer, options, {
            filename: mediaData.fileName
          });
        }
        
        console.log(`✅ Mídia enviada com sucesso para admin: ${mediaData.fileName}`);
      }
      
    } catch (error) {
      console.error('❌ Erro ao enviar mídia para admin:', error);
      
      // Fallback: enviar apenas a mensagem de texto
      try {
        const fallbackMessage = `${caption}\n\n❌ *Erro ao enviar comprovante*\nArquivo: ${mediaData.fileName}\nTipo: ${mediaData.mimeType}\nTamanho: ${mediaData.size ? (mediaData.size / 1024).toFixed(2) + 'KB' : 'N/A'}`;
        
        await this.bot.sendMessage(this.adminChatId, fallbackMessage, {
          parse_mode: 'Markdown',
          reply_markup: keyboard
        });
      } catch (fallbackError) {
        console.error('❌ Erro no fallback:', fallbackError);
      }
    }
  }

  /**
   * Envia informações de debug do sistema
   */
  async sendDebugInfo(chatId) {
    try {
      const totalUsers = await database.get('SELECT COUNT(*) as count FROM users');
      const pendingTests = await database.get('SELECT COUNT(*) as count FROM free_tests WHERE status = "pending"');
      const pendingPlans = await database.get('SELECT COUNT(*) as count FROM subscriptions WHERE status = "pending"');
      const pendingRenewals = await database.get('SELECT COUNT(*) as count FROM renewals WHERE status = "pending"');
      
      const debugInfo = `🔧 *INFORMAÇÕES DE DEBUG*

🌐 *Configurações:*
├ Evolution API: ${process.env.EVOLUTION_API_URL || 'Não configurado'}
├ Instância: ${process.env.INSTANCE_NAME || 'default'}
├ Telegram Bot: ${this.isInitialized ? 'Ativo' : 'Inativo'}
└ Admin ID: ${this.adminChatId || 'Não configurado'}

📊 *Estatísticas:*
├ Total usuários: ${totalUsers?.count || 0}
├ Testes pendentes: ${pendingTests?.count || 0}
├ Planos pendentes: ${pendingPlans?.count || 0}
└ Renovações pendentes: ${pendingRenewals?.count || 0}

📱 *Apps Configurados:*
├ Android: ${process.env.APP_ANDROID || 'Não configurado'}
├ iOS: ${process.env.APP_IOS || 'Não configurado'}
├ Smart TV: ${process.env.APP_TV || 'Não configurado'}
├ FireStick: ${process.env.APP_FIRESTICK || 'Não configurado'}
└ Windows: ${process.env.APP_WINDOWS || 'Não configurado'}

💾 *Sistema:*
├ Diretório temp: ${process.env.TEMP_FILES_DIR || './temp'}
├ Tamanho máximo: ${process.env.MAX_FILE_SIZE_MB || '20'}MB
└ Limpeza: ${process.env.CLEANUP_INTERVAL_HOURS || '24'}h

⏰ *Timestamp:* ${moment().format('DD/MM/YYYY HH:mm:ss')}`;

      await this.bot.sendMessage(chatId, debugInfo, { parse_mode: 'Markdown' });
    } catch (error) {
      console.error('Erro ao enviar debug info:', error);
      await this.bot.sendMessage(chatId, `❌ Erro ao obter informações de debug: ${error.message}`);
    }
  }

  /**
   * Envia logs recentes do sistema
   */
  async sendRecentLogs(chatId) {
    try {
      const recentMessages = await database.all(`
        SELECT m.*, u.phone, u.name
        FROM messages m
        JOIN users u ON m.user_id = u.id
        ORDER BY m.created_at DESC
        LIMIT 10
      `);

      let logsText = `📋 *LOGS RECENTES (10 últimas mensagens)*\n\n`;
      
      if (!recentMessages || recentMessages.length === 0) {
        logsText += '📭 Nenhuma mensagem registrada ainda.';
      } else {
        recentMessages.forEach((msg, index) => {
          const time = moment(msg.created_at).format('DD/MM HH:mm');
          const type = msg.message_type === 'received' ? '📨' : '📤';
          const content = (msg.message_content || '').substring(0, 50);
          
          logsText += `${index + 1}. ${type} ${msg.phone} (${time})\n`;
          if (msg.name) logsText += `   👤 ${msg.name}\n`;
          logsText += `   💬 ${content}${content.length >= 50 ? '...' : ''}\n\n`;
        });
      }

      logsText += `⏰ *Gerado em:* ${moment().format('DD/MM/YYYY HH:mm:ss')}`;

      await this.bot.sendMessage(chatId, logsText, { parse_mode: 'Markdown' });
    } catch (error) {
      console.error('Erro ao enviar logs:', error);
      await this.bot.sendMessage(chatId, `❌ Erro ao obter logs: ${error.message}`);
    }
  }
}

// Instância singleton
const telegramAdmin = new TelegramAdmin();

module.exports = telegramAdmin;