const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const axios = require('axios');

/**
 * Módulo de Transcrição de Áudio usando Groq API
 * Suporta os modelos Whisper para transcrição rápida e precisa
 */
class GroqTranscription {
    constructor(apiKey, options = {}) {
        if (!apiKey) {
            throw new Error('Groq API key é obrigatória');
        }
        
        this.apiKey = apiKey;
        this.baseURL = 'https://api.groq.com/openai/v1';
        this.model = options.model || 'whisper-large-v3-turbo'; // Modelo mais rápido por padrão
        this.language = options.language || 'pt'; // Português por padrão
        this.temperature = options.temperature || 0;
        this.responseFormat = options.responseFormat || 'json';
        
        // Formatos de áudio suportados
        this.supportedFormats = ['flac', 'mp3', 'mp4', 'mpeg', 'mpga', 'm4a', 'ogg', 'wav', 'webm'];
        
        // Configuração do axios
        this.httpClient = axios.create({
            baseURL: this.baseURL,
            headers: {
                'Authorization': `Bearer ${this.apiKey}`,
            },
            timeout: 60000 // 60 segundos timeout
        });
    }

    /**
     * Transcreve um arquivo de áudio
     * @param {string|Buffer} audioInput - Caminho do arquivo ou Buffer do áudio
     * @param {Object} options - Opções adicionais de transcrição
     * @returns {Promise<Object>} - Resultado da transcrição
     */
    async transcribeAudio(audioInput, options = {}) {
        try {
            // Validar entrada
            if (!audioInput) {
                throw new Error('Arquivo de áudio é obrigatório');
            }

            const formData = new FormData();
            
            // Determinar se é um caminho de arquivo ou Buffer
            if (typeof audioInput === 'string') {
                // É um caminho de arquivo
                if (!fs.existsSync(audioInput)) {
                    throw new Error(`Arquivo não encontrado: ${audioInput}`);
                }
                
                const fileExtension = path.extname(audioInput).toLowerCase().slice(1);
                if (!this.supportedFormats.includes(fileExtension)) {
                    throw new Error(`Formato não suportado: ${fileExtension}. Formatos suportados: ${this.supportedFormats.join(', ')}`);
                }
                
                const audioBuffer = fs.readFileSync(audioInput);
                const filename = path.basename(audioInput);
                formData.append('file', audioBuffer, filename);
            } else if (Buffer.isBuffer(audioInput)) {
                // É um Buffer
                formData.append('file', audioInput, options.filename || 'audio.wav');
            } else {
                throw new Error('audioInput deve ser um caminho de arquivo (string) ou Buffer');
            }

            // Adicionar parâmetros da API
            formData.append('model', options.model || this.model);
            formData.append('language', options.language || this.language);
            formData.append('temperature', options.temperature || this.temperature);
            formData.append('response_format', options.responseFormat || this.responseFormat);
            
            // Parâmetros opcionais
            if (options.prompt) {
                formData.append('prompt', options.prompt);
            }
            if (options.timestamp_granularities) {
                formData.append('timestamp_granularities[]', options.timestamp_granularities);
            }

            console.log('📡 Enviando áudio para transcrição...');
            
            const response = await this.httpClient.post('/audio/transcriptions', formData, {
                headers: {
                    ...formData.getHeaders(),
                }
            });

            console.log('✅ Transcrição concluída com sucesso');
            
            return {
                success: true,
                data: response.data,
                text: response.data.text,
                language: response.data.language || this.language,
                duration: response.data.duration,
                segments: response.data.segments || null
            };

        } catch (error) {
            console.error('❌ Erro na transcrição:', error.message);
            
            if (error.response) {
                // Erro da API
                return {
                    success: false,
                    error: error.response.data?.error?.message || 'Erro da API Groq',
                    status: error.response.status,
                    details: error.response.data
                };
            } else if (error.request) {
                // Erro de rede
                return {
                    success: false,
                    error: 'Erro de conexão com a API Groq',
                    details: error.message
                };
            } else {
                // Erro interno
                return {
                    success: false,
                    error: error.message,
                    details: error.stack
                };
            }
        }
    }

