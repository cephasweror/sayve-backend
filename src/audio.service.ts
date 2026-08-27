import { Groq } from 'groq-sdk';
import { env } from '../config/env';
import { logger } from '../utils/logger';

export class AudioService {
  private groqClient: Groq | null = null;

  constructor() {
    if (env.GROQ_API_KEY && env.GROQ_API_KEY !== 'mock_groq_key') {
      this.groqClient = new Groq({ apiKey: env.GROQ_API_KEY });
    }
  }

  /**
   * Transcribe an audio buffer (ogg/opus from WhatsApp voice notes) using Groq Whisper
   * @param audioBuffer - Raw audio bytes downloaded from WhatsApp
   * @param mimeType - MIME type of the audio (default: 'audio/ogg')
   * @returns Transcribed text, or null if transcription fails
   */
  async transcribeAudio(audioBuffer: Buffer, mimeType: string = 'audio/ogg'): Promise<string | null> {
    // Mock mode when Groq is not configured
    if (!this.groqClient) {
      logger.warn('Groq API Key not configured — cannot transcribe audio in mock mode.');
      return null;
    }

    try {
      logger.info(`Transcribing audio buffer (${audioBuffer.length} bytes) via Groq Whisper...`);

      // Copy the Buffer into a fresh ArrayBuffer to satisfy strict TS BlobPart requirements
      // (Buffer.buffer may be a SharedArrayBuffer which is not assignable to BlobPart)
      const arrayBuffer = audioBuffer.buffer.slice(
        audioBuffer.byteOffset,
        audioBuffer.byteOffset + audioBuffer.byteLength
      ) as ArrayBuffer;
      const audioFile = new File([arrayBuffer], 'voice_note.ogg', { type: mimeType });

      // Use verbose_json to get a strongly-typed response object with a .text field
      const transcription = await this.groqClient.audio.transcriptions.create({
        file: audioFile,
        model: 'whisper-large-v3',
        // No language specified — Whisper auto-detects Nigerian Pidgin/English/mixed input
        response_format: 'verbose_json',
      });

      const transcript = (transcription.text || '').trim();

      if (!transcript) {
        logger.warn('Groq Whisper returned an empty transcript.');
        return null;
      }

      logger.info(`Transcription successful: "${transcript.substring(0, 100)}..."`);
      return transcript;
    } catch (error: any) {
      logger.error('Groq Whisper transcription failed:', error?.message || error);
      return null;
    }
  }
}

export const audioService = new AudioService();
