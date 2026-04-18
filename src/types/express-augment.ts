import "express-serve-static-core";

declare module "express-serve-static-core" {
  interface Request {
    /** Gateway injects `x-fuji-user-id` sau introspect IAM. */
    fujiUserId?: string;
    fujiUserRoles?: string[];
    fujiAuthType?: string;
  }
}

export {};
