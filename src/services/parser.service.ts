import { pipelineService } from './pipeline.service';
import { logger } from '../utils/logger';
import { IPendingClarification } from '../models/User';

export interface ParsedItem {
  type: 'income' | 'expense' | 'gain' | 'loss' | null;
  amount: number | null;
  currency: string;
  category: string | null;
  description: string;
  date: string;
  business_name: string | null;
}

export interface ParsedResponse {
  needs_clarification: boolean;
  clarification_question: string | null;
  is_batch: boolean;
  items: ParsedItem[];

  // Non-transaction intents
  isSummaryQuery?: boolean;
  queryPeriod?: 'today' | 'week' | 'month';
  isExportRequest?: boolean;
  exportFormat?: 'excel' | 'pdf' | 'csv' | 'unspecified';
  isCorrection?: boolean;
  correctedCategory?: string;
  rawText: string;
}

export interface ParserContext {
  business_name: string | null;
  known_categories: string[];
  today_date: string;
  is_batch?: boolean;
  pendingClarification?: IPendingClarification | null;
}

export function normalizeNigerianMarketNumbers(text: string): string {
  if (!text) return '';

  return text
    // 1. Normalize currency symbols and code prefixes: ₦, #, NGN, N (when preceding a number)
    .replace(/(?:₦|#|NGN\s*|N\s*)(?=\d)/gi, '')

    // 2. Handle numbers with commas like 45,000 or 1,250,000 -> 45000 or 1250000
    .replace(/\b(\d{1,3}(?:,\d{3})+)(\.\d+)?\b/g, (_, intPart, decPart) => {
      return intPart.replace(/,/g, '') + (decPart || '');
    })

    // 3. Handle shorthand combinations like "2k5", "3k500", "10k5" -> 2500, 3500, 10500
    .replace(/\b(\d+)\s*k\s*(\d{1,3})\b(?![a-z])/gi, (_, thousands, hundreds) => {
      const h = hundreds.padEnd(3, '0').substring(0, 3);
      return String(parseInt(thousands, 10) * 1000 + parseInt(h, 10));
    })

    // 4. Handle "1m2" -> 1200000
    .replace(/\b(\d+)\s*m\s*(\d{1,3})\b(?![a-z])/gi, (_, millions, hundreds) => {
      const h = hundreds.padEnd(3, '0').substring(0, 3);
      return String(parseInt(millions, 10) * 1000000 + parseInt(h, 10) * 1000);
    })

    // 5. Generic k / thousand (e.g. 1k, 5k, 2.4k, 600k, 600 thousand)
    .replace(/\b(\d+(?:\.\d+)?)\s*(?:k|thousand)\b(?![a-z])/gi, (_, n) => {
      return String(Math.round(parseFloat(n) * 1000));
    })

    // 6. Generic m / million (e.g. 1m, 1.5m, 600m, 600 million)
    .replace(/\b(\d+(?:\.\d+)?)\s*(?:m|million)\b(?![a-z])/gi, (_, n) => {
      return String(Math.round(parseFloat(n) * 1000000));
    })

    // 7. Generic b / billion (e.g. 600b, 600 billion)
    .replace(/\b(\d+(?:\.\d+)?)\s*(?:b|billion)\b(?![a-z])/gi, (_, n) => {
      return String(Math.round(parseFloat(n) * 1000000000));
    });
}

export class ParserService {
  /**
   * Parse user text message into structured intent & transaction data using 2-stage pipeline
   */
  async parseUserMessage(userMessage: string, context?: ParserContext): Promise<ParsedResponse | null> {
    try {
      const todayDate = context?.today_date || new Date().toISOString().split('T')[0];
      const businessName = context?.business_name || null;
      const knownCategories = context?.known_categories || ['Sales', 'Inventory', 'Transport', 'Utilities', 'Salaries', 'Rent', 'Food', 'Fuel', 'Other'];
      const pendingClarification = context?.pendingClarification || null;

      // STAGE 1: Intent Classification
      const intent = await pipelineService.classifyIntent(userMessage, pendingClarification);

      // Determine period helper
      let queryPeriod: 'today' | 'week' | 'month' = 'month';
      const lower = userMessage.toLowerCase();
      if (lower.includes('today') || lower.includes('for today') || lower.includes("today's")) {
        queryPeriod = 'today';
      } else if (lower.includes('week') || lower.includes('this week')) {
        queryPeriod = 'week';
      }

      if (intent === 'report_request') {
        const isExplicitExport = ['export', 'csv', 'excel', 'xlsx', 'pdf', 'file', 'document', 'download'].some(k => lower.includes(k));
        const asksForReport = lower.includes('send my report') || lower.includes('send report') || lower.includes('get report');

        const isExportRequest = isExplicitExport || asksForReport;

        let exportFormat: 'excel' | 'pdf' | 'csv' | 'unspecified' = 'unspecified';
        if (lower.includes('excel') || lower.includes('xlsx')) {
          exportFormat = 'excel';
        } else if (lower.includes('pdf')) {
          exportFormat = 'pdf';
        } else if (lower.includes('csv')) {
          exportFormat = 'csv';
        }

        return {
          needs_clarification: false,
          clarification_question: null,
          is_batch: false,
          items: [],
          isSummaryQuery: !isExportRequest,
          isExportRequest,
          exportFormat,
          queryPeriod,
          rawText: userMessage,
        };
      }

      if (intent === 'correction') {
        const categoryMap: [string, string][] = [
          ['rent', 'Rent'], ['sales', 'Sales'], ['sale', 'Sales'], ['transport', 'Transport'],
          ['inventory', 'Inventory'], ['stock', 'Inventory'], ['salary', 'Salaries'],
          ['salaries', 'Salaries'], ['utility', 'Utilities'], ['fuel', 'Fuel'],
        ];
        const match = categoryMap.find(([kw]) => lower.includes(kw));
        return {
          needs_clarification: false,
          clarification_question: null,
          is_batch: false,
          items: [],
          isCorrection: true,
          correctedCategory: match ? match[1] : 'Rent',
          rawText: userMessage,
        };
      }

      // STAGE 2a: Extraction for new_transaction or clarification_reply
      const extracted = await pipelineService.extractTransaction(userMessage, knownCategories);

      const itemType = extracted.type === 'unclear' ? null : extracted.type;

      return {
        needs_clarification: extracted.needsClarification,
        clarification_question: extracted.clarificationQuestion,
        is_batch: Boolean(context?.is_batch),
        isSummaryQuery: false,
        isExportRequest: false,
        isCorrection: false,
        items: [
          {
            type: itemType,
            amount: extracted.amount,
            currency: 'NGN',
            category: extracted.category,
            description: extracted.description,
            date: todayDate,
            business_name: businessName,
          },
        ],
        rawText: userMessage,
      };
    } catch (error) {
      logger.error('Failed to parse user message with pipeline:', error);
      return null;
    }
  }
}

export const parserService = new ParserService();
