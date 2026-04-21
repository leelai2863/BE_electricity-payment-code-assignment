import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

const UserSourcePreferenceSchema = new Schema(
  {
    /** Chuỗi hiển thị như người dùng nhập (đã trim). */
    sourceDisplay: { type: String, required: true, trim: true, maxlength: 120 },
    /** Chuẩn hóa để dedupe (uppercase + gộp khoảng trắng). */
    sourceNormalized: { type: String, required: true, trim: true },
    usageCount: { type: Number, default: 1, min: 1 },
    lastUsedAt: { type: Date, default: () => new Date(), index: true },
  },
  { timestamps: true }
);

UserSourcePreferenceSchema.index({ sourceNormalized: 1 }, { unique: true });
UserSourcePreferenceSchema.index({ usageCount: -1, lastUsedAt: -1 });

export type UserSourcePreferenceDocument = InferSchemaType<typeof UserSourcePreferenceSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const UserSourcePreference: Model<UserSourcePreferenceDocument> =
  mongoose.models.UserSourcePreference ??
  mongoose.model<UserSourcePreferenceDocument>("UserSourcePreference", UserSourcePreferenceSchema);
