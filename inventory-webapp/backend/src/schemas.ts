import { z } from 'zod';
const text = z.string().trim().min(1).max(200);
export const positive = z.number().finite().min(0.000001).max(1e9);
export const nonnegative = z.number().finite().min(0).max(1e9);
export const identifier = z.string().uuid();
export const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (s) => !isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s,
    'Invalid calendar date',
  );
export const timestamp = z.iso
  .datetime({ offset: true })
  .refine((s) => Date.parse(s) <= Date.now() + 300_000, 'Future operational dates are not allowed')
  .transform((s) => new Date(s).toISOString());
export const eventFields = { key: text, reference: text, reason: text, occurred_at: timestamp };
export const itemSchema = z
  .object({
    sku: text,
    name: text,
    category: text,
    base_unit: z.enum(['g', 'ml', 'piece', 'bottle']),
    location: text,
    reorder_point: nonnegative,
    target: nonnegative,
    expiry_tracking: z.boolean(),
    archived: z.boolean().default(false),
  })
  .refine((x) => x.target >= x.reorder_point, 'Target must be at least reorder point');
export const productSchema = z.object({
  sku: text,
  source_name: text,
  category: text,
  selling_price: nonnegative.nullable(),
  archived: z.boolean().default(false),
});
export const supplierSchema = z.object({
  name: text,
  contact: z.string().trim().max(200),
  email: z.union([z.email(), z.literal('')]),
  address: z.string().trim().max(500),
  archived: z.boolean().default(false),
});
export const ingredientSchema = z.object({ item_id: identifier, quantity: positive, unit: text });
export const recipeSchema = z.object({
  reason: text,
  ingredients: z.array(ingredientSchema).min(1).max(200),
});
export const openingSchema = z.object({
  ...eventFields,
  quantity: nonnegative,
  unit: text,
  expiry_date: dateOnly.nullable().default(null),
  batch_label: text,
});
export const poSchema = z.object({
  reference: text,
  supplier_id: identifier,
  expected_date: dateOnly,
  lines: z
    .array(
      z.object({ item_id: identifier, quantity: positive, unit: text, unit_cost: nonnegative }),
    )
    .min(1)
    .max(200),
});
export const receiptSchema = z.object({
  ...eventFields,
  delivery_reference: text,
  over_receipt_reason: z.string().trim().max(500).optional(),
  lines: z
    .array(
      z.object({
        po_line_id: identifier,
        quantity: positive,
        unit: text,
        expiry_date: dateOnly.nullable().default(null),
        batch_label: text,
      }),
    )
    .min(1)
    .max(200),
});
export const saleSchema = z.object({
  ...eventFields,
  lines: z
    .array(
      z.object({
        line_number: z.number().int().positive(),
        product_id: identifier,
        quantity: positive,
        unit_price: nonnegative,
        sales_amount: nonnegative,
      }),
    )
    .min(1)
    .max(1000),
});
export const wasteSchema = z.object({
  ...eventFields,
  category: text,
  lines: z
    .array(ingredientSchema.extend({ batch_id: identifier.optional() }))
    .min(1)
    .max(200),
});
export const countSchema = z.object({
  ...eventFields,
  lines: z
    .array(
      z.object({
        item_id: identifier,
        batch_id: identifier,
        counted: nonnegative,
        expected_book: nonnegative,
        unit: text,
      }),
    )
    .min(1)
    .max(200),
});
export const reversalSchema = z.object({ ...eventFields });
export const passwordSchema = z
  .string()
  .min(12)
  .max(72)
  .refine((s) => Buffer.byteLength(s, 'utf8') <= 72, 'Password must not exceed 72 UTF-8 bytes');
export const userSchema = z.object({
  email: z.email().max(200),
  name: text,
  role: z.enum(['admin', 'staff']),
  password: passwordSchema,
});
export type Sale = z.infer<typeof saleSchema>;
