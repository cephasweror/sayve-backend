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
                logger_1.logger.warn('Groq API call failed or rate-limited. Falling back to Gemini Flash:', groqError.message);
            }
        }
        else {
            logger_1.logger.info('Groq API Key not configured, defaulting to Gemini Flash fallback');
        }
        // 2. Fallback LLM: Google Gemini Flash
        if (this.geminiClient) {
            try {
                logger_1.logger.info('Calling Gemini Flash fallback...');
                const fullPrompt = `${systemPrompt ? systemPrompt + '\n\n' : ''}${prompt}`;
                const model = this.geminiClient.getGenerativeModel({ model: 'gemini-1.5-flash' });
                const response = await model.generateContent(fullPrompt);
                const rawOutput = response.response.text() || '';
                logger_1.logger.llm('Google Gemini Flash', prompt, rawOutput);
                if (rawOutput)
                    return rawOutput;
            }
            catch (geminiError) {
                logger_1.logger.error('Gemini Flash API call also failed:', geminiError.message);
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
        // Extract just the user's message from the wrapper prompt to avoid
        // false-positive keyword matches in the prompt prefix (e.g., 'business' → 'bus' → Transport)
        const quoteMatch = prompt.match(/"([^"]+)"/);
        const text = (quoteMatch ? quoteMatch[1] : prompt).toLowerCase();
        // Check if summary query
        if (text.includes('how much') ||
            text.includes('summary') ||
            text.includes('spent this month') ||
            text.includes('expenses this month') ||
            text.includes('show expenses') ||
            text.includes('made this week') ||
            text.includes('made today') ||
            text.includes('income today') ||
            text.includes('profit this')) {
            let queryPeriod = 'month';
            if (text.includes('week'))
                queryPeriod = 'week';
            else if (text.includes('today') || text.includes('today\'s'))
                queryPeriod = 'today';
            return JSON.stringify({
                isTransaction: false,
                isCorrection: false,
                isSummaryQuery: true,
                isExportRequest: false,
                queryPeriod,
            });
        }
        // Check if export request
        if (text.includes('send my report') || text.includes('export') || text.includes('csv')) {
            return JSON.stringify({
                isTransaction: false,
                isCorrection: false,
                isSummaryQuery: false,
                isExportRequest: true,
            });
        }
        // Check if correction request
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
                isTransaction: false,
                isCorrection: true,
                correctedCategory: category,
                isSummaryQuery: false,
                isExportRequest: false,
            });
        }
        // Default: Transaction parsing heuristic
        const isExpense = text.includes('spent') || text.includes('bought') || text.includes('pay') || text.includes('cost');
        const type = isExpense ? 'expense' : 'income';
        // Extract numbers
        const numbers = text.match(/\d+[\d,]*/g);
        let amount = 0;
        if (numbers && numbers.length > 0) {
            const parsedNums = numbers.map(n => parseInt(n.replace(/,/g, ''), 10));
            amount = Math.max(...parsedNums);
        }
        // Category detection
        let category = 'Other';
        if (text.includes('transport') || text.includes('fuel') || text.includes('bus') || text.includes('okada'))
            category = 'Transport';
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
            isTransaction: true,
            type,
            amount,
            category,
            description: text.substring(0, 100),
            isCorrection: false,
            isSummaryQuery: false,
            isExportRequest: false,
        });
    }
}
exports.LLMService = LLMService;
exports.llmService = new LLMService();
