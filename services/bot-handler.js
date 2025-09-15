const axios = require('axios');
const database = require('../database/setup');
const telegramAdmin = require('./telegram-admin');
const moment = require('moment');

class IPTVBot {
  constructor() {
    // Configurações básicas
    this.evolutionApiUrl = process.env.EVOLUTION_API_URL || 'http://localhost:8080';
    this.evolutionApiKey = process.env.EVOLUTION_API_KEY;
    this.instanceName = process.env.INSTANCE_NAME || 'default';
    
    // Estados possíveis do usuário
    this.USER_STATES = {
      MENU_PRINCIPAL: 'menu_principal',
      TESTE_NOME: 'teste_nome', 
      TESTE_CIDADE: 'teste_cidade',
      TESTE_DISPOSITIVO: 'teste_dispositivo',
      PLANO_ESCOLHA: 'plano_escolha',
      PLANO_COMPROVANTE: 'plano_comprovante',
      RENOVACAO_LOGIN: 'renovacao_login',
      RENOVACAO_PLANO: 'renovacao_plano',
      RENOVACAO_COMPROVANTE: 'renovacao_comprovante',
      SUPORTE_PROBLEMA: 'suporte_problema',
      AGUARDANDO_ATENDENTE: 'aguardando_atendente'
    };
    
    // Cache temporário para dados do usuário durante o fluxo
    this.userTempData = new Map();
    
    console.log('🤖 IPTV Bot inicializado com fluxo avançado');
  }

  /**
   * Função principal - processa mensagens recebidas
   */
  async handleIncomingMessage(phone, message, metadata = {}) {
    try {
      console.log(`📨 Mensagem de ${phone}: ${message}`);
      
      // Buscar ou criar usuário
      let user = await this.getOrCreateUser(phone);
      
      // Log da mensagem
      await this.logMessage(user.id, phone, message, 'received');
      
      let response = '';

      // Primeira interação - enviar menu
      if (user.message_count === 0) {
        response = this.getWelcomeMessage();
        user.current_state = this.USER_STATES.MENU_PRINCIPAL;
        await telegramAdmin.notifyNewUser(phone, user.name || 'Não informado');
      } else {
        // Processar mensagem baseada no estado atual
        response = await this.processMessageByState(message, user);
      }

      // Atualizar usuário
      await this.updateUserInteraction(user.id, user.current_state);

      // Enviar resposta
      if (response) {
        await this.sendMessage(phone, response, metadata.instance);
        await this.logMessage(user.id, phone, response, 'sent');
      }

    } catch (error) {
      console.error('❌ Erro:', error);
      await this.sendMessage(phone, '❌ Erro interno. Tente novamente ou digite MENU.', metadata.instance);
    }
  }

  /**
   * Processa mensagem baseada no estado atual do usuário
   */
  async processMessageByState(message, user) {
    const msg = message.toLowerCase().trim();
    
    switch (user.current_state) {
      case this.USER_STATES.MENU_PRINCIPAL:
        return await this.handleMainMenu(msg, user);
        
      case this.USER_STATES.TESTE_NOME:
        return await this.handleTestName(message, user);
        
      case this.USER_STATES.TESTE_CIDADE:
        return await this.handleTestCity(message, user);
        
      case this.USER_STATES.TESTE_DISPOSITIVO:
        return await this.handleTestDevice(message, user);
        
      case this.USER_STATES.PLANO_ESCOLHA:
        return await this.handlePlanChoice(message, user);
        
      case this.USER_STATES.PLANO_COMPROVANTE:
        return await this.handlePlanPaymentProof(message, user);
        
      case this.USER_STATES.RENOVACAO_LOGIN:
        return await this.handleRenewalLogin(message, user);
        
      case this.USER_STATES.RENOVACAO_PLANO:
        return await this.handleRenewalPlan(message, user);
        
      case this.USER_STATES.RENOVACAO_COMPROVANTE:
        return await this.handleRenewalPaymentProof(message, user);
        
      case this.USER_STATES.SUPORTE_PROBLEMA:
        return await this.handleSupportProblem(message, user);
        
      case this.USER_STATES.AGUARDANDO_ATENDENTE:
        return await this.handleWaitingHuman(message, user);
        
      default:
        // Voltar ao menu principal se estado inválido
        user.current_state = this.USER_STATES.MENU_PRINCIPAL;
        return this.getWelcomeMessage();
    }
  }

