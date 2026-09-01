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
            // Calculate date boundaries adjusted for WAT (West Africa Time, UTC+1)
            const WAT_OFFSET = 1 * 60 * 60 * 1000;
            const now = new Date();
            const watNow = new Date(now.getTime() + WAT_OFFSET);
            let startDate;
            if (period === 'today') {
                const watTodayMidnight = new Date(Date.UTC(watNow.getUTCFullYear(), watNow.getUTCMonth(), watNow.getUTCDate(), 0, 0, 0, 0));
                startDate = new Date(watTodayMidnight.getTime() - WAT_OFFSET);
            }
            else if (period === 'week') {
                const dayOfWeek = watNow.getUTCDay();
                const distanceToMonday = (dayOfWeek + 6) % 7;
                const watMondayMidnight = new Date(Date.UTC(watNow.getUTCFullYear(), watNow.getUTCMonth(), watNow.getUTCDate() - distanceToMonday, 0, 0, 0, 0));
                startDate = new Date(watMondayMidnight.getTime() - WAT_OFFSET);
            }
            else {
                // month
                const watMonthFirstMidnight = new Date(Date.UTC(watNow.getUTCFullYear(), watNow.getUTCMonth(), 1, 0, 0, 0, 0));
                startDate = new Date(watMonthFirstMidnight.getTime() - WAT_OFFSET);
            }
            const transactions = await Transaction_1.Transaction.find({
                userId: user._id,
                date: { $gte: startDate, $lte: now },
            });
            let totalIncome = 0;
            let totalExpenses = 0;
            const categoryBreakdown = {};
            for (const tx of transactions) {
                if (tx.type === 'income' || tx.type === 'gain') {
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
            const profitStatus = netProfit >= 0 ? '📈 *Net Profit:*' : '⚠️ *Net Deficit:*';
            let reply = `📊 *Financial Overview (${periodLabel})*\n`;
            if (user.businessName) {
                reply += `🏢 *${user.businessName}*\n`;
            }
            reply += `\n💵 *Total Money In (Sales & Gains):* ${(0, formatters_1.formatCurrency)(totalIncome, currency)}\n`;
            reply += `💸 *Total Money Out (Expenses & Losses):* ${(0, formatters_1.formatCurrency)(totalExpenses, currency)}\n`;
            reply += `${profitStatus} ${(0, formatters_1.formatCurrency)(netProfit, currency)}\n\n`;
            if (Object.keys(categoryBreakdown).length > 0) {
                reply += `*Category Breakdown:*\n`;
                for (const [cat, sum] of Object.entries(categoryBreakdown)) {
                    reply += `• *${cat}:* ${(0, formatters_1.formatCurrency)(sum, currency)}\n`;
                }
            }
            else {
                reply += `_No transactions logged for this period yet._\n`;
            }
            if (netProfit >= 0) {
                reply += `\n💪 *Keep grinding! Your business is growing!* 🚀`;
            }
            else {
                reply += `\n💡 *Tip: Keep tracking your expenses closely to boost your profit margin!*`;
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
