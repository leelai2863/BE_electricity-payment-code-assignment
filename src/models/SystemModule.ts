import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

/** Danh mục module / chức năng (import từ Excel: cột A tên, cột B mã phân cấp). */
const SystemModuleSchema = new Schema(
  {
    code: { type: String, required: true, unique: true, trim: true, index: true },
    name: { type: String, required: true, trim: true },
    parentCode: { type: String, default: null, index: true },
    rowIndex: { type: Number, required: true, index: true },
  },
  { timestamps: true }
);

export type SystemModuleDocument = InferSchemaType<typeof SystemModuleSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const SystemModule: Model<SystemModuleDocument> =
  mongoose.models.SystemModule ?? mongoose.model<SystemModuleDocument>("SystemModule", SystemModuleSchema);