  /**
   * Gerencia menu principal
   */
  async handleMainMenu(msg, user) {
    // Reset para menu sempre que necessário
    if (msg === 'menu' || msg === 'voltar' || msg === '0') {
      user.current_state = this.USER_STATES.MENU_PRINCIPAL;
      return this.getWelcomeMessage();
    }

    if (msg === '1' || msg.includes('teste')) {
      user.current_state = this.USER_STATES.TESTE_NOME;
      this.initTempData(user.phone);
      return this.handleTestRequest();
    }
    
    if (msg === '2' || msg.includes('plano')) {
      user.current_state = this.USER_STATES.PLANO_ESCOLHA;
      return await this.showPlans();
    }
    
    if (msg === '3' || msg.includes('renovar')) {
      user.current_state = this.USER_STATES.RENOVACAO_LOGIN;
      this.initTempData(user.phone);
      return this.handleRenewal();
    }
    
    if (msg === '4' || msg.includes('suporte')) {
      user.current_state = this.USER_STATES.SUPORTE_PROBLEMA;
      return this.handleSupport();
    }
    
    if (msg === '5' || msg.includes('atendente')) {
      user.current_state = this.USER_STATES.AGUARDANDO_ATENDENTE;
      await telegramAdmin.notifyHumanRequest(user.phone, 'Usuário solicitou atendente');
      return this.handleHuman();
    }

    return `❌ Opção não reconhecida.\n\n${this.getWelcomeMessage()}`;
  }

  /**
   * Fluxo do teste grátis - Dispositivo (finalização)
   */
  async handleTestDevice(message, user) {
    const msg = message.toLowerCase().trim();
    
    if (msg === 'menu' || msg === 'voltar') {
      user.current_state = this.USER_STATES.MENU_PRINCIPAL;
      this.clearTempData(user.phone);
      return this.getWelcomeMessage();
    }
    
    let dispositivo = '';
    
    if (msg === '1' || msg.includes('android') || msg.includes('celular android')) {
      dispositivo = 'Android';
    } else if (msg === '2' || msg.includes('iphone') || msg.includes('ios') || msg.includes('apple')) {
      dispositivo = 'iPhone';
    } else if (msg === '3' || msg.includes('smart tv') || msg.includes('samsung') || msg.includes('lg')) {
      dispositivo = 'Smart TV';
    } else if (msg === '4' || msg.includes('tv box') || msg.includes('box')) {
      dispositivo = 'TV Box';
    } else if (msg === '5' || msg.includes('computador') || msg.includes('pc') || msg.includes('notebook')) {
      dispositivo = 'Computador';
    } else if (msg === '6' || msg.includes('outro')) {
      dispositivo = message.trim();
    } else {
      dispositivo = message.trim();
    }
    
    // Pegar dados temporários
    const tempData = this.getTempData(user.phone);
    const name = tempData.name || user.name || 'Não informado';
    const city = tempData.city || user.city || 'Não informada';
    
    // Atualizar dispositivo no banco
    await database.run('UPDATE users SET device = ? WHERE id = ?', [dispositivo, user.id]);
    
    // Criar solicitação de teste pendente
    const testResult = await database.run(
      'INSERT INTO free_tests (user_id, name, city, device, status) VALUES (?, ?, ?, ?, ?)',
      [user.id, name, city, dispositivo, 'pending']
    );
    
    user.current_state = this.USER_STATES.MENU_PRINCIPAL;
    this.clearTempData(user.phone);
    
    // Notificar admin para aprovação do teste
    await telegramAdmin.notifyTestRequest(user.phone, name, city, dispositivo, testResult.id);
    
    return `🎯 *SOLICITAÇÃO DE TESTE ENVIADA!*

👤 *Nome:* ${name}
📍 *Cidade:* ${city}  
📱 *Dispositivo:* ${dispositivo}

⏳ *Aguarde a aprovação*
Sua solicitação foi enviada para nossa equipe. Você receberá as credenciais de acesso em até 10 minutos.

📲 *Enquanto isso, baixe o aplicativo:*
• 📱 Android: IPTV Smarters Pro
• 🍎 iPhone: GSE Smart IPTV
• 📺 Smart TV: Smart IPTV
• 💻 PC: VLC Player

🏠 Digite *MENU* para voltar ao início`;
  }

