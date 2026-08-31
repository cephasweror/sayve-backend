import { exportService } from '../services/export.service';
import { whatsappService } from '../services/whatsapp.service';
import { Transaction } from '../models/Transaction';
import { IUser } from '../models/User';

jest.mock('../services/whatsapp.service', () => ({
  whatsappService: {
    sendTextMessage: jest.fn().mockResolvedValue(true),
    uploadMedia: jest.fn().mockResolvedValue('mock_media_id_999'),
    sendDocumentMessage: jest.fn().mockResolvedValue(true),
  },
}));

jest.mock('../models/Transaction', () => ({
  Transaction: {
    find: jest.fn(),
  },
}));

describe('ExportService Unit Tests', () => {
  const mockUser: Partial<IUser> = {
    _id: 'user_123' as any,
    phoneNumber: '2348012345678',
    businessName: 'Kemi Stores',
    currency: 'NGN',
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should notify user if no transactions exist in the last 30 days', async () => {
    (Transaction.find as jest.Mock).mockReturnValue({
      sort: jest.fn().mockResolvedValue([]),
    });

    const result = await exportService.exportAndSendReport(mockUser as IUser);
    expect(result).toBe(true);
    expect(whatsappService.sendTextMessage).toHaveBeenCalledWith(
      '2348012345678',
      expect.stringContaining('No transactions recorded')
    );
  });

  it('should generate Excel report by default, upload media, and send document attachment successfully', async () => {
    const mockTxs = [
      {
        date: new Date('2026-08-20'),
        type: 'income',
        category: 'Sales',
        amount: 45000,
        description: 'sold 3 bags of rice',
        rawMessage: 'sold 3 bags of rice for 45000',
      },
    ];

    (Transaction.find as jest.Mock).mockReturnValue({
      sort: jest.fn().mockResolvedValue(mockTxs),
    });

    const result = await exportService.exportAndSendReport(mockUser as IUser, 'excel');
    expect(result).toBe(true);
    expect(whatsappService.uploadMedia).toHaveBeenCalledWith(
      expect.any(Buffer),
      'sayve_report_kemi_stores.xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    expect(whatsappService.sendDocumentMessage).toHaveBeenCalledWith(
      '2348012345678',
      'mock_media_id_999',
      'sayve_report_kemi_stores.xlsx',
      expect.stringContaining('Kemi Stores')
    );
  });

  it('should generate PDF report when requested', async () => {
    const mockTxs = [
      {
        date: new Date('2026-08-20'),
        type: 'expense',
        category: 'Transport',
        amount: 5000,
        description: 'keke ride',
        rawMessage: 'spent 5k transport',
      },
    ];

    (Transaction.find as jest.Mock).mockReturnValue({
      sort: jest.fn().mockResolvedValue(mockTxs),
    });

    const result = await exportService.exportAndSendReport(mockUser as IUser, 'pdf');
    expect(result).toBe(true);
    expect(whatsappService.uploadMedia).toHaveBeenCalledWith(
      expect.any(Buffer),
      'sayve_report_kemi_stores.pdf',
      'application/pdf'
    );
  });

  it('should generate PDF and Excel buffers directly without crashing', async () => {
    const mockTxs = [
      {
        date: new Date('2026-08-20'),
        type: 'income',
        category: 'Sales',
        amount: 45000,
        description: 'sold rice',
        rawMessage: 'sold rice 45k',
      },
    ];

    const excelBuf = await exportService.generateExcelBuffer(mockTxs as any, 'Kemi Stores', '30 Days');
    expect(excelBuf).toBeInstanceOf(Buffer);
    expect(excelBuf.length).toBeGreaterThan(0);

    const pdfBuf = await exportService.generatePdfBuffer(mockTxs as any, 'Kemi Stores', '30 Days');
    expect(pdfBuf).toBeInstanceOf(Buffer);
    expect(pdfBuf.length).toBeGreaterThan(0);
  });
});
