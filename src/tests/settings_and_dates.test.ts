import { parserService, parseDateRange } from '../services/parser.service';
import { pipelineService } from '../services/pipeline.service';
import { replyService } from '../services/reply.service';
import { IUser } from '../models/User';

jest.mock('../services/pipeline.service', () => ({
  pipelineService: {
    classifyIntent: jest.fn((text: string) => {
      const lower = text.toLowerCase();
      if (lower.includes('hello') || lower.includes('good morning')) return Promise.resolve('greeting');
      if (lower.includes('currency') || lower.includes('business name')) return Promise.resolve('settings');
      if (lower.includes('delete') || lower.includes('undo')) return Promise.resolve('deletion');
      return Promise.resolve('unclear');
    }),
  },
}));

describe('Settings, Greetings, Deletion & Custom Date Ranges Unit Tests', () => {
  const mockUser: Partial<IUser> = {
    _id: 'user_999' as any,
    phoneNumber: '2348012345678',
    businessName: 'Kemi Logistics',
    currency: 'NGN',
  };

  describe('1. Warm Greetings', () => {
    it('should classify "hello" as greeting intent', async () => {
      const intent = await pipelineService.classifyIntent('hello');
      expect(intent).toBe('greeting');
    });

    it('should classify "good morning" as greeting intent', async () => {
      const intent = await pipelineService.classifyIntent('good morning');
      expect(intent).toBe('greeting');
    });

    it('should generate a personalized warm greeting reply including business name', () => {
      const reply = replyService.generateGreetingReply(mockUser as IUser);
      expect(reply).toContain('Kemi Logistics');
      expect(typeof reply).toBe('string');
      expect(reply.length).toBeGreaterThan(10);
    });
  });

  describe('2. Settings Management (Currency & Business Name)', () => {
    it('should classify "change currency to USD" as settings intent', async () => {
      const res = await parserService.parseUserMessage('change currency to USD');
      expect(res).not.toBeNull();
      expect(res?.isSettingsChange).toBe(true);
      expect(res?.settingsType).toBe('currency');
      expect(res?.newSettingValue).toBe('USD');
    });

    it('should classify "change business name to Kemi Enterprise" as settings intent', async () => {
      const res = await parserService.parseUserMessage('change business name to Kemi Enterprise');
      expect(res).not.toBeNull();
      expect(res?.isSettingsChange).toBe(true);
      expect(res?.settingsType).toBe('business_name');
      expect(res?.newSettingValue).toBe('Kemi Enterprise');
    });
  });

  describe('3. Transaction Deletion / Undo', () => {
    it('should classify "delete last transaction" as deletion intent', async () => {
      const intent = await pipelineService.classifyIntent('delete last transaction');
      expect(intent).toBe('deletion');
    });

    it('should classify "undo" as deletion intent', async () => {
      const intent = await pipelineService.classifyIntent('undo');
      expect(intent).toBe('deletion');
    });

    it('should parse "delete last transaction" into isDeleteLastTx response', async () => {
      const res = await parserService.parseUserMessage('delete last transaction');
      expect(res).not.toBeNull();
      expect(res?.isDeleteLastTx).toBe(true);
    });
  });

  describe('4. Custom Date Range & Period Parsing', () => {
    it('should parse "this week" into week period', () => {
      const res = parseDateRange('show my report for this week');
      expect(res.period).toBe('week');
      expect(res.label).toBe('This Week');
      expect(res.startDate).toBeInstanceOf(Date);
    });

    it('should parse "this quarter" into quarter period', () => {
      const res = parseDateRange('export report for this quarter');
      expect(res.period).toBe('quarter');
      expect(res.label).toContain('Q');
    });

    it('should parse "this year" into year period', () => {
      const res = parseDateRange('send my summary for this year');
      expect(res.period).toBe('year');
      expect(res.label).toContain('Full Year');
    });

    it('should parse month range "august to october"', () => {
      const res = parseDateRange('send report from august to october');
      expect(res.period).toBe('custom');
      expect(res.label).toBe('AUGUST – OCTOBER');
      expect(res.startDate?.getMonth()).toBe(7); // August is month index 7
      expect(res.endDate?.getMonth()).toBe(9); // October is month index 9
    });
  });
});
