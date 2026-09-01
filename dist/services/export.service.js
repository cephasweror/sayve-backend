"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.exportService = exports.ExportService = void 0;
const json2csv_1 = require("json2csv");
const exceljs_1 = __importDefault(require("exceljs"));
const pdfkit_1 = __importDefault(require("pdfkit"));
const Transaction_1 = require("../models/Transaction");
const whatsapp_service_1 = require("./whatsapp.service");
const formatters_1 = require("../utils/formatters");
const logger_1 = require("../utils/logger");
class ExportService {
    /**
     * Generate Excel report buffer using exceljs
     */
    async generateExcelBuffer(transactions, businessName, periodLabel = '30 Days') {
        const workbook = new exceljs_1.default.Workbook();
        const sheet = workbook.addWorksheet('Financial Report');
        let totalIncome = 0;
        let totalExpenses = 0;
        for (const tx of transactions) {
            if (tx.type === 'income' || tx.type === 'gain') {
                totalIncome += tx.amount;
            }
            else {
                totalExpenses += tx.amount;
            }
        }
        const netProfit = totalIncome - totalExpenses;
        // Header & Summary Block
        sheet.mergeCells('A1:E1');
        const titleCell = sheet.getCell('A1');
        titleCell.value = `${businessName} — Financial Report (${periodLabel})`;
        titleCell.font = { size: 16, bold: true };
        titleCell.alignment = { horizontal: 'center' };
        sheet.addRow([]);
        sheet.addRow(['Summary Metrics']);
        sheet.getRow(3).font = { bold: true };
        sheet.addRow(['Total Income:', totalIncome]);
        sheet.addRow(['Total Expenses:', totalExpenses]);
        sheet.addRow(['Net Profit / (Loss):', netProfit]);
        sheet.getCell('B4').numFmt = '₦#,##0.00';
        sheet.getCell('B5').numFmt = '₦#,##0.00';
        sheet.getCell('B6').numFmt = '₦#,##0.00';
        sheet.getCell('B6').font = { bold: true };
        sheet.addRow([]);
        sheet.addRow([]);
        // Data Table Header
        const headerRow = sheet.addRow(['Date', 'Type', 'Category', 'Description', 'Amount (NGN)']);
        headerRow.font = { bold: true };
        headerRow.eachCell(cell => {
            cell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FFE0E0E0' },
            };
        });
        // Populate Rows
        for (const tx of transactions) {
            const row = sheet.addRow([
                (0, formatters_1.formatDate)(tx.date),
                tx.type.toUpperCase(),
                tx.category,
                tx.description,
                tx.amount,
            ]);
            row.getCell(5).numFmt = '₦#,##0.00';
        }
        // Auto-fit columns
        sheet.columns.forEach(col => {
            let maxLen = 12;
            col.eachCell?.({ includeEmpty: true }, cell => {
                const valStr = cell.value ? String(cell.value) : '';
                if (valStr.length > maxLen)
                    maxLen = valStr.length;
            });
            col.width = Math.min(maxLen + 3, 40);
        });
        const buffer = await workbook.xlsx.writeBuffer();
        return Buffer.from(buffer);
    }
    /**
     * Generate PDF report buffer using pdfkit
     */
    async generatePdfBuffer(transactions, businessName, periodLabel = '30 Days') {
        return new Promise((resolve, reject) => {
            try {
                const doc = new pdfkit_1.default({ margin: 40, size: 'A4' });
                const buffers = [];
                doc.on('data', chunk => buffers.push(chunk));
                doc.on('end', () => resolve(Buffer.concat(buffers)));
                let totalIncome = 0;
                let totalExpenses = 0;
                for (const tx of transactions) {
                    if (tx.type === 'income' || tx.type === 'gain') {
                        totalIncome += tx.amount;
                    }
                    else {
                        totalExpenses += tx.amount;
                    }
                }
                const netProfit = totalIncome - totalExpenses;
                // Title
                doc.fontSize(20).text(businessName, { align: 'center' });
                doc.fontSize(14).fillColor('#666666').text(`Financial Report (${periodLabel})`, { align: 'center' });
                doc.moveDown(1.5);
                // Summary Box
                doc.fontSize(12).fillColor('#000000').text('Summary Overview', { underline: true });
                doc.fontSize(10);
                doc.text(`Total Money In:  ${(0, formatters_1.formatCurrency)(totalIncome, 'NGN')}`);
                doc.text(`Total Money Out: ${(0, formatters_1.formatCurrency)(totalExpenses, 'NGN')}`);
                doc.font('Helvetica-Bold').text(`Net Profit:      ${(0, formatters_1.formatCurrency)(netProfit, 'NGN')}`);
                doc.font('Helvetica');
                doc.moveDown(1.5);
                // Table Header
                doc.fontSize(11).fillColor('#000000').text('Transaction Details', { underline: true });
                doc.moveDown(0.5);
                doc.fontSize(9).font('Helvetica-Bold');
                doc.text('Date', 40, doc.y, { width: 75 });
                const tableTop = doc.y - 12;
                doc.text('Type', 120, tableTop, { width: 65 });
                doc.text('Category', 190, tableTop, { width: 90 });
                doc.text('Description', 285, tableTop, { width: 170 });
                doc.text('Amount', 460, tableTop, { width: 90, align: 'right' });
                doc.moveDown(0.5);
                doc.font('Helvetica').fontSize(8.5);
                let y = doc.y;
                for (const tx of transactions) {
                    if (y > 750) {
                        doc.addPage();
                        y = 50;
                    }
                    doc.text((0, formatters_1.formatDate)(tx.date), 40, y, { width: 75 });
                    doc.text(tx.type.toUpperCase(), 120, y, { width: 65 });
                    doc.text(tx.category, 190, y, { width: 90 });
                    doc.text(tx.description.substring(0, 35), 285, y, { width: 170 });
                    doc.text((0, formatters_1.formatCurrency)(tx.amount, 'NGN'), 460, y, { width: 90, align: 'right' });
                    y += 18;
                }
                doc.end();
            }
            catch (err) {
                reject(err);
            }
        });
    }
    /**
     * Export transactions as Excel (default), PDF, or CSV and deliver to user's WhatsApp
     */
    async exportAndSendReport(user, format = 'excel', periodLabel = '30 Days') {
        const phone = user.phoneNumber;
        const businessName = user.businessName || 'My Business';
        logger_1.logger.info(`[Report Export] Step 1/4: Starting ${format.toUpperCase()} report export pipeline for user ${phone} (${businessName})`);
        try {
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
            const transactions = await Transaction_1.Transaction.find({
                userId: user._id,
                date: { $gte: thirtyDaysAgo },
            }).sort({ date: -1 });
            logger_1.logger.info(`[Report Export] Step 1/4: Retrieved ${transactions.length} transactions from DB for ${phone}`);
            if (transactions.length === 0) {
                await whatsapp_service_1.whatsappService.sendTextMessage(phone, `ℹ️ No transactions recorded in the last 30 days to export for *${businessName}*.`);
                return true;
            }
            let buffer;
            let fileName;
            let mimeType;
            const safeBizName = businessName.toLowerCase().replace(/[^a-z0-9]/g, '_');
            if (format === 'pdf') {
                buffer = await this.generatePdfBuffer(transactions, businessName, periodLabel);
                fileName = `sayve_report_${safeBizName}.pdf`;
                mimeType = 'application/pdf';
            }
            else if (format === 'csv') {
                const fields = [
                    { label: 'Date', value: (row) => (0, formatters_1.formatDate)(row.date) },
                    { label: 'Type', value: 'type' },
                    { label: 'Category', value: 'category' },
                    { label: 'Amount', value: 'amount' },
                    { label: 'Description', value: 'description' },
                ];
                const json2csvParser = new json2csv_1.Parser({ fields });
                const csvContent = json2csvParser.parse(transactions);
                buffer = Buffer.from(csvContent, 'utf-8');
                fileName = `sayve_report_${safeBizName}.csv`;
                mimeType = 'text/csv';
            }
            else {
                // Excel default
                buffer = await this.generateExcelBuffer(transactions, businessName, periodLabel);
                fileName = `sayve_report_${safeBizName}.xlsx`;
                mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
            }
            logger_1.logger.info(`[Report Export] Step 2/4: Successfully generated ${format.toUpperCase()} buffer (${buffer.length} bytes) for ${phone}`);
            // WhatsApp Media Upload Step
            logger_1.logger.info(`[Report Export] Step 3/4: Uploading buffer to WhatsApp Meta Graph API endpoint for ${phone}...`);
            const mediaId = await whatsapp_service_1.whatsappService.uploadMedia(buffer, fileName, mimeType);
            if (!mediaId) {
                logger_1.logger.error(`[Report Export] Step 3/4 Failed: WhatsApp media upload failed (null mediaId) for ${phone}`);
                await whatsapp_service_1.whatsappService.sendTextMessage(phone, `⚠️ I had trouble attaching your report file. You can try requesting again or view your text summary by asking *"show my summary"*.`);
                return false;
            }
            // WhatsApp Document Delivery Step
            logger_1.logger.info(`[Report Export] Step 4/4: Delivering ${format.toUpperCase()} document message with media ID "${mediaId}" to ${phone}...`);
            const success = await whatsapp_service_1.whatsappService.sendDocumentMessage(phone, mediaId, fileName, `📄 Here is your ${periodLabel} financial report for *${businessName}*.`);
            return success;
        }
        catch (error) {
            logger_1.logger.error(`[Report Export] Pipeline Failed with error for ${phone}:`, error?.stack || error?.message || error);
            await whatsapp_service_1.whatsappService.sendTextMessage(phone, 'Sorry, I encountered an error generating your export report.');
            return false;
        }
    }
}
exports.ExportService = ExportService;
exports.exportService = new ExportService();
