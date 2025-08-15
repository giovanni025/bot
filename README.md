# Bot WhatsApp Inteligente Avançado

Um bot WhatsApp com IA contextual, banco de dados SQLite e sistema completo de analytics e gerenciamento de leads.

## 🚀 Funcionalidades

### ✨ Principais
- **IA Contextual**: Análise emocional e detecção de intenções
- **Banco de Dados SQLite**: Persistência completa de dados
- **Analytics Avançados**: Métricas detalhadas de conversas
- **Sistema de Leads**: Gerenciamento automático de prospects
- **Agendamento**: Mensagens programadas e follow-ups automáticos
- **Segurança**: Rate limiting, helmet, CORS

### 📊 Analytics
- Estatísticas diárias de uso
- Análise emocional das conversas
- Funil de conversão
- Intenções mais populares
- Métricas de engajamento

### 🎯 Gerenciamento de Leads
- Classificação automática por interesse
- Follow-up automático
- Notas e histórico completo
- Identificação de leads quentes

### ⏰ Agendamento
- Mensagens programadas
- Follow-ups automáticos
- Limpeza de conversas inativas
- Processamento em background

## 🛠️ Instalação

1. **Clone o repositório**
```bash
git clone <repository-url>
cd whatsapp-bot-enhanced
```

2. **Instale as dependências**
```bash
npm install
```

3. **Configure as variáveis de ambiente**
```bash
cp .env.example .env
# Edite o arquivo .env com suas configurações
```

4. **Execute as migrações do banco**
```bash
npm run migrate
```

5. **Inicie o bot**
```bash
npm start
# ou para desenvolvimento
npm run dev
```

## 📁 Estrutura do Projeto

```
src/
├── app.js                 # Aplicação principal
├── database/
│   └── database.js        # Configuração do SQLite
└── services/
    ├── userService.js     # Gerenciamento de usuários
    ├── conversationService.js # Gerenciamento de conversas
    ├── analyticsService.js    # Sistema de analytics
    ├── leadService.js         # Gerenciamento de leads
    └── schedulerService.js    # Agendamento de tarefas
```

## 🗄️ Banco de Dados

O sistema utiliza SQLite com as seguintes tabelas:

- **users**: Perfis de usuários
- **conversations**: Sessões de conversa
- **messages**: Histórico de mensagens
- **analytics**: Eventos e métricas
- **scheduled_messages**: Mensagens agendadas
- **leads**: Gerenciamento de prospects
- **settings**: Configurações do sistema

## 📈 Endpoints da API

### Status
- `GET /` - Status do sistema

### Analytics
- `GET /analytics` - Dashboard completo de analytics

### Leads
- `GET /leads/hot` - Leads com alto interesse

### Webhook
- `POST /webhook` - Recebimento de mensagens do WhatsApp

## 🔧 Configuração

### Variáveis de Ambiente

| Variável | Descrição | Padrão |
|----------|-----------|---------|
| `EVOLUTION_API_URL` | URL da Evolution API | - |
| `API_KEY` | Chave da API | - |
| `INSTANCE_NAME` | Nome da instância | bot |
| `WEBHOOK_URL` | URL do webhook | - |
| `PORT` | Porta do servidor | 3001 |
| `SYSTEM_URL` | URL do sistema principal | - |
| `REFERRAL_CODE` | Código de referência | AGENT2024 |
| `PRICE_1_5_DAYS` | Preço 1-5 dias | 100 |
| `PRICE_6_10_DAYS` | Preço 6-10 dias | 150 |
| `PRICE_11_15_DAYS` | Preço 11-15 dias | 200 |

## 🤖 Funcionalidades do Bot

### Estados da Conversa
- `INITIAL`: Estado inicial
- `GREETING`: Saudação
- `SHOWING_SERVICE`: Apresentando serviços
- `SHOWING_PRICES`: Mostrando preços
- `SHOWING_EXAMPLE`: Enviando exemplos
- `INTERESTED`: Usuário interessado
- `SUPPORT`: Solicitando suporte

### Análise Emocional
- **URGENTE**: Detecta urgência nas mensagens
- **FRUSTRADO**: Identifica frustração
- **CONFUSO**: Reconhece confusão
- **INTERESSADO**: Detecta interesse
- **EDUCADO**: Identifica cortesia

### Detecção de Intenções
- **atestado_interest**: Interesse em atestados
- **price_inquiry**: Consulta de preços
- **example_request**: Solicitação de exemplos
- **support_needed**: Necessidade de suporte

## 📊 Métricas e Analytics

O sistema coleta automaticamente:
- Número de mensagens por dia
- Usuários únicos
- Taxa de resposta
- Análise emocional
- Funil de conversão
- Intenções mais populares

## 🔄 Agendamento e Automação

### Follow-ups Automáticos
- Executados diariamente às 9h
- Baseados no nível de interesse
- Mensagens personalizadas

### Limpeza Automática
- Conversas inativas são finalizadas
- Executada a cada 6 horas
- Configurável via variáveis de ambiente

## 🛡️ Segurança

- **Rate Limiting**: Proteção contra spam
- **Helmet**: Headers de segurança
- **CORS**: Controle de origem
- **Validação**: Sanitização de dados
- **Logs**: Mascaramento de números sensíveis

## 🚀 Deploy

O bot está pronto para deploy em qualquer plataforma que suporte Node.js:

- Heroku
- Railway
- DigitalOcean
- AWS
- Google Cloud

## 📝 Logs

Os logs são salvos em `logs/bot.log` com formato JSON estruturado:
- Timestamp
- Nível (ERROR, WARN, INFO, DEBUG)
- Mensagem
- Dados adicionais

## 🤝 Contribuição

1. Fork o projeto
2. Crie uma branch para sua feature
3. Commit suas mudanças
4. Push para a branch
5. Abra um Pull Request

## 📄 Licença

MIT License - veja o arquivo LICENSE para detalhes.