    /**
     * Transcreve áudio com tradução para inglês
     * @param {string|Buffer} audioInput - Caminho do arquivo ou Buffer do áudio
     * @param {Object} options - Opções adicionais
     * @returns {Promise<Object>} - Resultado da tradução
     */
    async translateAudio(audioInput, options = {}) {
        try {
            const formData = new FormData();
            
            if (typeof audioInput === 'string') {
                if (!fs.existsSync(audioInput)) {
                    throw new Error(`Arquivo não encontrado: ${audioInput}`);
                }
                const audioBuffer = fs.readFileSync(audioInput);
                const filename = path.basename(audioInput);
                formData.append('file', audioBuffer, filename);
            } else if (Buffer.isBuffer(audioInput)) {
                formData.append('file', audioInput, options.filename || 'audio.wav');
            }

            formData.append('model', options.model || this.model);
            formData.append('temperature', options.temperature || this.temperature);
            formData.append('response_format', options.responseFormat || this.responseFormat);
            
            if (options.prompt) {
                formData.append('prompt', options.prompt);
            }

            console.log('🌐 Enviando áudio para tradução...');
            
            const response = await this.httpClient.post('/audio/translations', formData, {
                headers: {
                    ...formData.getHeaders(),
                }
            });

            console.log('✅ Tradução concluída com sucesso');
            
            return {
                success: true,
                data: response.data,
                text: response.data.text,
                language: 'en', // Sempre retorna em inglês
                duration: response.data.duration,
                segments: response.data.segments || null
            };

        } catch (error) {
            console.error('❌ Erro na tradução:', error.message);
            return {
                success: false,
                error: error.message,
                details: error.response?.data || error.stack
            };
        }
    }

    /**
     * Transcreve áudio de uma URL
     * @param {string} audioUrl - URL do arquivo de áudio
     * @param {Object} options - Opções adicionais
     * @returns {Promise<Object>} - Resultado da transcrição
     */
    async transcribeFromUrl(audioUrl, options = {}) {
        try {
            console.log('⬇️ Baixando áudio da URL...');
            
            const response = await axios.get(audioUrl, {
                responseType: 'arraybuffer',
                timeout: 30000
            });
            
            const audioBuffer = Buffer.from(response.data);
            
            // Determinar filename da URL
            const urlPath = new URL(audioUrl).pathname;
            const filename = path.basename(urlPath) || 'audio.wav';
            
            return await this.transcribeAudio(audioBuffer, {
                ...options,
                filename: filename
            });
            
        } catch (error) {
            console.error('❌ Erro ao baixar áudio da URL:', error.message);
            return {
                success: false,
                error: `Erro ao processar URL: ${error.message}`,
                details: error.response?.data || error.stack
            };
        }
    }

    /**
     * Validar arquivo de áudio
     * @param {string} filePath - Caminho do arquivo
     * @returns {Object} - Resultado da validação
     */
    validateAudioFile(filePath) {
        try {
            if (!fs.existsSync(filePath)) {
                return { valid: false, error: 'Arquivo não encontrado' };
            }

            const stats = fs.statSync(filePath);
            const fileSizeMB = stats.size / (1024 * 1024);
            
            // Groq API tem limite de 25MB
            if (fileSizeMB > 25) {
                return { 
                    valid: false, 
                    error: `Arquivo muito grande: ${fileSizeMB.toFixed(2)}MB. Limite: 25MB` 
                };
            }

            const fileExtension = path.extname(filePath).toLowerCase().slice(1);
            if (!this.supportedFormats.includes(fileExtension)) {
                return { 
                    valid: false, 
                    error: `Formato não suportado: ${fileExtension}` 
                };
            }

            return { 
                valid: true, 
                size: fileSizeMB,
                format: fileExtension 
            };

        } catch (error) {
            return { 
                valid: false, 
                error: error.message 
            };
        }
    }