  /**
   * Escolha de planos (modificado para solicitar comprovante)
   */
  async handlePlanChoice(message, user) {
    const msg = message.toLowerCase().trim();
    
    if (msg.includes('menu') || msg === 'voltar' || msg === '0') {
      user.current_state = this.USER_STATES.MENU_PRINCIPAL;
      return this.getWelcomeMessage();
    }
    
    const settings = await this.getSettings();
    let selectedPlan = '';
    let price = '';
    let duration = '';
    
    if (msg.includes('mensal') || msg === '1') {
      selectedPlan = 'Mensal';
      price = settings.monthly_plan_price;
      duration = '1 mês';
    } else if (msg.includes('trimestral') || msg === '2') {
      selectedPlan = 'Trimestral';
      price = settings.quarterly_plan_price;
      duration = '3 meses';
    } else if (msg.includes('semestral') || msg === '3') {
      selectedPlan = 'Semestral';
      price = settings.semiannual_plan_price;
      duration = '6 meses';
    } else if (msg.includes('anual') || msg === '4') {
      selectedPlan = 'Anual';
      price = settings.annual_plan_price;
      duration = '12 meses';
    }
    
    if (selectedPlan) {
      // Salvar plano escolhido e solicitar comprovante
      this.setTempData(user.phone, 'selectedPlan', selectedPlan);
      this.setTempData(user.phone, 'planPrice', price);
      this.setTempData(user.phone, 'planDuration', duration);
      
      user.current_state = this.USER_STATES.PLANO_COMPROVANTE;
      
      return this.generatePlanPaymentData(selectedPlan, price, duration, settings);
    }
    
    return `❌ Plano não reconhecido.\n\nDigite:\n• *1* para Mensal (R$ ${settings.monthly_plan_price})\n• *2* para Trimestral (R$ ${settings.quarterly_plan_price})\n• *3* para Semestral (R$ ${settings.semiannual_plan_price})\n• *4* para Anual (R$ ${settings.annual_plan_price})\n\nOu *MENU* para voltar`;
  }

  /**
   * Recebimento de comprovante de pagamento do plano
   */
  async handlePlanPaymentProof(message, user) {
    const msg = message.toLowerCase().trim();
    
    if (msg === 'menu' || msg === 'voltar') {
      user.current_state = this.USER_STATES.MENU_PRINCIPAL;
      this.clearTempData(user.phone);
      return this.getWelcomeMessage();
    }
    
    // Pegar dados temporários
    const tempData = this.getTempData(user.phone);
    const selectedPlan = tempData.selectedPlan;
    const planPrice = tempData.planPrice;
    const planDuration = tempData.planDuration;
    
    // Criar assinatura pendente
    const subResult = await database.run(
      'INSERT INTO subscriptions (user_id, plan, price, status) VALUES (?, ?, ?, ?)',
      [user.id, selectedPlan, parseFloat(planPrice), 'pending']
    );
    
    // Registrar comprovante
    await database.run(
      'INSERT INTO payment_proofs (user_id, phone, request_type, request_id, proof_data) VALUES (?, ?, ?, ?, ?)',
      [user.id, user.phone, 'subscription', subResult.id, message]
    );
    
    user.current_state = this.USER_STATES.MENU_PRINCIPAL;
    this.clearTempData(user.phone);
    
    // Notificar admin
    await telegramAdmin.notifyPlanPayment(user.phone, selectedPlan, planPrice, message, subResult.id);
    
    return `✅ *COMPROVANTE RECEBIDO!*

📦 *Plano:* ${selectedPlan} (${planDuration})
💰 *Valor:* R$ ${planPrice}

⏳ *Status:* Aguardando aprovação
📋 *Comprovante:* Registrado com sucesso

🔄 *Próximos passos:*
1️⃣ Nossa equipe analisará seu pagamento
2️⃣ Você receberá login e senha em até 30 minutos
3️⃣ Comece a assistir imediatamente!

📱 *Importante:* Mantenha este número ativo para receber suas credenciais.

🏠 Digite *MENU* para voltar ao início`;
  }

