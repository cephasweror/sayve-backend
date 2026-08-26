import { Router } from 'express';
import { webhookController } from '../controllers/webhook.controller';

const router = Router();

// GET /webhook - Meta Webhook Verification
router.get('/', (req, res) => webhookController.verifyWebhook(req, res));

// POST /webhook - Meta Incoming Webhook Payload
router.post('/', (req, res) => webhookController.handleIncomingMessage(req, res));

export default router;
