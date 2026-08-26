"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.whatsappService = exports.WhatsAppService = void 0;
const axios_1 = __importDefault(require("axios"));
const env_1 = require("../config/env");
const logger_1 = require("../utils/logger");
class WhatsAppService {
    apiUrl;
    token;
    phoneNumberId;
    constructor() {
        this.token = env_1.env.WHATSAPP_TOKEN;
        this.phoneNumberId = env_1.env.PHONE_NUMBER_ID;
        this.apiUrl = `https://graph.facebook.com/v20.0/${this.phoneNumberId}`;
    }
    /**
     * Send text message back to WhatsApp sender
     */
    async sendTextMessage(to, message) {
        logger_1.logger.info(`Sending WhatsApp message to ${to}: "${message.substring(0, 50)}..."`);
        // In mock development mode if keys are not provided, log and return true
        if (this.token === 'mock_whatsapp_token' || this.phoneNumberId === 'mock_phone_number_id') {
            logger_1.logger.info(`[MOCK WHATSAPP SEND] To: ${to}\nMessage:\n${message}`);
            return true;
        }
        try {
            const response = await axios_1.default.post(`${this.apiUrl}/messages`, {
                messaging_product: 'whatsapp',
                recipient_type: 'individual',
                to,
                type: 'text',
                text: {
                    preview_url: false,
                    body: message,
                },
            }, {
                headers: {
                    Authorization: `Bearer ${this.token}`,
                    'Content-Type': 'application/json',
                },
                timeout: 10000,
            });
            logger_1.logger.info(`WhatsApp message delivered to ${to}. Message ID: ${response.data?.messages?.[0]?.id}`);
            return true;
        }
        catch (error) {
            logger_1.logger.error(`Error sending WhatsApp message to ${to}:`, error?.response?.data || error.message);
            return false;
        }
    }
    /**
     * Upload binary buffer (CSV/PDF) to Meta Graph API Media storage
     */
    async uploadMedia(fileBuffer, fileName, mimeType) {
        if (this.token === 'mock_whatsapp_token') {
            logger_1.logger.info(`[MOCK WHATSAPP MEDIA UPLOAD] Uploaded ${fileName}`);
            return 'mock_media_id_12345';
        }
        try {
            const FormData = require('form-data');
            const form = new FormData();
            form.append('file', fileBuffer, { filename: fileName, contentType: mimeType });
            form.append('messaging_product', 'whatsapp');
            form.append('type', mimeType);
            const response = await axios_1.default.post(`${this.apiUrl}/media`, form, {
                headers: {
                    Authorization: `Bearer ${this.token}`,
                    ...form.getHeaders(),
                },
            });
            return response.data?.id || null;
        }
        catch (error) {
            logger_1.logger.error('Error uploading media to WhatsApp:', error?.response?.data || error.message);
            return null;
        }
    }
    /**
     * Download a WhatsApp voice note audio buffer by media ID
     * Step 1: Fetch the download URL from Meta Graph API media endpoint
     * Step 2: Download the raw audio bytes using the bearer token
     */
    async downloadAudioBuffer(audioMediaId) {
        if (this.token === 'mock_whatsapp_token') {
            logger_1.logger.info(`[MOCK WHATSAPP AUDIO DOWNLOAD] Media ID: ${audioMediaId}`);
            // Return a tiny valid ogg buffer stub for mock/test mode
            return Buffer.from('mock_audio_bytes');
        }
        try {
            // Step 1: Get the media download URL
            const mediaInfoResponse = await axios_1.default.get(`https://graph.facebook.com/v20.0/${audioMediaId}`, {
                headers: { Authorization: `Bearer ${this.token}` },
                timeout: 10000,
            });
            const downloadUrl = mediaInfoResponse.data?.url;
            if (!downloadUrl) {
                logger_1.logger.error(`No download URL returned for media ID: ${audioMediaId}`);
                return null;
            }
            // Step 2: Download the raw audio bytes
            const audioResponse = await axios_1.default.get(downloadUrl, {
                headers: { Authorization: `Bearer ${this.token}` },
                responseType: 'arraybuffer',
                timeout: 30000,
            });
            logger_1.logger.info(`Downloaded audio buffer (${audioResponse.data.byteLength} bytes) for media ID: ${audioMediaId}`);
            return Buffer.from(audioResponse.data);
        }
        catch (error) {
            logger_1.logger.error(`Error downloading audio media ${audioMediaId}:`, error?.response?.data || error.message);
            return null;
        }
    }
    /**
     * Download a WhatsApp image buffer by media ID (receipt photos, etc.)
     * Uses the same two-step Meta media download pattern as audio.
     */
    async downloadImageBuffer(imageMediaId) {
        if (this.token === 'mock_whatsapp_token') {
            logger_1.logger.info(`[MOCK WHATSAPP IMAGE DOWNLOAD] Media ID: ${imageMediaId}`);
            return Buffer.from('mock_image_bytes');
        }
        try {
            // Step 1: Get the media download URL
            const mediaInfoResponse = await axios_1.default.get(`https://graph.facebook.com/v20.0/${imageMediaId}`, {
                headers: { Authorization: `Bearer ${this.token}` },
                timeout: 10000,
            });
            const downloadUrl = mediaInfoResponse.data?.url;
            if (!downloadUrl) {
                logger_1.logger.error(`No download URL returned for image media ID: ${imageMediaId}`);
                return null;
            }
            // Step 2: Download the raw image bytes
            const imageResponse = await axios_1.default.get(downloadUrl, {
                headers: { Authorization: `Bearer ${this.token}` },
                responseType: 'arraybuffer',
                timeout: 30000,
            });
            logger_1.logger.info(`Downloaded image buffer (${imageResponse.data.byteLength} bytes) for media ID: ${imageMediaId}`);
            return Buffer.from(imageResponse.data);
        }
        catch (error) {
            logger_1.logger.error(`Error downloading image media ${imageMediaId}:`, error?.response?.data || error.message);
            return null;
        }
    }
    /**
     * Send document attachment (CSV/PDF) to WhatsApp recipient
     */
    async sendDocumentMessage(to, mediaId, fileName, caption) {
        if (this.token === 'mock_whatsapp_token') {
            logger_1.logger.info(`[MOCK WHATSAPP DOCUMENT SEND] To: ${to}, Media ID: ${mediaId}, File: ${fileName}`);
            return true;
        }
        try {
            const response = await axios_1.default.post(`${this.apiUrl}/messages`, {
                messaging_product: 'whatsapp',
                recipient_type: 'individual',
                to,
                type: 'document',
                document: {
                    id: mediaId,
                    filename: fileName,
                    caption: caption || 'Your Sayve Data Export',
                },
            }, {
                headers: {
                    Authorization: `Bearer ${this.token}`,
                    'Content-Type': 'application/json',
                },
            });
            return !!response.data?.messages?.[0]?.id;
        }
        catch (error) {
            logger_1.logger.error(`Error sending document message to ${to}:`, error?.response?.data || error.message);
            return false;
        }
    }
}
exports.WhatsAppService = WhatsAppService;
exports.whatsappService = new WhatsAppService();