  /**
   * Renovação - Plano (modificado para solicitar comprovante)
   */
  async handleRenewalPlan(message, user) {
    const msg = message.toLowerCase().trim();
    
    if (msg === 'menu' || msg === 'voltar') {
      user.current_state = this.USER_STATES.MENU_PRINCIPAL;
      this.clearTempData(user.phone);
      return this.getWelcomeMessage();
    }
    
    const settings = await this.getSettings();
    let plano = '';
    let valor = '';
    let duracao = '';
    
    if (msg === '1' || msg.includes('mensal')) {
      plano = 'Mensal';
      valor = settings.monthly_plan_price;
      duracao = '1 mês';
    } else if (msg === '2' || msg.includes('trimestral')) {
      plano = 'Trimestral';
      valor = settings.quarterly_plan_price;
      duracao = '3 meses';
    } else if (msg === '3' || msg.includes('semestral')) {
      plano = 'Semestral';
      valor = settings.semiannual_plan_price;
      duracao = '6 meses';
    } else if (msg === '4' || msg.includes('anual')) {
      plano = 'Anual';
      valor = settings.annual_plan_price;
      duracao = '12 meses';
    }
    
    if (plano) {
      // Salvar dados da renovação
      this.setTempData(user.phone, 'renewalPlan', plano);
      this.setTempData(user.phone, 'renewalPrice', valor);
      this.setTempData(user.phone, 'renewalDuration', duracao);
      
      user.current_state = this.USER_STATES.RENOVACAO_COMPROVANTE;
      
      return this.generateRenewalPaymentData(plano, valor, duracao, settings);
    }
    
    return `❌ Opção inválida. Digite:\n• *1* para Mensal\n• *2* para Trimestral\n• *3* para Semestral\n• *4* para Anual\n\nOu *MENU* para voltar`;
  }

  /**
   * Recebimento de comprovante de renovação
   */
  async handleRenewalPaymentProof(message, user) {
    const msg = message.toLowerCase().trim();
    
    if (msg === 'menu' || msg === 'voltar') {
      user.current_state = this.USER_STATES.MENU_PRINCIPAL;
      this.clearTempData(user.phone);
      return this.getWelcomeMessage();
    }
    
    // Pegar dados temporários
    const tempData = this.getTempData(user.phone);
    const renewalLogin = tempData.renewalLogin;
    const renewalPlan = tempData.renewalPlan;
    const renewalPrice = tempData.renewalPrice;
    const renewalDuration = tempData.renewalDuration;
    
    // Criar renovação pendente
    const renewalResult = await database.run(
      'INSERT INTO renewals (user_id, current_login, plan, price, status, payment_proof) VALUES (?, ?, ?, ?, ?, ?)',
      [user.id, renewalLogin, renewalPlan, parseFloat(renewalPrice), 'pending', message]
    );
    
    user.current_state = this.USER_STATES.MENU_PRINCIPAL;
    this.clearTempData(user.phone);
    
    // Notificar admin
    await telegramAdmin.notifyRenewalPayment(user.phone, renewalLogin, renewalPlan, renewalPrice, message, renewalResult.id);
    
    return `✅ *RENOVAÇÃO SOLICITADA!*

👤 *Login atual:* ${renewalLogin}
📅 *Novo plano:* ${renewalPlan} (${renewalDuration})
💰 *Valor:* R$ ${renewalPrice}

⏳ *Status:* Aguardando aprovação
📋 *Comprovante:* Registrado com sucesso

🔄 *Próximos passos:*
1️⃣ Nossa equipe analisará seu pagamento
2️⃣ Sua conta será renovada em até 30 minutos
3️⃣ Continue assistindo sem interrupção!

📱 *Importante:* Você será notificado quando a renovação for aprovada.

🏠 Digite *MENU* para voltar ao início`;
  }

  /**
   * Gerar dados de pagamento para planos
   */
  generatePlanPaymentData(planName, price, duration, settings) {
    const discountPrice = (parseFloat(price) * 0.95).toFixed(2);
    
    return `💎 *PLANO ${planName.toUpperCase()} SELECIONADO!*

📦 *DETALHES DO PLANO:*
📅 Duração: ${duration}
📺 2000+ canais HD/4K/8K
📱 5 dispositivos simultâneos
🌍 Conteúdo nacional + internacional
🎬 Filmes, séries e documentários
⚽ Esportes Premium + PPV

💰 *VALORES:*
💳 Cartão/Boleto: R$ ${price}
🔥 PIX (5% OFF): R$ ${discountPrice}

💳 *DADOS PARA PAGAMENTO PIX:*
🔑 *Chave PIX:* ${settings.pix_key}
👤 *Nome:* ${settings.pix_name || 'IPTV Premium'}
💰 *Valor com desconto:* R$ ${discountPrice}

📋 *COMO PROCEDER:*
1️⃣ Faça o PIX no valor com desconto
2️⃣ **ENVIE O COMPROVANTE AQUI NO CHAT**
3️⃣ Aguarde aprovação (até 30 minutos)
4️⃣ Receba login e senha automaticamente

⚡ **IMPORTANTE:** Envie uma foto ou print do comprovante na próxima mensagem!

🏠 Digite *MENU* para cancelar`;
  }

