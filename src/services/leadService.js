class LeadService {
    constructor(database) {
        this.db = database;
    }

    async createLead(userId, source = 'whatsapp', interestLevel = 1) {
        try {
            const existingLead = await this.db.get(
                'SELECT * FROM leads WHERE user_id = ?',
                [userId]
            );

            if (existingLead) {
                // Atualizar lead existente
                await this.db.run(
                    `UPDATE leads SET 
                     interest_level = ?,
                     last_contact = CURRENT_TIMESTAMP,
                     status = 'active'
                     WHERE user_id = ?`,
                    [Math.max(existingLead.interest_level, interestLevel), userId]
                );
                return existingLead;
            } else {
                // Criar novo lead
                const result = await this.db.run(
                    `INSERT INTO leads (user_id, source, interest_level, last_contact, status)
                     VALUES (?, ?, ?, CURRENT_TIMESTAMP, 'new')`,
                    [userId, source, interestLevel]
                );

                return await this.db.get(
                    'SELECT * FROM leads WHERE id = ?',
                    [result.id]
                );
            }
        } catch (error) {
            console.error('Erro ao criar/atualizar lead:', error);
            throw error;
        }
    }

    async updateLeadInterest(userId, interestLevel) {
        try {
            await this.db.run(
                `UPDATE leads SET 
                 interest_level = ?,
                 last_contact = CURRENT_TIMESTAMP
                 WHERE user_id = ?`,
                [interestLevel, userId]
            );
        } catch (error) {
            console.error('Erro ao atualizar interesse do lead:', error);
            throw error;
        }
    }

    async getHotLeads(limit = 20) {
        try {
            return await this.db.all(`
                SELECT l.*, u.phone_number, u.name, u.last_interaction
                FROM leads l
                JOIN users u ON l.user_id = u.id
                WHERE l.status IN ('new', 'active')
                AND l.interest_level >= 3
                ORDER BY l.interest_level DESC, l.last_contact DESC
                LIMIT ?
            `, [limit]);
        } catch (error) {
            console.error('Erro ao buscar leads quentes:', error);
            throw error;
        }
    }

    async getLeadsForFollowup() {
        try {
            const followupDays = await this.db.get(
                'SELECT value FROM settings WHERE key = "lead_followup_days"'
            );
            const days = followupDays ? parseInt(followupDays.value) : 3;

            return await this.db.all(`
                SELECT l.*, u.phone_number, u.name
                FROM leads l
                JOIN users u ON l.user_id = u.id
                WHERE l.status = 'active'
                AND l.last_contact <= datetime('now', '-${days} days')
                AND l.interest_level >= 2
                ORDER BY l.interest_level DESC
            `);
        } catch (error) {
            console.error('Erro ao buscar leads para follow-up:', error);
            throw error;
        }
    }

    async addLeadNote(userId, note) {
        try {
            const existingLead = await this.db.get(
                'SELECT notes FROM leads WHERE user_id = ?',
                [userId]
            );

            if (existingLead) {
                const existingNotes = existingLead.notes || '';
                const timestamp = new Date().toISOString();
                const newNote = `[${timestamp}] ${note}`;
                const updatedNotes = existingNotes ? `${existingNotes}\n${newNote}` : newNote;

                await this.db.run(
                    'UPDATE leads SET notes = ? WHERE user_id = ?',
                    [updatedNotes, userId]
                );
            }
        } catch (error) {
            console.error('Erro ao adicionar nota ao lead:', error);
            throw error;
        }
    }
}

module.exports = LeadService;