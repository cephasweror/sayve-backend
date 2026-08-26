import express from 'express';
import cors from 'cors';
import { env } from './config/env';
import { connectDB } from './config/database';
import { logger } from './utils/logger';
import webhookRoutes from './routes/webhook.routes';

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health Check Endpoint
app.get('/', (req, res) => {
  res.status(200).json({
    status: 'online',
    app: 'Sayve WhatsApp AI Expense Tracker',
    timestamp: new Date().toISOString(),
  });
});

// Webhook Routes
app.use('/webhook', webhookRoutes);

// Start Server
async function startServer() {
  await connectDB();

  const PORT = parseInt(env.PORT, 10);
  app.listen(PORT, () => {
    logger.info(`🚀 Sayve Express Webhook server running on port ${PORT}`);
    logger.info(`🔗 Webhook Callback URL: http://localhost:${PORT}/webhook`);
    logger.info(`🔑 Verification Token: ${env.WHATSAPP_VERIFY_TOKEN}`);
  });
}

export { app };

if (require.main === module) {
  startServer();
}