  /**
   * Gerar dados de pagamento para renovação
   */
  generateRenewalPaymentData(plano, valor, duracao, settings) {
    const discountPrice = (parseFloat(valor) * 0.95).toFixed(2);
    
    return `🔄 *DADOS PARA RENOVAÇÃO*

📅 *Plano:* ${plano} (${duracao})
💰 *Valor com PIX:* R$ ${discountPrice}

💳 *DADOS PARA PAGAMENTO PIX:*
🔑 *Chave PIX:* ${settings.pix_key}
👤 *Nome:* ${settings.pix_name || 'IPTV Premium'}
💰 *Valor:* R$ ${discountPrice}

📋 *PRÓXIMOS PASSOS:*
1️⃣ Faça o PIX no valor acima
2️⃣ **ENVIE O COMPROVANTE AQUI NO CHAT**
3️⃣ Aguarde aprovação (até 30 minutos)
4️⃣ Sua conta será renovada automaticamente

⚡ **IMPORTANTE:** Envie uma foto ou print do comprovante na próxima mensagem!

🏠 Digite *MENU* para cancelar`;
  }

  // Método para notificar usuário sobre aprovação de teste
  async notifyTestApproved(phone, login, password, expiresAt) {
    const settings = await this.getSettings();
    const expiryTime = moment(expiresAt).format('DD/MM/YYYY HH:mm');
    
    const message = `🎉 *TESTE APROVADO E LIBERADO!* 🎉

📡 *SEUS DADOS DE ACESSO:*
🌐 *URL:* ${settings.iptv_server_url}
👤 *Usuário:* ${login}
🔐 *Senha:* ${password}
⏰ *Válido até:* ${expiryTime}

📲 *APPS RECOMENDADOS:*
• 📱 Android: IPTV Smarters Pro
• 🍎 iPhone: GSE Smart IPTV
• 📺 Smart TV: Smart IPTV
• 💻 PC: VLC Player

📋 *COMO USAR:*
1️⃣ Baixe o app recomendado
2️⃣ Adicione nova conexão/playlist
3️⃣ Cole os dados acima
4️⃣ Aproveite seu teste!

✨ *Gostou?* Digite *2* para ver nossos planos!
🏠 Digite *MENU* para voltar ao início`;

    await this.sendMessage(phone, message);
  }

  // Método para notificar usuário sobre aprovação de plano
  async notifyPlanApproved(phone, login, password, plan, expiresAt) {
    const settings = await this.getSettings();
    const expiryTime = moment(expiresAt).format('DD/MM/YYYY HH:mm');
    
    const message = `🎉 *PLANO APROVADO E ATIVADO!* 🎉

📦 *PLANO:* ${plan}
⏰ *Válido até:* ${expiryTime}

📡 *SEUS DADOS DE ACESSO:*
🌐 *URL:* ${settings.iptv_server_url}
👤 *Usuário:* ${login}
🔐 *Senha:* ${password}

📺 *APROVEITE:*
✅ 2000+ canais HD/4K/8K
✅ 5 dispositivos simultâneos
✅ Filmes, séries e documentários
✅ Esportes Premium + PPV

📲 *BAIXE O APLICATIVO:*
• 📱 Android: IPTV Smarters Pro
• 🍎 iPhone: GSE Smart IPTV
• 📺 Smart TV: Smart IPTV

🎊 *PARABÉNS!* Sua assinatura está ativa!
🏠 Digite *MENU* se precisar de ajuda`;

    await this.sendMessage(phone, message);
  }

  // Método para notificar usuário sobre aprovação de renovação
  async notifyRenewalApproved(phone, login, plan, expiresAt) {
    const expiryTime = moment(expiresAt).format('DD/MM/YYYY HH:mm');
    
    const message = `🔄 *RENOVAÇÃO APROVADA!* 🔄

👤 *Login:* ${login}
📅 *Plano:* ${plan}
⏰ *Válida até:* ${expiryTime}

✅ *RENOVAÇÃO CONCLUÍDA COM SUCESSO!*

Sua conta foi renovada e permanece ativa sem interrupções.
Continue aproveitando todo o conteúdo IPTV Premium!

📺 Mais de 2000 canais disponíveis
🎬 Filmes, séries e documentários
⚽ Esportes Premium + PPV

🏠 Digite *MENU* se precisar de ajuda`;

    await this.sendMessage(phone, message);
  }

