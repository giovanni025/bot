const { botHandler } = require("../services/bot-handler");
const axios = require('axios');
const fs = require('fs');
const path = require('path');

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
      let mediaData = null;
      
      // Diferentes tipos de mensagem
      if (data.message.conversation) {
        messageContent = data.message.conversation;
      } else if (data.message.extendedTextMessage?.text) {
        messageContent = data.message.extendedTextMessage.text;
      } else if (data.message.imageMessage?.caption) {
        messageContent = data.message.imageMessage.caption || '[Imagem]';
        mediaData = await this.processMediaMessage(data.message.imageMessage, 'image', data.key.id, instance);
      } else if (data.message.videoMessage?.caption) {
        messageContent = data.message.videoMessage.caption || '[Vídeo]';
        mediaData = await this.processMediaMessage(data.message.videoMessage, 'video', data.key.id, instance);
      } else if (data.message.documentMessage?.title) {
        messageContent = data.message.documentMessage.title || '[Documento]';
        mediaData = await this.processMediaMessage(data.message.documentMessage, 'document', data.key.id, instance);
      } else if (data.message.audioMessage) {
        messageContent = '[Áudio]';
        mediaData = await this.processMediaMessage(data.message.audioMessage, 'audio', data.key.id, instance);
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
          instance: instance,
          mediaData: mediaData
        });

        // Broadcast para clientes conectados
        this.broadcast({ 
          type: 'new_message', 
          data: { 
            phone, 
            content: messageContent, 
            pushName: data.pushName,
            instance: instance,
            timestamp: data.messageTimestamp,
            hasMedia: !!mediaData
          } 
        });
      }
    }
  }

  /**
   * Processa mensagens de mídia (imagem, vídeo, documento, áudio)
   */
  async processMediaMessage(mediaMessage, mediaType, messageId, instance) {
    try {
      console.log(`📎 Processando mídia ${mediaType} - ID: ${messageId}`);
      
      let mediaBuffer = null;
      let fileName = '';
      let mimeType = '';
      let fileSize = 0;

      // Extrair informações da mídia
      switch (mediaType) {
        case 'image':
          fileName = `image_${messageId}.jpg`;
          mimeType = mediaMessage.mimetype || 'image/jpeg';
          fileSize = mediaMessage.fileLength || 0;
          break;
        case 'video':
          fileName = `video_${messageId}.mp4`;
          mimeType = mediaMessage.mimetype || 'video/mp4';
          fileSize = mediaMessage.fileLength || 0;
          break;
        case 'document':
          fileName = mediaMessage.fileName || `document_${messageId}`;
          mimeType = mediaMessage.mimetype || 'application/octet-stream';
          fileSize = mediaMessage.fileLength || 0;
          break;
        case 'audio':
          fileName = `audio_${messageId}.ogg`;
          mimeType = mediaMessage.mimetype || 'audio/ogg';
          fileSize = mediaMessage.fileLength || 0;
          break;
      }

      // Verificar se há base64 no webhook
      if (mediaMessage.base64) {
        console.log(`✅ Base64 encontrado no webhook para ${fileName}`);
        mediaBuffer = Buffer.from(mediaMessage.base64, 'base64');
      } else {
        console.log(`⚠️ Base64 não encontrado, buscando via API para ${fileName}`);
        mediaBuffer = await this.fetchMediaFromAPI(messageId, instance);
      }

      if (!mediaBuffer) {
        console.log(`❌ Não foi possível obter mídia para ${fileName}`);
        return null;
      }

      const maxSizeMB = parseInt(process.env.MAX_FILE_SIZE_MB || '20');
      const maxSizeBytes = maxSizeMB * 1024 * 1024;

      // Se arquivo for muito grande, salvar no servidor
      if (mediaBuffer.length > maxSizeBytes) {
        console.log(`📁 Arquivo grande (${(mediaBuffer.length / 1024 / 1024).toFixed(2)}MB), salvando no servidor`);
        const filePath = await this.saveMediaToServer(mediaBuffer, fileName);
        return {
          type: 'file_link',
          fileName: fileName,
          mimeType: mimeType,
          size: mediaBuffer.length,
          filePath: filePath,
          downloadUrl: `${process.env.EVOLUTION_API_URL || 'http://localhost:3002'}/download/${path.basename(filePath)}`
        };
      }

      return {
        type: 'buffer',
        fileName: fileName,
        mimeType: mimeType,
        size: mediaBuffer.length,
        buffer: mediaBuffer
      };

    } catch (error) {
      console.error(`❌ Erro ao processar mídia ${mediaType}:`, error);
      return null;
    }
  }

  /**
   * Busca mídia via Evolution API quando não há base64 no webhook
   */
  async fetchMediaFromAPI(messageId, instance) {
    try {
      const evolutionUrl = process.env.EVOLUTION_API_URL || 'http://localhost:8080';
      const apiKey = process.env.EVOLUTION_API_KEY;
      
      const headers = { 'Content-Type': 'application/json' };
      if (apiKey) {
        headers['apikey'] = apiKey;
      }

      const url = `${evolutionUrl}/chat/getBase64FromMediaMessage/${instance}`;
      const payload = {
        message: {
          key: {
            id: messageId
          }
        }
      };

      console.log(`🔍 Buscando mídia via API: ${url}`);
      const response = await axios.post(url, payload, { 
        headers,
        timeout: 30000 
      });

      if (response.data && response.data.base64) {
        console.log(`✅ Base64 obtido via API para ${messageId}`);
        return Buffer.from(response.data.base64, 'base64');
      }

      console.log(`❌ API não retornou base64 para ${messageId}`);
      return null;

    } catch (error) {
      console.error(`❌ Erro ao buscar mídia via API:`, error.message);
      return null;
    }
  }

  /**
   * Salva mídia no servidor para arquivos grandes
   */
  async saveMediaToServer(buffer, fileName) {
    try {
      const tempDir = process.env.TEMP_FILES_DIR || './temp';
      
      // Criar diretório se não existir
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

      const filePath = path.join(tempDir, `${Date.now()}_${fileName}`);
      fs.writeFileSync(filePath, buffer);
      
      console.log(`💾 Arquivo salvo: ${filePath}`);
      
      // Agendar limpeza do arquivo em 24h
      setTimeout(() => {
        try {
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            console.log(`🧹 Arquivo temporário removido: ${filePath}`);
          }
        } catch (error) {
          console.error(`❌ Erro ao remover arquivo temporário:`, error);
        }
      }, 24 * 60 * 60 * 1000); // 24 horas

      return filePath;
    } catch (error) {
      console.error(`❌ Erro ao salvar arquivo:`, error);
      throw error;
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