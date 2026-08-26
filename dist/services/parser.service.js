"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parserService = exports.ParserService = void 0;
const llm_service_1 = require("./llm.service");
const logger_1 = require("../utils/logger");
const SYSTEM_PROMPT = `
You are an AI bookkeeping parser for Nigerian small business owners using WhatsApp.
Extract the transaction details or user intent from free-text messages (English, Nigerian Pidgin, or mixed phrasing).

Allowed Categories:
- Sales
- Inventory
- Transport
- Utilities
- Salaries
- Rent
- Other

Output ONLY valid JSON with this exact schema:
{
  "isTransaction": boolean,
  "type": "income" | "expense" | null,
  "amount": number | 0,
  "category": "Sales" | "Inventory" | "Transport" | "Utilities" | "Salaries" | "Rent" | "Other" | null,
  "description": string | null,
  "isCorrection": boolean,
  "correctedCategory": string | null,
  "isSummaryQuery": boolean,
  "queryPeriod": "today" | "week" | "month" | null,
  "isExportRequest": boolean
}

Rules:
1. If the user is logging a sale or money received -> type is "income". Default category is "Sales".
2. If the user is logging spending, buying, or paying money -> type is "expense". Choose matching category.
3. If the user says "no, it's Rent" or correcting a category -> isCorrection: true, correctedCategory: "Rent".
4. If the user asks for financial reports ("how much did I make this week", "show expenses this month") -> isSummaryQuery: true.
5. If the user asks to "send my report" or "export csv" -> isExportRequest: true.
6. Convert currency shorthand like "45k" or "45 thousand" to numbers (45000).
`;
class ParserService {
    /**
     * Parse user text message into structured intent & transaction data
     */
    async parseUserMessage(userMessage) {
        try {
            const prompt = `Parse this incoming WhatsApp message from a business owner: "${userMessage}"`;
            const rawJson = await llm_service_1.llmService.generateCompletion(prompt, SYSTEM_PROMPT);
            // Clean JSON string in case backticks or markdown fences were attached
            const cleanJson = rawJson.replace(/```json/g, '').replace(/```/g, '').trim();
            const parsed = JSON.parse(cleanJson);
            const validCategories = ['Sales', 'Inventory', 'Transport', 'Utilities', 'Salaries', 'Rent', 'Other'];
            return {
                isTransaction: Boolean(parsed.isTransaction),
                type: parsed.type === 'expense' ? 'expense' : 'income',
                amount: Math.abs(Number(parsed.amount) || 0),
                category: validCategories.includes(parsed.category) ? parsed.category : (parsed.type === 'income' ? 'Sales' : 'Other'),
                description: parsed.description || userMessage.trim(),
                isCorrection: Boolean(parsed.isCorrection),
                correctedCategory: validCategories.includes(parsed.correctedCategory) ? parsed.correctedCategory : parsed.correctedCategory,
                isSummaryQuery: Boolean(parsed.isSummaryQuery),
                queryPeriod: parsed.queryPeriod || 'month',
                isExportRequest: Boolean(parsed.isExportRequest),
                rawText: userMessage,
            };
        }
        catch (error) {
            logger_1.logger.error('Failed to parse user message with LLM:', error);
            return null;
        }
    }
}
exports.ParserService = ParserService;
exports.parserService = new ParserService();