  // Mensagens do sistema (outros métodos permanecem iguais)
  getWelcomeMessage() {
    return `📺 *IPTV PREMIUM* - Bem-vindo! 📺

🏆 *Mais de 2000 canais em HD/4K*
⚡ *Melhor qualidade do Brasil*
💰 *Preços imbatíveis*

📋 *MENU PRINCIPAL:*
1️⃣ 🎯 Teste Grátis (6h)
2️⃣ 💎 Ver Planos e Preços  
3️⃣ 🔄 Renovar Assinatura
4️⃣ 🛠️ Suporte Técnico
5️⃣ 👥 Falar com Atendente

👆 *Digite o número da opção desejada!*`;
  }

  handleTestRequest() {
    return `🎯 *TESTE GRÁTIS - 6 HORAS*\n\n🆓 *Totalmente gratuito e sem compromisso!*\n\n📋 Para liberar seu teste, preciso de alguns dados:\n\n👤 Digite seu *nome completo*:\n\n_Digite MENU a qualquer momento para voltar_`;
  }

  async showPlans() {
    const settings = await this.getSettings();
    
    return `💎 *NOSSOS PLANOS IPTV* 📺

🎯 *TODOS OS PLANOS INCLUEM:*
📺 2000+ canais HD/4K/8K
📱 5 dispositivos simultâneos
🌍 Canais nacionais e internacionais
🎬 Filmes, séries e documentários
⚽ Esportes Premium + PPV
🔞 Conteúdo adulto liberado
👨‍💻 Suporte técnico 24h
📶 Instalação rápida
🚫 Sem travamentos

💰 *ESCOLHA SEU PERÍODO:*

📅 *MENSAL* - R$ ${settings.monthly_plan_price}
💳 Renovação mensal
🔄 Cancelamento livre

📊 *TRIMESTRAL* - R$ ${settings.quarterly_plan_price} ⭐ *POPULAR*
💰 3 meses por R$ ${settings.quarterly_plan_price}
📉 Economia de R$ ${(parseFloat(settings.monthly_plan_price) * 3 - parseFloat(settings.quarterly_plan_price)).toFixed(2)}

📈 *SEMESTRAL* - R$ ${settings.semiannual_plan_price} 💎 *ECONÔMICO*
💰 6 meses por R$ ${settings.semiannual_plan_price}
📉 Economia de R$ ${(parseFloat(settings.monthly_plan_price) * 6 - parseFloat(settings.semiannual_plan_price)).toFixed(2)}

🏆 *ANUAL* - R$ ${settings.annual_plan_price} 🔥 *MELHOR CUSTO*
💰 12 meses por R$ ${settings.annual_plan_price}
📉 Economia de R$ ${(parseFloat(settings.monthly_plan_price) * 12 - parseFloat(settings.annual_plan_price)).toFixed(2)}

💳 *FORMAS DE PAGAMENTO:*
🔥 PIX (5% desconto adicional)
💳 Cartão/Boleto

Para contratar, digite: *1*, *2*, *3* ou *4*
🏠 Digite *MENU* para voltar`;
  }

  handleRenewal() {
    return `🔄 *RENOVAÇÃO DE ASSINATURA*

Para renovar sua assinatura existente, preciso do seu login atual.

👤 Digite seu *login/usuário*:

_Digite MENU para voltar ao início_`;
  }

  // Fluxo de teste - Nome e Cidade (mantidos iguais)
  async handleTestName(message, user) {
    const msg = message.toLowerCase().trim();
    
    if (msg === 'menu' || msg === 'voltar') {
      user.current_state = this.USER_STATES.MENU_PRINCIPAL;
      this.clearTempData(user.phone);
      return this.getWelcomeMessage();
    }
    
    const name = message.trim();
    if (name.length < 2) {
      return `❌ Nome muito curto. Digite seu nome completo:`;
    }
    
    this.setTempData(user.phone, 'name', name);
    await database.run('UPDATE users SET name = ? WHERE id = ?', [name, user.id]);
    user.current_state = this.USER_STATES.TESTE_CIDADE;
    
    return `✅ Nome registrado: *${name}*\n\n📍 Agora informe sua cidade:\n\n_Digite MENU para voltar_`;
  }

