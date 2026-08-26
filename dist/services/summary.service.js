"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.summaryService = exports.SummaryService = void 0;
const Transaction_1 = require("../models/Transaction");
const formatters_1 = require("../utils/formatters");
const logger_1 = require("../utils/logger");
class SummaryService {
    /**
     * Calculate summary totals for a given time period
     */
    async getSummary(user, period = 'month') {
        try {
            const now = new Date();
            let startDate = new Date();
            if (period === 'today') {
                startDate.setHours(0, 0, 0, 0);
            }
            else if (period === 'week') {
                const dayOfWeek = startDate.getDay();
                const distanceToMonday = (dayOfWeek + 6) % 7;
                startDate.setDate(startDate.getDate() - distanceToMonday);
                startDate.setHours(0, 0, 0, 0);
            }
            else {
                // month
                startDate = new Date(now.getFullYear(), now.getMonth(), 1);
            }
            const transactions = await Transaction_1.Transaction.find({
                userId: user._id,
                date: { $gte: startDate, $lte: now },
            });
            let totalIncome = 0;
            let totalExpenses = 0;
            const categoryBreakdown = {};
            for (const tx of transactions) {
                if (tx.type === 'income') {
                    totalIncome += tx.amount;
                }
                else {
                    totalExpenses += tx.amount;
                }
                categoryBreakdown[tx.category] = (categoryBreakdown[tx.category] || 0) + tx.amount;
            }
            const netProfit = totalIncome - totalExpenses;
            const periodLabel = period === 'today' ? 'Today' : period === 'week' ? 'This Week' : 'This Month';
            const currency = user.currency || 'NGN';
            let reply = `📊 *Financial Summary (${periodLabel})*\n`;
            reply += `🏢 *${user.businessName}*\n\n`;
            reply += `💰 *Total Income:* ${(0, formatters_1.formatCurrency)(totalIncome, currency)}\n`;
            reply += `💸 *Total Expenses:* ${(0, formatters_1.formatCurrency)(totalExpenses, currency)}\n`;
            reply += `📈 *Net Profit:* ${(0, formatters_1.formatCurrency)(netProfit, currency)}\n\n`;
            if (Object.keys(categoryBreakdown).length > 0) {
                reply += `*Category Breakdown:*\n`;
                for (const [cat, sum] of Object.entries(categoryBreakdown)) {
                    reply += `• ${cat}: ${(0, formatters_1.formatCurrency)(sum, currency)}\n`;
                }
            }
            else {
                reply += `_No transactions logged for this period yet._`;
            }
            return reply;
        }
        catch (error) {
            logger_1.logger.error('Error generating summary:', error);
            return 'Sorry, I ran into an error generating your financial summary. Please try again.';
        }
    }
}
exports.SummaryService = SummaryService;
exports.summaryService = new SummaryService();
