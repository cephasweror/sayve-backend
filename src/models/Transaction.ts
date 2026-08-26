import mongoose, { Schema, Document } from 'mongoose';

export type TransactionType = 'income' | 'expense';
export type TransactionCategory =
  | 'Sales'
  | 'Inventory'
  | 'Transport'
  | 'Utilities'
  | 'Salaries'
  | 'Rent'
  | 'Other';

export interface ITransaction extends Document {
  userId: mongoose.Types.ObjectId;
  phoneNumber: string;
  type: TransactionType;
  amount: number;
  category: TransactionCategory;
  description: string;
  rawMessage: string;
  date: Date;
  createdAt: Date;
  updatedAt: Date;
}

const TransactionSchema: Schema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    phoneNumber: { type: String, required: true },
    type: { type: String, enum: ['income', 'expense'], required: true },
    amount: { type: Number, required: true, min: 0 },
    category: {
      type: String,
      enum: ['Sales', 'Inventory', 'Transport', 'Utilities', 'Salaries', 'Rent', 'Other'],
      default: 'Other',
    },
    description: { type: String, required: true },
    rawMessage: { type: String, required: true },
    date: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

export const Transaction = mongoose.model<ITransaction>('Transaction', TransactionSchema);