  async handleTestCity(message, user) {
    const msg = message.toLowerCase().trim();
    
    if (msg === 'menu' || msg === 'voltar') {
      user.current_state = this.USER_STATES.MENU_PRINCIPAL;
      this.clearTempData(user.phone);
      return this.getWelcomeMessage();
    }
    
    const city = message.trim();
    if (city.length < 2) {
      return `❌ Cidade muito curta. Digite sua cidade:`;
    }
    
    this.setTempData(user.phone, 'city', city);
    await database.run('UPDATE users SET city = ? WHERE id = ?', [city, user.id]);
    user.current_state = this.USER_STATES.TESTE_DISPOSITIVO;
    
    return `✅ Cidade registrada: *${city}*\n\n📱 Qual dispositivo você vai usar?\n\n1️⃣ Celular Android\n2️⃣ Celular iPhone\n3️⃣ Smart TV Samsung/LG\n4️⃣ TV Box Android\n5️⃣ Computador/Notebook\n6️⃣ Outro\n\nDigite o número ou nome:\n\n_Digite MENU para voltar_`;
  }

  async handleRenewalLogin(message, user) {
    const msg = message.toLowerCase().trim();
    
    if (msg === 'menu' || msg === 'voltar') {
      user.current_state = this.USER_STATES.MENU_PRINCIPAL;
      this.clearTempData(user.phone);
      return this.getWelcomeMessage();
    }
    
    const login = message.trim();
    if (login.length < 3) {
      return `❌ Login muito curto. Digite seu login atual:\n\n_Digite MENU para voltar_`;
    }
    
    this.setTempData(user.phone, 'renewalLogin', login);
    user.current_state = this.USER_STATES.RENOVACAO_PLANO;
    
    const settings = await this.getSettings();
    return `✅ Login registrado: *${login}*\n\n💎 Qual período deseja renovar?\n\n1️⃣ Mensal - R$ ${settings.monthly_plan_price}\n2️⃣ Trimestral - R$ ${settings.quarterly_plan_price}\n3️⃣ Semestral - R$ ${settings.semiannual_plan_price}\n4️⃣ Anual - R$ ${settings.annual_plan_price}\n\nDigite o número:\n\n_Digite MENU para voltar_`;
  }

  // Outros métodos auxiliares (mantidos iguais)
  handleSupport() {
    return `🛠️ *SUPORTE TÉCNICO IPTV*

🔍 *PROBLEMAS MAIS COMUNS:*

📱 *Travando/Lento:*
• Verifique internet (mín 10MB)
• Feche outros apps
• Reinicie o aplicativo

📺 *Não conecta:*
• Confira login e senha
• Teste outro servidor
• Reinstale o app

💬 *DESCREVA SEU PROBLEMA:*
Digite detalhes do que está acontecendo...

🚨 Ou digite *ATENDENTE* para suporte humano
🏠 Digite *MENU* para voltar`;
  }

  async handleSupportProblem(message, user) {
    const msg = message.toLowerCase().trim();
    
    if (msg.includes('atendente') || msg === 'atendente') {
      user.current_state = this.USER_STATES.AGUARDANDO_ATENDENTE;
      await telegramAdmin.notifyHumanRequest(user.phone, message);
      return this.handleHuman();
    }
    
    if (msg === 'menu' || msg === 'voltar') {
      user.current_state = this.USER_STATES.MENU_PRINCIPAL;
      return this.getWelcomeMessage();
    }
    
    await database.run(
      'INSERT INTO support_requests (user_id, phone, problem_description) VALUES (?, ?, ?)',
      [user.id, user.phone, message]
    );
    
    await telegramAdmin.notifySupportRequest(user.phone, message);
    
    user.current_state = this.USER_STATES.MENU_PRINCIPAL;
    
    return `🛠️ *PROBLEMA REGISTRADO!*\n\nSua solicitação foi registrada:\n"${message}"\n\n👨‍💻 Nossa equipe técnica analisará seu caso e retornará em breve.\n\n📱 Para urgências, digite *5* para falar com atendente.\n\n🏠 Digite *MENU* para voltar`;
  }

  handleHuman() {
    return `👥 *ATENDIMENTO HUMANO*

🔄 Você será transferido para nosso suporte especializado.

⏰ *HORÁRIOS DE ATENDIMENTO:*
🕐 Segunda à Sexta: 8h às 18h
🕐 Sábado: 8h às 12h  
🕐 Domingo: Emergências apenas

👨‍💻 *STATUS:* Aguardando atendente...
⏱️ *Tempo médio:* 5-10 minutos

💬 *ENVIE SUA DÚVIDA:*
Descreva seu problema que nosso atendente responderá em breve.

🏠 Digite *MENU* para voltar ao início`;
  }

