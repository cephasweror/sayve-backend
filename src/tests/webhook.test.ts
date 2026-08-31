import { Request, Response } from 'express';

// ── Mock all services before importing the controller ──────────────────────
jest.mock('../services/whatsapp.service', () => ({
  whatsappService: {
    sendTextMessage: jest.fn().mockResolvedValue(true),
    downloadAudioBuffer: jest.fn().mockResolvedValue(Buffer.from('mock_audio')),
    downloadImageBuffer: jest.fn().mockResolvedValue(Buffer.from('mock_image')),
    uploadMedia: jest.fn().mockResolvedValue('mock_media_id'),
    sendDocumentMessage: jest.fn().mockResolvedValue(true),
  },
}));

jest.mock('../services/audio.service', () => ({
  audioService: {
    transcribeAudio: jest.fn().mockResolvedValue('sold 5 bags of rice for 25000'),
  },
}));

jest.mock('../services/image.service', () => ({
  imageService: {
    analyzeReceiptImage: jest.fn().mockResolvedValue('spent 3500 on generator fuel'),
  },
}));

jest.mock('../services/onboarding.service', () => ({
  onboardingService: {
    getOrCreateUser: jest.fn().mockResolvedValue({
      _id: 'user_id_123',
      phoneNumber: '2348012345678',
      businessName: 'Test Shop',
      currency: 'NGN',
      onboardingState: 'COMPLETED',
      save: jest.fn().mockResolvedValue(true),
    }),
    processOnboardingStep: jest.fn().mockResolvedValue(false),
  },
}));

jest.mock('../services/parser.service', () => ({
  parserService: {
    parseUserMessage: jest.fn().mockResolvedValue({
      needs_clarification: false,
      clarification_question: null,
      is_batch: false,
      isSummaryQuery: false,
      isExportRequest: false,
      isCorrection: false,
      rawText: 'sold 3 bags of rice for 45000',
      items: [
        {
          type: 'income',
          amount: 45000,
          currency: 'NGN',
          category: 'Sales',
          description: 'sold rice',
          date: '2026-08-27',
          business_name: 'Test Shop',
        },
      ],
    }),
  },
}));

jest.mock('../models/Transaction', () => ({
  Transaction: {
    create: jest.fn().mockResolvedValue({
      _id: 'tx_id_123',
      type: 'income',
      amount: 45000,
      category: 'Sales',
      description: 'sold rice',
    }),
    findById: jest.fn().mockResolvedValue(null),
    distinct: jest.fn().mockResolvedValue(['Sales', 'Transport', 'Rent']),
  },
}));

jest.mock('../services/summary.service', () => ({
  summaryService: { getSummary: jest.fn().mockResolvedValue('Summary text') },
}));

jest.mock('../services/export.service', () => ({
  exportService: { exportAndSendReport: jest.fn().mockResolvedValue(true) },
}));

jest.mock('../config/env', () => ({
  env: {
    WHATSAPP_VERIFY_TOKEN: 'sayve_webhook_secret_token',
    PORT: '3000',
    NODE_ENV: 'test',
  },
}));

// ── Import controller AFTER mocks ──────────────────────────────────────────
import { webhookController } from '../controllers/webhook.controller';

// ── Helpers ────────────────────────────────────────────────────────────────
function buildMockRes() {
  const res: Partial<Response> = {
    status: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
    sendStatus: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  return res as Response;
}

function buildMetaPayload(messageObj: object) {
  return {
    object: 'whatsapp_business_account',
    entry: [{
      changes: [{
        value: {
          messages: [messageObj],
        },
      }],
    }],
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────
describe('WebhookController', () => {

  describe('verifyWebhook (GET)', () => {
    it('should return 200 and echo the challenge when verify token matches', () => {
      const req = {
        query: {
          'hub.mode': 'subscribe',
          'hub.verify_token': 'sayve_webhook_secret_token',
          'hub.challenge': 'CHALLENGE_ABC',
        },
      } as unknown as Request;
      const res = buildMockRes();

      webhookController.verifyWebhook(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.send).toHaveBeenCalledWith('CHALLENGE_ABC');
    });

    it('should return 403 when verify token does not match', () => {
      const req = {
        query: {
          'hub.mode': 'subscribe',
          'hub.verify_token': 'WRONG_TOKEN',
          'hub.challenge': 'CHALLENGE_XYZ',
        },
      } as unknown as Request;
      const res = buildMockRes();

      webhookController.verifyWebhook(req, res);

      expect(res.sendStatus).toHaveBeenCalledWith(403);
    });
  });

  describe('handleIncomingMessage (POST)', () => {
    it('should return 200 EVENT_RECEIVED immediately for any valid POST', async () => {
      const req = {
        body: buildMetaPayload({
          from: '2348012345678',
          type: 'text',
          text: { body: 'sold 3 bags of rice for 45000' },
        }),
      } as unknown as Request;
      const res = buildMockRes();

      await webhookController.handleIncomingMessage(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.send).toHaveBeenCalledWith('EVENT_RECEIVED');
    });

    it('should ignore non-whatsapp_business_account objects gracefully', async () => {
      const req = {
        body: { object: 'page', entry: [] },
      } as unknown as Request;
      const res = buildMockRes();

      await webhookController.handleIncomingMessage(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('should handle image message by downloading and analyzing receipt photo', async () => {
      const { whatsappService } = require('../services/whatsapp.service');
      const { imageService } = require('../services/image.service');
      const req = {
        body: buildMetaPayload({
          from: '2348012345678',
          type: 'image',
          image: { id: 'img_media_id_123', mime_type: 'image/jpeg' },
        }),
      } as unknown as Request;
      const res = buildMockRes();

      await webhookController.handleIncomingMessage(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(whatsappService.downloadImageBuffer).toHaveBeenCalledWith('img_media_id_123');
      expect(imageService.analyzeReceiptImage).toHaveBeenCalled();
    });

    it('should handle audio message by downloading and transcribing', async () => {
      const { whatsappService } = require('../services/whatsapp.service');
      const { audioService } = require('../services/audio.service');
      const req = {
        body: buildMetaPayload({
          from: '2348012345678',
          type: 'audio',
          audio: { id: 'audio_media_id_123', mime_type: 'audio/ogg; codecs=opus' },
        }),
      } as unknown as Request;
      const res = buildMockRes();

      await webhookController.handleIncomingMessage(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(whatsappService.downloadAudioBuffer).toHaveBeenCalledWith('audio_media_id_123');
      expect(audioService.transcribeAudio).toHaveBeenCalled();
    });

    it('should respond to "help" command with command list', async () => {
      const { whatsappService } = require('../services/whatsapp.service');
      const req = {
        body: buildMetaPayload({
          from: '2348012345678',
          type: 'text',
          text: { body: 'help' },
        }),
      } as unknown as Request;
      const res = buildMockRes();

      await webhookController.handleIncomingMessage(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      const lastCall = whatsappService.sendTextMessage.mock.calls.at(-1);
      expect(lastCall[1]).toContain('Sayve Commands');
    });
  });
});
