import mongoose, { Schema, Document } from 'mongoose';

export type OnboardingState = 'AWAITING_BUSINESS_NAME' | 'AWAITING_CURRENCY' | 'COMPLETED';

export interface IUser extends Document {
  phoneNumber: string;
  businessName: string;
  currency: string;
  onboardingState: OnboardingState;
  lastTransactionId?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema: Schema = new Schema(
  {
    phoneNumber: { type: String, required: true, unique: true, index: true },
    businessName: { type: String, default: 'My Business' },
    currency: { type: String, default: 'NGN' },
    onboardingState: {
      type: String,
      enum: ['AWAITING_BUSINESS_NAME', 'AWAITING_CURRENCY', 'COMPLETED'],
      default: 'AWAITING_BUSINESS_NAME',
    },
    lastTransactionId: { type: Schema.Types.ObjectId, ref: 'Transaction' },
  },
  { timestamps: true }
);

export const User = mongoose.model<IUser>('User', UserSchema);
