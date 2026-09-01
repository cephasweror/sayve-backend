"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.llmService = exports.LLMService = void 0;
const groq_sdk_1 = require("groq-sdk");
const generative_ai_1 = require("@google/generative-ai");
const env_1 = require("../config/env");
const logger_1 = require("../utils/logger");
class LLMService {
    groqClient = null;
    geminiClient = null;
    constructor() {
        if (env_1.env.GROQ_API_KEY && env_1.env.GROQ_API_KEY !== 'mock_groq_key') {
            this.groqClient = new groq_sdk_1.Groq({ apiKey: env_1.env.GROQ_API_KEY });
        }
        if (env_1.env.GEMINI_API_KEY && env_1.env.GEMINI_API_KEY !== 'mock_gemini_key') {
            this.geminiClient = new generative_ai_1.GoogleGenerativeAI(env_1.env.GEMINI_API_KEY);
        }
    }
    /**
     * Generate text completion using Groq (Llama 3.3 70B) primary, with Gemini Flash fallback
     */
    async generateCompletion(prompt, systemPrompt) {
        // 1. Try Primary LLM: Groq Llama 3.3 70B
        if (this.groqClient) {
            try {
                logger_1.logger.info('Calling Groq API (llama-3.3-70b-versatile)...');
                const completion = await this.groqClient.chat.completions.create({
                    messages: [
                        ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
                        { role: 'user', content: prompt },
                    ],
                    model: 'llama-3.3-70b-versatile',
                    temperature: 0.1,
                    response_format: { type: 'json_object' },
                });
                const rawOutput = completion.choices[0]?.message?.content || '';
                logger_1.logger.llm('Groq Llama 3.3 70B', prompt, rawOutput);
                if (rawOutput)
                    return rawOutput;
            }
            catch (groqError) {
                logger_1.logger.warn('Groq API call failed or rate-limited:', groqError.message);
            }
        }
        else {
            logger_1.logger.info('Groq API Key not configured, defaulting to Gemini Flash fallback');
        }
        // 2. Fallback LLM: Google Gemini Flash
        if (this.geminiClient) {
            try {
                logger_1.logger.info('Calling Gemini Flash fallback (gemini-1.5-flash)...');
                const fullPrompt = `${systemPrompt ? systemPrompt + '\n\n' : ''}${prompt}`;
                const model = this.geminiClient.getGenerativeModel({ model: 'gemini-1.5-flash' });
                const response = await model.generateContent(fullPrompt);
                const rawOutput = response.response.text() || '';
                logger_1.logger.llm('Google Gemini Flash', prompt, rawOutput);
                if (rawOutput)
                    return rawOutput;
            }
            catch (geminiError) {
                logger_1.logger.warn('Gemini Flash API call failed:', geminiError.message);
            }
        }
        // 3. Heuristic Mock Fallback if no API keys are provided or all failed
        logger_1.logger.warn('Using rule-based mock LLM parser fallback for development');
        return this.mockLLMFallback(prompt);
    }
    /**
     * Rule-based local parser when APIs are offline or unconfigured
     */
    mockLLMFallback(prompt) {
        const userMsgMatch = prompt.match(/Parse this incoming WhatsApp message from a business owner: "([^"]+)"/);
        const text = (userMsgMatch ? userMsgMatch[1] : prompt).toLowerCase().trim();
        const today = new Date().toISOString().split('T')[0];
        // 1. Check if summary query
        if (text.includes('how much') ||
            text.includes('summary') ||
            text.includes('spent this month') ||
            text.includes('expenses this month') ||
            text.includes('show expenses') ||
            text.includes('made this week') ||
            text.includes('made today') ||
            text.includes('income today') ||
            text.includes('profit this') ||
            text.includes('track my money') ||
            text.includes('track money') ||
            text.includes('track expenses') ||
            text.includes('track sales')) {
            let queryPeriod = 'month';
            if (text.includes('week'))
                queryPeriod = 'week';
            else if (text.includes('today') || text.includes('today\'s'))
                queryPeriod = 'today';
            return JSON.stringify({
                needs_clarification: false,
                clarification_question: null,
                is_batch: false,
                isSummaryQuery: true,
                queryPeriod,
                isExportRequest: false,
                isCorrection: false,
                items: [],
            });
        }
        // 2. Check if export request (handles typos like 'cvs', 'excel', 'report', 'download')
        if (text.includes('send my report') ||
            text.includes('export') ||
            text.includes('csv') ||
            text.includes('cvs') ||
            text.includes('report') ||
            text.includes('excel') ||
            text.includes('download') ||
            text.includes('spreadsheet') ||
            text.includes('file')) {
            return JSON.stringify({
                needs_clarification: false,
                clarification_question: null,
                is_batch: false,
                isSummaryQuery: false,
                isExportRequest: true,
                isCorrection: false,
                items: [],
            });
        }
        // 3. Check if correction request
        if (text.startsWith('no,') || text.includes("it's") || text.includes('change category')) {
            let category = 'Other';
            if (text.includes('rent'))
                category = 'Rent';
            else if (text.includes('sales') || text.includes('sale'))
                category = 'Sales';
            else if (text.includes('transport'))
                category = 'Transport';
            else if (text.includes('inventory') || text.includes('stock'))
                category = 'Inventory';
            else if (text.includes('salaries') || text.includes('salary'))
                category = 'Salaries';
            else if (text.includes('utility') || text.includes('bill') || text.includes('nepa'))
                category = 'Utilities';
            return JSON.stringify({
                needs_clarification: false,
                clarification_question: null,
                is_batch: false,
                isSummaryQuery: false,
                isExportRequest: false,
                isCorrection: true,
                correctedCategory: category,
                items: [],
            });
        }
        // Import normalizer
        const { normalizeNigerianMarketNumbers } = require('./parser.service');
        // 4. Transaction parsing heuristic
        const isIncome = text.includes('sold') || text.includes('sale') || text.includes('received') || text.includes('paid me') || text.includes('alert') || text.includes('cash enter') || text.includes('income') || text.includes('made') || text.includes('make') || text.includes('earn') || text.includes('earned') || text.includes('collect');
        const isExpense = text.includes('spent') || text.includes('bought') || text.includes('paid for') || text.includes('pay') || text.includes('cost') || text.includes('chop money') || text.includes('expense');
        const isGain = text.includes('profit') || text.includes('dash') || text.includes('bonus') || text.includes('gain');
        const isLoss = text.includes('loss') || text.includes('lost') || text.includes('spoilt') || text.includes('damaged') || text.includes('stolen') || text.includes('spill') || text.includes('wrote off');
        let type = null;
        if (isLoss)
            type = 'loss';
        else if (isGain)
            type = 'gain';
        else if (isExpense)
            type = 'expense';
        else if (isIncome)
            type = 'income';
        // Normalize Nigerian market numbers (e.g. 3k -> 3000, 2.4k -> 2400, 2k5 -> 2500)
        const normalizedText = normalizeNigerianMarketNumbers(text);
        // Extract numbers
        const numbers = normalizedText.match(/\d+[\d,]*/g);
        let amount = null;
        if (numbers && numbers.length > 0) {
            const parsedNums = numbers.map((n) => parseInt(n.replace(/,/g, ''), 10));
            amount = Math.max(...parsedNums);
        }
        // Check if clarification needed (ambiguous direction e.g. "600000 fuel" without bought/sold/spent)
        if (!type && amount !== null) {
            return JSON.stringify({
                needs_clarification: true,
                clarification_question: "Is this money coming in or going out?",
                is_batch: false,
                items: [
                    {
                        type: null,
                        amount,
                        currency: 'NGN',
                        category: 'Fuel',
                        description: text,
                        date: today,
                        business_name: null,
                    },
                ],
            });
        }
        // Default direction if not explicit
        type = type || (isExpense ? 'expense' : 'income');
        // Category detection
        let category = 'Other';
        if (text.includes('transport') || text.includes('bus') || text.includes('okada') || text.includes('cab'))
            category = 'Transport';
        else if (text.includes('fuel') || text.includes('petrol') || text.includes('diesel') || text.includes('gen'))
            category = 'Fuel';
        else if (text.includes('rice') || text.includes('sold') || text.includes('sales'))
            category = 'Sales';
        else if (text.includes('stock') || text.includes('goods') || text.includes('bag'))
            category = 'Inventory';
        else if (text.includes('light') || text.includes('nepa') || text.includes('water'))
            category = 'Utilities';
        else if (text.includes('rent') || text.includes('shop'))
            category = 'Rent';
        else if (text.includes('salary') || text.includes('staff'))
            category = 'Salaries';
        return JSON.stringify({
            needs_clarification: false,
            clarification_question: null,
            is_batch: false,
            isSummaryQuery: false,
            isExportRequest: false,
            isCorrection: false,
            items: [
                {
                    type,
                    amount: amount || 0,
                    currency: 'NGN',
                    category,
                    description: text.substring(0, 100),
                    date: today,
                    business_name: null,
                },
            ],
        });
    }
}
exports.LLMService = LLMService;
exports.llmService = new LLMService();
