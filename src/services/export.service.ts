import { Parser } from 'json2csv';
import { Transaction, ITransaction } from '../models/Transaction';
import { IUser } from '../models/User';
import { whatsappService } from './whatsapp.service';
import { formatDate } from '../utils/formatters';
import { logger } from '../utils/logger';

export class ExportService {
  /**
   * Export last 30 days of transactions as CSV and deliver to user's WhatsApp
   */
  async exportAndSendReport(user: IUser): Promise<boolean> {
    try {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const transactions: ITransaction[] = await Transaction.find({
        userId: user._id,
        date: { $gte: thirtyDaysAgo },
      }).sort({ date: -1 });

      if (transactions.length === 0) {
        await whatsappService.sendTextMessage(
          user.phoneNumber,
          `ℹ️ No transactions recorded in the last 30 days to export for *${user.businessName}*.`
        );
        return true;
      }

      const fields = [
        { label: 'Date', value: (row: ITransaction) => formatDate(row.date) },
        { label: 'Type', value: 'type' },
        { label: 'Category', value: 'category' },
        { label: 'Amount', value: 'amount' },
        { label: 'Description', value: 'description' },
        { label: 'Raw Message', value: 'rawMessage' },
      ];

      const json2csvParser = new Parser({ fields });
      const csvContent = json2csvParser.parse(transactions);
      const csvBuffer = Buffer.from(csvContent, 'utf-8');

      const fileName = `sayve_report_${user.businessName.toLowerCase().replace(/[^a-z0-9]/g, '_')}_30days.csv`;
      logger.info(`Generated CSV export (${csvBuffer.length} bytes) for ${user.phoneNumber}`);

      // 1. Upload media buffer to Meta Graph API
      const mediaId = await whatsappService.uploadMedia(csvBuffer, fileName, 'text/csv');

      if (!mediaId) {
        await whatsappService.sendTextMessage(
          user.phoneNumber,
          '⚠️ Here is your 30-day report preview:\n\n' + csvContent.substring(0, 500) + '...\n\n(Full CSV attachment delivery failed)'
        );
        return false;
      }

      // 2. Deliver CSV document attachment to user on WhatsApp
      const success = await whatsappService.sendDocumentMessage(
        user.phoneNumber,
        mediaId,
        fileName,
        `📄 Here is your 30-day transaction report for ${user.businessName}.`
      );

      return success;
    } catch (error) {
      logger.error('Failed to generate/send CSV export:', error);
      await whatsappService.sendTextMessage(
        user.phoneNumber,
        'Sorry, I encountered an error generating your CSV export report.'
      );
      return false;
    }
  }
}

export const exportService = new ExportService();
