import { parserService } from '../services/parser.service';
import { pipelineService } from '../services/pipeline.service';
import { IPendingClarification } from '../models/User';

describe('Sayve Comprehensive Benchmark Test Suite', () => {
  describe('1. Clear Expenses', () => {
    it('should parse "Spent 5000 on fuel today" as expense', async () => {
      const res = await parserService.parseUserMessage('Spent 5000 on fuel today');
      expect(res).not.toBeNull();
      expect(res?.items[0].type).toBe('expense');
      expect(res?.items[0].amount).toBe(5000);
      expect(res?.items[0].category).toBe('Fuel');
    });

    it('should parse "Paid 25k for inventory restock" as expense with 25000 amount', async () => {
      const res = await parserService.parseUserMessage('Paid 25k for inventory restock');
      expect(res).not.toBeNull();
      expect(res?.items[0].type).toBe('expense');
      expect(res?.items[0].amount).toBe(25000);
    });

    it('should parse "I bought new packaging materials for 8500" as expense', async () => {
      const res = await parserService.parseUserMessage('I bought new packaging materials for 8500');
      expect(res).not.toBeNull();
      expect(res?.items[0].type).toBe('expense');
      expect(res?.items[0].amount).toBe(8500);
    });
  });

  describe('2. Clear Income', () => {
    it('should parse "Sold 3 bags of rice for 45000" as income', async () => {
      const res = await parserService.parseUserMessage('Sold 3 bags of rice for 45000');
      expect(res).not.toBeNull();
      expect(res?.items[0].type).toBe('income');
      expect(res?.items[0].amount).toBe(45000);
      expect(res?.items[0].category).toBe('Sales');
    });

    it('should parse "Made 120k in sales today" as income with 120000', async () => {
      const res = await parserService.parseUserMessage('Made 120k in sales today');
      expect(res).not.toBeNull();
      expect(res?.items[0].type).toBe('income');
      expect(res?.items[0].amount).toBe(120000);
    });

    it('should parse "Received 15000 from a customer" as income', async () => {
      const res = await parserService.parseUserMessage('Received 15000 from a customer');
      expect(res).not.toBeNull();
      expect(res?.items[0].type).toBe('income');
      expect(res?.items[0].amount).toBe(15000);
    });
  });

  describe('3. Shorthand Numbers', () => {
    it('should parse "Spent 600k on rent this month" as 600000', async () => {
      const res = await parserService.parseUserMessage('Spent 600k on rent this month');
      expect(res).not.toBeNull();
      expect(res?.items[0].amount).toBe(600000);
      expect(res?.items[0].category).toBe('Rent');
    });

    it('should parse "Made 1.2m this week" as 1200000', async () => {
      const res = await parserService.parseUserMessage('Made 1.2m this week');
      expect(res).not.toBeNull();
      expect(res?.items[0].amount).toBe(1200000);
    });

    it('should parse "Paid salaries — 600 thousand" as 600000', async () => {
      const res = await parserService.parseUserMessage('Paid salaries — 600 thousand');
      expect(res).not.toBeNull();
      expect(res?.items[0].amount).toBe(600000);
      expect(res?.items[0].category).toBe('Salaries');
    });
  });

  describe('4. Ambiguous Messages (Should Trigger Clarification)', () => {
    it('should require clarification for "Rice and beans, 20000"', async () => {
      const res = await parserService.parseUserMessage('Rice and beans, 20000');
      expect(res).not.toBeNull();
      expect(res?.needs_clarification).toBe(true);
      expect(res?.clarification_question).toContain('coming in or going out');
    });

    it('should require clarification for "Fuel and transport, 13000"', async () => {
      const res = await parserService.parseUserMessage('Fuel and transport, 13000');
      expect(res).not.toBeNull();
      expect(res?.needs_clarification).toBe(true);
      expect(res?.clarification_question).toContain('coming in or going out');
    });

    it('should handle "Customer paid me back 5000"', async () => {
      const res = await parserService.parseUserMessage('Customer paid me back 5000');
      expect(res).not.toBeNull();
      expect(res?.items[0].amount).toBe(5000);
    });
  });

  describe('5. Corrections', () => {
    it('should classify "No, that\'s wrong, it was 15000" as correction', async () => {
      const res = await parserService.parseUserMessage('No, that\'s wrong, it was 15000');
      expect(res).not.toBeNull();
      expect(res?.isCorrection).toBe(true);
    });

    it('should classify "Actually it was an expense, not income" as correction', async () => {
      const res = await parserService.parseUserMessage('Actually it was an expense, not income');
      expect(res).not.toBeNull();
      expect(res?.isCorrection).toBe(true);
    });

    it('should classify "I meant transport, not utilities" as correction', async () => {
      const res = await parserService.parseUserMessage('I meant transport, not utilities');
      expect(res).not.toBeNull();
      expect(res?.isCorrection).toBe(true);
      expect(res?.correctedCategory).toBe('Transport');
    });
  });

  describe('6. Report Requests (Varied Phrasing)', () => {
    it('should classify "What\'s my report today" as report_request', async () => {
      const res = await parserService.parseUserMessage('What\'s my report today');
      expect(res).not.toBeNull();
      expect(res?.isExportRequest || res?.isSummaryQuery).toBe(true);
      expect(res?.queryPeriod).toBe('today');
    });

    it('should classify "How much did I make this week" as report_request', async () => {
      const res = await parserService.parseUserMessage('How much did I make this week');
      expect(res).not.toBeNull();
      expect(res?.isSummaryQuery).toBe(true);
      expect(res?.queryPeriod).toBe('week');
    });

    it('should classify "Send my financial summary" as report_request', async () => {
      const res = await parserService.parseUserMessage('Send my financial summary');
      expect(res).not.toBeNull();
      expect(res?.isSummaryQuery || res?.isExportRequest).toBe(true);
    });

    it('should classify "Show me last month\'s breakdown" as report_request', async () => {
      const res = await parserService.parseUserMessage('Show me last month\'s breakdown');
      expect(res).not.toBeNull();
      expect(res?.isSummaryQuery || res?.isExportRequest).toBe(true);
    });

    it('should classify "Net profit so far this month?" as report_request', async () => {
      const res = await parserService.parseUserMessage('Net profit so far this month?');
      expect(res).not.toBeNull();
      expect(res?.isSummaryQuery).toBe(true);
    });
  });

  describe('7. Clarification Replies', () => {
    it('should classify short answer "spent" as clarification_reply when pending question exists', async () => {
      const pending: IPendingClarification = {
        type: 'transaction_type',
        partialData: { amount: 20000, description: 'Rice and beans' },
        askedAt: new Date(),
      };
      const intent = await pipelineService.classifyIntent('spent', pending);
      expect(intent).toBe('clarification_reply');
    });

    it('should classify short answer "this week" as clarification_reply when pending question exists', async () => {
      const pending: IPendingClarification = {
        type: 'period',
        askedAt: new Date(),
      };
      const intent = await pipelineService.classifyIntent('this week', pending);
      expect(intent).toBe('clarification_reply');
    });
  });

  describe('8. Edge Cases / Stress Tests', () => {
    it('should require clarification for bare number "13000"', async () => {
      const res = await parserService.parseUserMessage('13000');
      expect(res).not.toBeNull();
      expect(res?.needs_clarification).toBe(true);
    });

    it('should classify "Hello" as non-transaction / unclear without crashing', async () => {
      const intent = await pipelineService.classifyIntent('Hello');
      expect(intent).toBe('unclear');
    });

    it('should require clarification when amount is missing in "sold rice"', async () => {
      const res = await parserService.parseUserMessage('sold rice');
      expect(res).not.toBeNull();
      expect(res?.needs_clarification).toBe(true);
      expect(res?.clarification_question).toContain('How much');
    });
  });
});