  async handleWaitingHuman(message, user) {
    const msg = message.toLowerCase().trim();
    
    if (msg === 'menu' || msg === 'voltar') {
      user.current_state = this.USER_STATES.MENU_PRINCIPAL;
      return this.getWelcomeMessage();
    }
    
    await telegramAdmin.notifyHumanRequest(user.phone, message);
    
    return `⏳ *VOCÊ ESTÁ NA FILA DE ATENDIMENTO*\n\nSua mensagem foi registrada:\n"${message}"\n\n🕐 Tempo médio de espera: 5-10 minutos\n👨‍💻 Um atendente entrará em contato em breve\n\n🏠 Digite *MENU* para voltar ao início`;
  }

  // Gerenciamento de dados temporários (mantidos iguais)
  initTempData(phone) {
    this.userTempData.set(phone, {});
  }

  setTempData(phone, key, value) {
    if (!this.userTempData.has(phone)) {
      this.userTempData.set(phone, {});
    }
    const data = this.userTempData.get(phone);
    data[key] = value;
    this.userTempData.set(phone, data);
  }

  getTempData(phone) {
    return this.userTempData.get(phone) || {};
  }

  clearTempData(phone) {
    this.userTempData.delete(phone);
  }

  // Funções de banco de dados (mantidas iguais)
  async getOrCreateUser(phone) {
    let user = await database.get('SELECT * FROM users WHERE phone = ?', [phone]);
    
    if (!user) {
      const result = await database.run(
        'INSERT INTO users (phone, current_state, message_count) VALUES (?, ?, ?)',
        [phone, this.USER_STATES.MENU_PRINCIPAL, 0]
      );
      
      user = {
        id: result.id,
        phone: phone,
        name: null,
        city: null,
        device: null,
        current_state: this.USER_STATES.MENU_PRINCIPAL,
        message_count: 0,
        created_at: new Date().toISOString(),
        last_interaction: new Date().toISOString()
      };
    }
    
    return user;
  }

  async updateUserInteraction(userId, newState) {
    await database.run(
      'UPDATE users SET current_state = ?, message_count = message_count + 1, last_interaction = CURRENT_TIMESTAMP WHERE id = ?',
      [newState, userId]
    );
  }

  async logMessage(userId, phone, content, type) {
    await database.run(
      'INSERT INTO messages (user_id, phone, message_content, message_type) VALUES (?, ?, ?, ?)',
      [userId, phone, content, type]
    );
  }

  async getSettings() {
    const settings = await database.all('SELECT key_name, key_value FROM settings');
    const result = {};
    settings.forEach(setting => {
      result[setting.key_name] = setting.key_value;
    });
    return result;
  }

  async sendMessage(phone, message, instance = null) {
    try {
      const instanceToUse = instance || this.instanceName;
      const url = `${this.evolutionApiUrl}/message/sendText/${instanceToUse}`;
      
      const payload = { 
        number: phone, 
        text: message,
        delay: 1200,           // LINHA ADICIONADA
        linkPreview: false     // LINHA ADICIONADA
      };
      
      const headers = { 'Content-Type': 'application/json' };
      
      if (this.evolutionApiKey) {
        headers['apikey'] = this.evolutionApiKey;
      }

      console.log(`📤 Enviando para ${phone} via ${instanceToUse} com delay de 1.2s`);

      const response = await axios.post(url, payload, { 
        headers,
        timeout: 15000        // TIMEOUT AUMENTADO
      });
      
      if (response.data && response.data.key) {
        console.log(`✅ Mensagem enviada para ${phone} - ID: ${response.data.key.id}`);
      }
      
    } catch (error) {
      console.error(`❌ Erro ao enviar mensagem para ${phone}:`, error.message);
      if (error.response) {
        console.error('Response error:', error.response.data);
      }
    }
  }

  startCleanupTimer() {
    setInterval(() => {
      this.cleanupTempData();
    }, 60 * 60 * 1000);
  }

  cleanupTempData() {
    const now = Date.now();
    const maxAge = 2 * 60 * 60 * 1000;

    for (const [phone, data] of this.userTempData.entries()) {
      if (data.timestamp && (now - data.timestamp) > maxAge) {
        this.userTempData.delete(phone);
        console.log(`🧹 Dados temporários limpos para ${phone}`);
      }
    }
    
    console.log(`🧹 Limpeza concluída. Dados temporários ativos: ${this.userTempData.size}`);
  }
}

// Instância singleton
const botHandler = new IPTVBot();
botHandler.startCleanupTimer();

module.exports = { botHandler };