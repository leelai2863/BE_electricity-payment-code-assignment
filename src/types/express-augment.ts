/// <reference types="express-serve-static-core" />

declare module "express-serve-static-core" {
  interface Request {
    /** Gateway injects `x-fuji-user-id` sau introspect IAM. */
    fujiUserId?: string;
    /** Email tài khoản (header `x-fuji-user-email`). */
    fujiUserEmail?: string;
    /** Họ tên UTF-8 (header `x-fuji-user-display-name-b64`, base64url). */
    fujiUserDisplayName?: string;
    /** Scope đại lý cho user CUSTOMER (header `x-fuji-agency-id`). */
    fujiAgencyId?: string;
    fujiUserRoles?: string[];
    fujiAuthType?: string;
  }
}

export {};
