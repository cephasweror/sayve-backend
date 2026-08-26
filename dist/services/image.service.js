"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.imageService = exports.ImageService = void 0;
const generative_ai_1 = require("@google/generative-ai");
const env_1 = require("../config/env");
const logger_1 = require("../utils/logger");
class ImageService {
    geminiClient = null;
    constructor() {
        if (env_1.env.GEMINI_API_KEY && env_1.env.GEMINI_API_KEY !== 'mock_gemini_key') {
            this.geminiClient = new generative_ai_1.GoogleGenerativeAI(env_1.env.GEMINI_API_KEY);
        }
    }
    /**
     * Analyze receipt or product photo using Gemini Flash Vision
     * Extract text description / item breakdown for transaction logging
     */
    async analyzeReceiptImage(imageBuffer, mimeType = 'image/jpeg') {
        if (!this.geminiClient) {
            logger_1.logger.warn('Gemini API Key not configured — using rule-based mock image analysis for development.');
            return 'spent 3500 on groceries (receipt photo analysis mock)';
        }
        try {
            logger_1.logger.info(`Analyzing receipt image (${imageBuffer.length} bytes) via Gemini Flash Vision...`);
            const model = this.geminiClient.getGenerativeModel({ model: 'gemini-1.5-flash' });
            const prompt = `You are a financial receipt reader for small business owners in Nigeria.
Analyze this photo of a receipt, invoice, bank transfer screenshot, or handwritten sales note.
Describe what was bought or sold, the amount paid/received, and the category.
Return a concise single-line description suitable for bookkeeping (e.g. "spent 4500 on generator fuel" or "sold 2 pairs of shoes for 12000").
If the image is completely unreadable or not a receipt/sale image, return nothing.`;
            const imagePart = {
                inlineData: {
                    data: imageBuffer.toString('base64'),
                    mimeType,
                },
            };
            const result = await model.generateContent([prompt, imagePart]);
            const text = result.response.text()?.trim() || '';
            if (!text) {
                logger_1.logger.warn('Gemini Vision returned empty text for receipt image.');
                return null;
            }
            logger_1.logger.info(`Image analysis result: "${text.substring(0, 100)}..."`);
            return text;
        }
        catch (error) {
            logger_1.logger.error('Gemini Vision image analysis failed:', error?.message || error);
            return null;
        }
    }
}
exports.ImageService = ImageService;
exports.imageService = new ImageService();
