import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

const UserBankPreferenceSchema = new Schema(
  {
    /** Chuỗi hiển thị như người dùng nhập (đã trim). */
    bankDisplay: { type: String, required: true, trim: true, maxlength: 120 },
    /** Chuẩn hóa để dedupe (uppercase + gộp khoảng trắng). */
    bankNormalized: { type: String, required: true, trim: true },
    usageCount: { type: Number, default: 1, min: 1 },
    lastUsedAt: { type: Date, default: () => new Date(), index: true },
  },
  { timestamps: true }
);

UserBankPreferenceSchema.index({ bankNormalized: 1 }, { unique: true });
UserBankPreferenceSchema.index({ usageCount: -1, lastUsedAt: -1 });

export type UserBankPreferenceDocument = InferSchemaType<typeof UserBankPreferenceSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const UserBankPreference: Model<UserBankPreferenceDocument> =
  mongoose.models.UserBankPreference ??
  mongoose.model<UserBankPreferenceDocument>("UserBankPreference", UserBankPreferenceSchema);
