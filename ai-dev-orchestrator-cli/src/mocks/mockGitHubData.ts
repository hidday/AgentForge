export const MOCK_DIFF = `diff --git a/src/middleware/validation.ts b/src/middleware/validation.ts
new file mode 100644
index 0000000..a1b2c3d
--- /dev/null
+++ b/src/middleware/validation.ts
@@ -0,0 +1,45 @@
+import { z, ZodError, ZodSchema } from 'zod';
+import type { Request, Response, NextFunction } from 'express';
+
+interface ValidationError {
+  field: string;
+  message: string;
+}
+
+export function validateBody(schema: ZodSchema) {
+  return (req: Request, res: Response, next: NextFunction) => {
+    const result = schema.safeParse(req.body);
+    if (!result.success) {
+      const errors = formatZodErrors(result.error);
+      return res.status(400).json({ errors });
+    }
+    req.body = result.data;
+    next();
+  };
+}
+
+export function validateQuery(schema: ZodSchema) {
+  return (req: Request, res: Response, next: NextFunction) => {
+    const result = schema.safeParse(req.query);
+    if (!result.success) {
+      const errors = formatZodErrors(result.error);
+      return res.status(400).json({ errors });
+    }
+    req.query = result.data;
+    next();
+  };
+}
+
+function formatZodErrors(error: ZodError): ValidationError[] {
+  return error.issues.map((issue) => ({
+    field: issue.path.join('.'),
+    message: issue.message,
+  }));
+}
diff --git a/src/routes/users.ts b/src/routes/users.ts
index def1234..ghi5678 100644
--- a/src/routes/users.ts
+++ b/src/routes/users.ts
@@ -1,8 +1,18 @@
 import { Router } from 'express';
+import { z } from 'zod';
+import { validateBody, validateQuery } from '../middleware/validation';
+
+const createUserSchema = z.object({
+  name: z.string().min(1).max(255),
+  email: z.string().email(),
+  role: z.enum(['admin', 'user']).default('user'),
+});
+
+const listUsersQuery = z.object({
+  page: z.coerce.number().int().positive().default(1),
+  limit: z.coerce.number().int().min(1).max(100).default(20),
+});

 const router = Router();
-router.post('/', async (req, res) => {
+router.post('/', validateBody(createUserSchema), async (req, res) => {
`;

export const MOCK_REPO_CONFIG = {
  name: "acme/backend-api",
  defaultBranch: "main",
  repoPath: "./workspace",
  allowedPaths: ["src/", "tests/", "package.json"],
  protectedPaths: [".github/", "infrastructure/", "prisma/migrations/"],
};
