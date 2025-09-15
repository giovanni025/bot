const { botHandler } = require("../services/bot-handler");

class EvolutionWebhooks {
  constructor(broadcastFunction) {
    this.broadcast = broadcastFunction;
  }

  /**
   * Função principal para processar eventos de mensagem
   */
  async handleWebhookEvent(req, res) {
    const webhookData = req.body;
    
    console.log("Webhook received:", JSON.stringify(webhookData, null, 2));

    const { event, instance, data } = webhookData;

    if (event === "messages.upsert" && data) {
      await this.processIncomingMessage(data, instance);
    } else if (event === "messages.update" && data) {
      await this.processMessageStatusUpdate(data, instance);
    }

    res.status(200).json({ status: "ok" });
  }

  /**
   * Processa mensagens recebidas
   */
  async processIncomingMessage(data, instance) {
    // Processar mensagem recebida
    if (data.key && !data.key.fromMe && data.message) {
      const phone = data.key.remoteJid?.replace('@s.whatsapp.net', '') || 
                   data.key.remoteJid?.replace('@c.us', ''); // Para contatos individuais
      
      let messageContent = '';
      
      // Diferentes tipos de mensagem
      if (data.message.conversation) {
        messageContent = data.message.conversation;
      } else if (data.message.extendedTextMessage?.text) {
        messageContent = data.message.extendedTextMessage.text;
      } else if (data.message.imageMessage?.caption) {
        messageContent = data.message.imageMessage.caption || '[Imagem]';
      } else if (data.message.videoMessage?.caption) {
        messageContent = data.message.videoMessage.caption || '[Vídeo]';
      } else if (data.message.documentMessage?.title) {
        messageContent = data.message.documentMessage.title || '[Documento]';
      } else if (data.message.audioMessage) {
        messageContent = '[Áudio]';
      } else if (data.message.stickerMessage) {
        messageContent = '[Sticker]';
      } else {
        messageContent = '[Mensagem não suportada]';
      }

      if (phone && messageContent) {
        // Processar mensagem através do bot handler
        await botHandler.handleIncomingMessage(phone, messageContent, {
          messageId: data.key.id,
          pushName: data.pushName,
          messageType: data.messageType,
          timestamp: data.messageTimestamp,
          instance: instance
        });

        // Broadcast para clientes conectados
        this.broadcast({ 
          type: 'new_message', 
          data: { 
            phone, 
            content: messageContent, 
            pushName: data.pushName,
            instance: instance,
            timestamp: data.messageTimestamp
          } 
        });
      }
    }
  }

  /**
   * Processa atualizações de status de mensagem
   */
  async processMessageStatusUpdate(data, instance) {
    console.log("Message status update:", data);
    
    this.broadcast({ 
      type: 'message_status_update', 
      data: {
        messageId: data.key?.id,
        status: data.status,
        instance: instance
      } 
    });
  }

  /**
   * Função para processar atualizações de conexão
   */
  async handleConnectionUpdate(req, res) {
    const { event, instance, data } = req.body;
    
    console.log(`Connection update for ${instance}:`, data);

    this.broadcast({
      type: 'connection_update',
      data: {
        instance: instance,
        state: data.state,
        qr: data.qr
      }
    });

    res.status(200).json({ status: "ok" });
  }

  /**
   * Função para processar atualizações do QR Code
   */
  async handleQRCodeUpdate(req, res) {
    const { event, instance, data } = req.body;
    
    console.log(`QR Code update for ${instance}`);

    this.broadcast({
      type: 'qr_code_update',
      data: {
        instance: instance,
        qrcode: data.qrcode // Base64 do QR code
      }
    });

    res.status(200).json({ status: "ok" });
  }

  /**
   * Registra as rotas de webhook da Evolution API
   */
  registerRoutes(app) {
    // Webhook principal (se webhook_by_events = false)
    app.post("/webhook", async (req, res) => {
      try {
        await this.handleWebhookEvent(req, res);
      } catch (error) {
        console.error("Webhook error:", error);
        res.status(500).json({ message: "Error processing webhook" });
      }
    });

    // Webhook específicos por evento (se webhook_by_events = true)
    app.post("/webhook/messages-upsert", async (req, res) => {
      try {
        await this.handleWebhookEvent(req, res);
      } catch (error) {
        console.error("Messages upsert webhook error:", error);
        res.status(500).json({ message: "Error processing messages webhook" });
      }
    });

    app.post("/webhook/messages-update", async (req, res) => {
      try {
        await this.handleWebhookEvent(req, res);
      } catch (error) {
        console.error("Messages update webhook error:", error);
        res.status(500).json({ message: "Error processing messages update webhook" });
      }
    });

    app.post("/webhook/connection-update", async (req, res) => {
      try {
        await this.handleConnectionUpdate(req, res);
      } catch (error) {
        console.error("Connection update webhook error:", error);
        res.status(500).json({ message: "Error processing connection webhook" });
      }
    });

    app.post("/webhook/qrcode-updated", async (req, res) => {
      try {
        await this.handleQRCodeUpdate(req, res);
      } catch (error) {
        console.error("QR Code webhook error:", error);
        res.status(500).json({ message: "Error processing QR code webhook" });
      }
    });
  }
}

// Export para uso como singleton
const evolutionWebhooks = (broadcastFunction) => new EvolutionWebhooks(broadcastFunction);

module.exports = {
  EvolutionWebhooks,
  evolutionWebhooks
};