    /**
     * Obter informações sobre modelos disponíveis
     * @returns {Object} - Informações dos modelos
     */
    getAvailableModels() {
        return {
            'whisper-large-v3': {
                description: 'Modelo mais preciso, maior latência',
                languages: 'Multilíngue (99+ idiomas)',
                recommended: 'Para máxima precisão'
            },
            'whisper-large-v3-turbo': {
                description: 'Modelo mais rápido, boa precisão',
                languages: 'Multilíngue (99+ idiomas)',
                recommended: 'Para aplicações em tempo real'
            }
        };
    }

    /**
     * Obter formatos de áudio suportados
     * @returns {Array} - Lista de formatos suportados
     */
    getSupportedFormats() {
        return [...this.supportedFormats];
    }

    /**
     * Processar áudio do WhatsApp (Evolution API v2)
     * @param {Object} audioMessage - Objeto da mensagem de áudio da Evolution API
     * @param {string} evolutionApiUrl - URL base da Evolution API
     * @param {string} apiKey - Chave da Evolution API
     * @param {string} instanceName - Nome da instância
     * @param {Object} options - Opções adicionais
     * @returns {Promise<Object>} - Resultado da transcrição
     */
    async transcribeWhatsAppAudio(audioMessage, evolutionApiUrl, apiKey, instanceName, options = {}) {
        try {
            console.log('🎵 Processando áudio do WhatsApp...');
            
            // Baixar áudio da Evolution API v2
            const audioBuffer = await this.downloadWhatsAppAudio(
                audioMessage, 
                evolutionApiUrl, 
                apiKey, 
                instanceName
            );
            
            if (!audioBuffer) {
                throw new Error('Falha ao baixar áudio do WhatsApp');
            }
            
            // Determinar filename baseado no tipo de áudio
            const filename = `whatsapp_audio_${Date.now()}.${audioMessage.mimetype?.includes('ogg') ? 'ogg' : 'mp3'}`;
            
            // Transcrever o áudio
            const result = await this.transcribeAudio(audioBuffer, {
                ...options,
                filename: filename
            });
            
            console.log('✅ Áudio do WhatsApp transcrito com sucesso');
            return result;
            
        } catch (error) {
            console.error('❌ Erro ao transcrever áudio do WhatsApp:', error.message);
            return {
                success: false,
                error: error.message,
                details: error.stack
            };
        }
    }

    /**
     * Baixar áudio da Evolution API v2
     * @param {Object} audioMessage - Mensagem de áudio
     * @param {string} evolutionApiUrl - URL da Evolution API
     * @param {string} apiKey - Chave da API
     * @param {string} instanceName - Nome da instância
     * @returns {Promise<Buffer>} - Buffer do áudio
     */
    async downloadWhatsAppAudio(audioMessage, evolutionApiUrl, apiKey, instanceName) {
        try {
            console.log('⬇️ Baixando áudio do WhatsApp...');
            
            // Para Evolution API v2, precisamos fazer o download do arquivo
            const fileUrl = `${evolutionApiUrl}/chat/getBase64FromMediaMessage/${instanceName}`;
            
            const response = await this.httpClient.post(fileUrl, {
                message: {
                    audioMessage: audioMessage
                }
            }, {
                headers: {
                    'apikey': apiKey,
                    'Content-Type': 'application/json'
                }
            });
            
            if (response.data && response.data.base64) {
                // Converter base64 para buffer
                const base64Data = response.data.base64.replace(/^data:audio\/[a-z]+;base64,/, '');
                return Buffer.from(base64Data, 'base64');
            } else {
                throw new Error('Resposta inválida da Evolution API');
            }
            
        } catch (error) {
            console.error('❌ Erro ao baixar áudio:', error.message);
            
            // Fallback: tentar método alternativo se disponível
            if (audioMessage.url) {
                try {
                    const directResponse = await axios.get(audioMessage.url, {
                        responseType: 'arraybuffer',
                        timeout: 30000
                    });
                    return Buffer.from(directResponse.data);
                } catch (fallbackError) {
                    console.error('❌ Erro no fallback:', fallbackError.message);
                }
            }
            
            return null;
        }
    }
}

module.exports = GroqTranscription;