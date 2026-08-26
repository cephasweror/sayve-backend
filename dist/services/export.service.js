"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.exportService = exports.ExportService = void 0;
const json2csv_1 = require("json2csv");
const Transaction_1 = require("../models/Transaction");
const whatsapp_service_1 = require("./whatsapp.service");
const formatters_1 = require("../utils/formatters");
const logger_1 = require("../utils/logger");
class ExportService {
    /**
     * Export last 30 days of transactions as CSV and deliver to user's WhatsApp
     */
    async exportAndSendReport(user) {
        try {
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
            const transactions = await Transaction_1.Transaction.find({
                userId: user._id,
                date: { $gte: thirtyDaysAgo },
            }).sort({ date: -1 });
            if (transactions.length === 0) {
                await whatsapp_service_1.whatsappService.sendTextMessage(user.phoneNumber, `ℹ️ No transactions recorded in the last 30 days to export for *${user.businessName}*.`);
                return true;
            }
            const fields = [
                { label: 'Date', value: (row) => (0, formatters_1.formatDate)(row.date) },
                { label: 'Type', value: 'type' },
                { label: 'Category', value: 'category' },
                { label: 'Amount', value: 'amount' },
                { label: 'Description', value: 'description' },
                { label: 'Raw Message', value: 'rawMessage' },
            ];
            const json2csvParser = new json2csv_1.Parser({ fields });
            const csvContent = json2csvParser.parse(transactions);
            const csvBuffer = Buffer.from(csvContent, 'utf-8');
            const fileName = `sayve_report_${user.businessName.toLowerCase().replace(/[^a-z0-9]/g, '_')}_30days.csv`;
            logger_1.logger.info(`Generated CSV export (${csvBuffer.length} bytes) for ${user.phoneNumber}`);
            // 1. Upload media buffer to Meta Graph API
            const mediaId = await whatsapp_service_1.whatsappService.uploadMedia(csvBuffer, fileName, 'text/csv');
            if (!mediaId) {
                await whatsapp_service_1.whatsappService.sendTextMessage(user.phoneNumber, '⚠️ Here is your 30-day report preview:\n\n' + csvContent.substring(0, 500) + '...\n\n(Full CSV attachment delivery failed)');
                return false;
            }
            // 2. Deliver CSV document attachment to user on WhatsApp
            const success = await whatsapp_service_1.whatsappService.sendDocumentMessage(user.phoneNumber, mediaId, fileName, `📄 Here is your 30-day transaction report for ${user.businessName}.`);
            return success;
        }
        catch (error) {
            logger_1.logger.error('Failed to generate/send CSV export:', error);
            await whatsapp_service_1.whatsappService.sendTextMessage(user.phoneNumber, 'Sorry, I encountered an error generating your CSV export report.');
            return false;
        }
    }
}
exports.ExportService = ExportService;
exports.exportService = new ExportService();
