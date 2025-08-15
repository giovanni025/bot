const moment = require('moment');

class AnalyticsService {
    constructor(database) {
        this.db = database;
    }

    async trackEvent(eventType, userId = null, data = null) {
        try {
            await this.db.run(
                'INSERT INTO analytics (event_type, user_id, data, timestamp) VALUES (?, ?, ?, CURRENT_TIMESTAMP)',
                [eventType, userId, JSON.stringify(data)]
            );
        } catch (error) {
            console.error('Erro ao rastrear evento:', error);
        }
    }

    async getDailyStats(days = 7) {
        try {
            const stats = await this.db.all(`
                SELECT 
                    DATE(timestamp) as date,
                    COUNT(*) as total_events,
                    COUNT(DISTINCT user_id) as unique_users,
                    SUM(CASE WHEN event_type = 'message_received' THEN 1 ELSE 0 END) as messages_received,
                    SUM(CASE WHEN event_type = 'message_sent' THEN 1 ELSE 0 END) as messages_sent
                FROM analytics 
                WHERE timestamp >= datetime('now', '-${days} days')
                GROUP BY DATE(timestamp)
                ORDER BY date DESC
            `);

            return stats;
        } catch (error) {
            console.error('Erro ao buscar estatísticas diárias:', error);
            throw error;
        }
    }

    async getPopularIntents(limit = 10) {
        try {
            return await this.db.all(`
                SELECT 
                    intent,
                    COUNT(*) as count,
                    AVG(confidence) as avg_confidence
                FROM messages 
                WHERE intent IS NOT NULL 
                AND timestamp >= datetime('now', '-30 days')
                GROUP BY intent
                ORDER BY count DESC
                LIMIT ?
            `, [limit]);
        } catch (error) {
            console.error('Erro ao buscar intenções populares:', error);
            throw error;
        }
    }

    async getEmotionalAnalysis() {
        try {
            const emotions = await this.db.all(`
                SELECT 
                    emotions,
                    COUNT(*) as count
                FROM messages 
                WHERE emotions IS NOT NULL 
                AND emotions != 'null'
                AND timestamp >= datetime('now', '-30 days')
            `);

            const emotionCounts = {};
            emotions.forEach(row => {
                try {
                    const emotionData = JSON.parse(row.emotions);
                    Object.keys(emotionData).forEach(emotion => {
                        if (emotionData[emotion]) {
                            emotionCounts[emotion] = (emotionCounts[emotion] || 0) + row.count;
                        }
                    });
                } catch (e) {
                    // Ignorar erros de parsing
                }
            });

            return Object.entries(emotionCounts)
                .map(([emotion, count]) => ({ emotion, count }))
                .sort((a, b) => b.count - a.count);
        } catch (error) {
            console.error('Erro ao analisar emoções:', error);
            throw error;
        }
    }

    async getConversionFunnel() {
        try {
            const funnel = await this.db.get(`
                SELECT 
                    COUNT(DISTINCT CASE WHEN event_type = 'user_started' THEN user_id END) as visitors,
                    COUNT(DISTINCT CASE WHEN event_type = 'service_viewed' THEN user_id END) as service_views,
                    COUNT(DISTINCT CASE WHEN event_type = 'price_viewed' THEN user_id END) as price_views,
                    COUNT(DISTINCT CASE WHEN event_type = 'example_requested' THEN user_id END) as example_requests,
                    COUNT(DISTINCT CASE WHEN event_type = 'support_requested' THEN user_id END) as support_requests
                FROM analytics 
                WHERE timestamp >= datetime('now', '-30 days')
            `);

            return funnel;
        } catch (error) {
            console.error('Erro ao calcular funil de conversão:', error);
            throw error;
        }
    }
}

module.exports = AnalyticsService;