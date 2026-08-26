import dns from 'dns';
import mongoose from 'mongoose';
import { env } from './env';
import { logger } from '../utils/logger';

export async function connectDB(): Promise<void> {
  try {
    if (mongoose.connection.readyState >= 1) {
      return;
    }
    // Set fallback public DNS servers (8.8.8.8, 1.1.1.1) to ensure MongoDB Atlas SRV lookup succeeds on all Wi-Fi routers
    try {
      dns.setServers(['8.8.8.8', '1.1.1.1']);
    } catch (dnsErr) {}

    await mongoose.connect(env.MONGODB_URI);
    logger.info('✅ Connected to MongoDB database successfully');
  } catch (error) {
    logger.error('❌ Failed to connect to MongoDB:', error);
    // In production we log error but allow app startup fallback mock mode if DB unavailable
  }
}

export async function disconnectDB(): Promise<void> {
  if (mongoose.connection.readyState >= 1) {
    await mongoose.disconnect();
    logger.info('Disconnected from MongoDB database');
  }
}
