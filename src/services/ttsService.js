// services/ttsService.js - Serviço de Text-to-Speech usando ElevenLabs
const axios = require("axios");

class TtsService {
    constructor(apiKey, options = {}) {
        if (!apiKey) {
            throw new Error("Chave da API ElevenLabs é obrigatória");
        }
        
        this.apiKey = apiKey;
        this.baseURL = "https://api.elevenlabs.io/v1";
        this.defaultVoiceId = options.defaultVoiceId || "EXAVITQu4vr4xnSDxMaL";
        this.timeout = options.timeout || 30000;
        this.maxRetries = options.maxRetries || 2;
        
        // Cache de vozes para evitar requests desnecessários
        this.voicesCache = null;
        this.voicesCacheExpiry = null;
        this.cacheValidityMinutes = 60; // Cache por 1 hora
    }
    
    /**
     * Converte texto em áudio usando a API ElevenLabs
     * @param {string} text - Texto para converter
     * @param {Object} options - Opções de conversão
     * @returns {Promise<string>} - Áudio em base64
     */
    async textoParaAudioBase64(text, options = {}) {
        if (!text || text.trim().length === 0) {
            throw new Error("Texto não pode estar vazio");
        }
        
        // Limitar tamanho do texto
        if (text.length > 5000) {
            throw new Error("Texto muito longo. Máximo 5000 caracteres.");
        }
        
        const {
            voiceId = this.defaultVoiceId,
            modelId = "eleven_multilingual_v2", // Melhor modelo para português
            voiceSettings = {
                stability: 0.6,
                similarity_boost: 0.8,
                style: 0.0,
                use_speaker_boost: true
            }
        } = options;
        
        let attempt = 0;
        
        while (attempt <= this.maxRetries) {
            try {
                console.log(`[TTS] Convertendo texto (tentativa ${attempt + 1}): "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`);
                
                const response = await axios.post(
                    `${this.baseURL}/text-to-speech/${voiceId}`,
                    {
                        text: text.trim(),
                        model_id: modelId,
                        voice_settings: voiceSettings
                    },
                    {
                        headers: {
                            "xi-api-key": this.apiKey,
                            "Content-Type": "application/json",
                            "Accept": "audio/mpeg"
                        },
                        responseType: "arraybuffer",
                        timeout: this.timeout
                    }
                );
                
                if (!response.data || response.data.byteLength === 0) {
                    throw new Error("Resposta de áudio vazia da API");
                }
                
                const audioBase64 = Buffer.from(response.data, "binary").toString("base64");
                
                console.log(`[TTS] Áudio gerado com sucesso (${audioBase64.length} caracteres base64)`);
                
                return audioBase64;
                
            } catch (error) {
                attempt++;
                
                if (error.response) {
                    const status = error.response.status;
                    const errorData = error.response.data;
                    
                    console.error(`[TTS] Erro da API ElevenLabs (${status}):`, errorData);
                    
                    switch (status) {
                        case 401:
                            throw new Error("Chave da API ElevenLabs inválida ou expirada");
                        case 429:
                            if (attempt <= this.maxRetries) {
                                const waitTime = Math.min(1000 * Math.pow(2, attempt), 10000);
                                console.log(`[TTS] Rate limit atingido. Aguardando ${waitTime}ms antes de tentar novamente...`);
                                await this.sleep(waitTime);
                                continue;
                            }
                            throw new Error("Limite de requisições excedido. Tente novamente em alguns minutos");
                        case 422:
                            throw new Error("Dados inválidos enviados para a API ElevenLabs");
                        case 500:
                        case 502:
                        case 503:
                            if (attempt <= this.maxRetries) {
                                const waitTime = 2000 * attempt;
                                console.log(`[TTS] Erro do servidor (${status}). Tentando novamente em ${waitTime}ms...`);
                                await this.sleep(waitTime);
                                continue;
                            }
                            throw new Error(`Erro interno do servidor ElevenLabs (${status})`);
                        default:
                            throw new Error(`Erro da API ElevenLabs (${status}): ${errorData?.detail || 'Erro desconhecido'}`);
                    }
                } else if (error.code === 'ECONNABORTED') {
                    if (attempt <= this.maxRetries) {
                        console.log(`[TTS] Timeout na requisição. Tentando novamente...`);
                        continue;
                    }
                    throw new Error("Timeout na requisição - servidor muito lento");
                } else if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
                    throw new Error("Falha na conexão com o serviço ElevenLabs");
                } else {
                    if (attempt <= this.maxRetries) {
                        console.log(`[TTS] Erro inesperado: ${error.message}. Tentando novamente...`);
                        continue;
                    }
                    throw new Error(`Falha na conversão de texto para áudio: ${error.message}`);
                }
            }
        }
    }
    
    /**
     * Lista as vozes disponíveis na conta ElevenLabs
     * @param {boolean} useCache - Se deve usar cache
     * @returns {Promise<Array>} - Lista de vozes disponíveis
     */
    async listarVozes(useCache = true) {
        // Verificar cache
        if (useCache && this.voicesCache && this.voicesCacheExpiry && Date.now() < this.voicesCacheExpiry) {
            console.log('[TTS] Usando cache de vozes');
            return this.voicesCache;
        }
        
        try {
            console.log('[TTS] Buscando lista de vozes da API...');
            
            const response = await axios.get(
                `${this.baseURL}/voices`,
                {
                    headers: {
                        "xi-api-key": this.apiKey
                    },
                    timeout: this.timeout
                }
            );
            
            if (!response.data || !response.data.voices) {
                throw new Error("Resposta inválida da API de vozes");
            }
            
            const voices = response.data.voices.map(voice => ({
                voice_id: voice.voice_id,
                name: voice.name,
                category: voice.category,
                description: voice.description,
                labels: voice.labels,
                language: voice.labels?.language || 'unknown',
                gender: voice.labels?.gender || 'unknown',
                age_range: voice.labels?.age_range || 'unknown',
                preview_url: voice.preview_url
            }));
            
            // Atualizar cache
            this.voicesCache = voices;
            this.voicesCacheExpiry = Date.now() + (this.cacheValidityMinutes * 60 * 1000);
            
            console.log(`[TTS] ${voices.length} vozes carregadas com sucesso`);
            
            return voices;
            
        } catch (error) {
            console.error("[TTS] Erro ao listar vozes:", error.response?.data || error.message);
            
            if (error.response?.status === 401) {
                throw new Error("Chave da API ElevenLabs inválida");
            }
            
            throw new Error("Falha ao obter lista de vozes da ElevenLabs");
        }
    }
    
    /**
     * Busca uma voz específica por ID ou nome
     * @param {string} identifier - ID ou nome da voz
     * @returns {Promise<Object|null>} - Dados da voz ou null se não encontrada
     */
    async buscarVoz(identifier) {
        try {
            const voices = await this.listarVozes();
            
            return voices.find(voice => 
                voice.voice_id === identifier || 
                voice.name.toLowerCase().includes(identifier.toLowerCase())
            ) || null;
            
        } catch (error) {
            console.error("[TTS] Erro ao buscar voz:", error.message);
            return null;
        }
    }
    
    /**
     * Obtém vozes em português
     * @returns {Promise<Array>} - Lista de vozes em português
     */
    async getVozesPortugues() {
        try {
            const voices = await this.listarVozes();
            
            return voices.filter(voice => 
                voice.language === 'portuguese' || 
                voice.name.toLowerCase().includes('portuguese') ||
                voice.name.toLowerCase().includes('brazilian') ||
                voice.description?.toLowerCase().includes('portuguese') ||
                voice.description?.toLowerCase().includes('brazilian')
            );
            
        } catch (error) {
            console.error("[TTS] Erro ao filtrar vozes em português:", error.message);
            return [];
        }
    }
    
    /**
     * Valida se uma voz existe e está disponível
     * @param {string} voiceId - ID da voz para validar
     * @returns {Promise<boolean>} - Se a voz está disponível
     */
    async validarVoz(voiceId) {
        try {
            const voice = await this.buscarVoz(voiceId);
            return voice !== null;
        } catch (error) {
            console.error("[TTS] Erro ao validar voz:", error.message);
            return false;
        }
    }
    
    /**
     * Obtém informações da conta ElevenLabs
     * @returns {Promise<Object>} - Informações da conta
     */
    async getInfoConta() {
        try {
            const response = await axios.get(
                `${this.baseURL}/user`,
                {
                    headers: {
                        "xi-api-key": this.apiKey
                    },
                    timeout: this.timeout
                }
            );
            
            return {
                subscription: response.data.subscription,
                character_count: response.data.subscription?.character_count || 0,
                character_limit: response.data.subscription?.character_limit || 0,
                can_extend_character_limit: response.data.subscription?.can_extend_character_limit || false,
                allowed_to_extend_character_limit: response.data.subscription?.allowed_to_extend_character_limit || false,
                next_character_count_reset_unix: response.data.subscription?.next_character_count_reset_unix || 0
            };
            
        } catch (error) {
            console.error("[TTS] Erro ao obter info da conta:", error.response?.data || error.message);
            throw new Error("Falha ao obter informações da conta ElevenLabs");
        }
    }
    
    /**
     * Verifica se há caracteres suficientes na conta
     * @param {number} textLength - Tamanho do texto a ser convertido
     * @returns {Promise<boolean>} - Se há caracteres suficientes
     */
    async verificarLimiteCaracteres(textLength) {
        try {
            const accountInfo = await this.getInfoConta();
            const remaining = accountInfo.character_limit - accountInfo.character_count;
            
            console.log(`[TTS] Caracteres restantes: ${remaining}/${accountInfo.character_limit}`);
            
            return remaining >= textLength;
            
        } catch (error) {
            console.error("[TTS] Erro ao verificar limite de caracteres:", error.message);
            // Em caso de erro, assumir que há limite suficiente para não bloquear o serviço
            return true;
        }
    }
    
    /**
     * Salva áudio base64 em arquivo (útil para debug)
     * @param {string} audioBase64 - Áudio em base64
     * @param {string} filePath - Caminho do arquivo
     */
    static salvarAudioBase64(audioBase64, filePath) {
        try {
            const fs = require('fs');
            const buffer = Buffer.from(audioBase64, 'base64');
            fs.writeFileSync(filePath, buffer);
            console.log(`[TTS] Áudio salvo em: ${filePath}`);
        } catch (error) {
            console.error("[TTS] Erro ao salvar arquivo:", error.message);
            throw new Error("Falha ao salvar o arquivo de áudio");
        }
    }
    
    /**
     * Função auxiliar para pausar execução
     * @param {number} ms - Milissegundos para aguardar
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    
    /**
     * Limpa o cache de vozes
     */
    limparCache() {
        this.voicesCache = null;
        this.voicesCacheExpiry = null;
        console.log('[TTS] Cache de vozes limpo');
    }
    
    /**
     * Obtém estatísticas do serviço
     * @returns {Object} - Estatísticas básicas
     */
    getEstatisticas() {
        return {
            voicesCached: this.voicesCache ? this.voicesCache.length : 0,
            cacheValid: this.voicesCacheExpiry ? Date.now() < this.voicesCacheExpiry : false,
            defaultVoiceId: this.defaultVoiceId,
            timeout: this.timeout,
            maxRetries: this.maxRetries
        };
    }
}

module.exports = TtsService;