import { GoogleGenerativeAI } from '@google/generative-ai';
import { env } from '../config/env';
import { logger } from '../utils/logger';

export class ImageService {
  private geminiClient: GoogleGenerativeAI | null = null;

  constructor() {
    if (env.GEMINI_API_KEY && env.GEMINI_API_KEY !== 'mock_gemini_key') {
      this.geminiClient = new GoogleGenerativeAI(env.GEMINI_API_KEY);
    }
  }

  /**
   * Analyze receipt or product photo using Gemini Flash Vision
   * Extract text description / item breakdown for transaction logging
   */
  async analyzeReceiptImage(imageBuffer: Buffer, mimeType: string = 'image/jpeg'): Promise<string | null> {
    if (!this.geminiClient) {
      logger.warn('Gemini API Key not configured — using rule-based mock image analysis for development.');
      return 'spent 3500 on groceries (receipt photo analysis mock)';
    }

    try {
      logger.info(`Analyzing receipt image (${imageBuffer.length} bytes) via Gemini Flash Vision...`);

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
        logger.warn('Gemini Vision returned empty text for receipt image.');
        return null;
      }

      logger.info(`Image analysis result: "${text.substring(0, 100)}..."`);
      return text;
    } catch (error: any) {
      logger.error('Gemini Vision image analysis failed:', error?.message || error);
      return null;
    }
  }
}

export const imageService = new ImageService();
