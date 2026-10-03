import { z } from "zod";
import {
  Address,
  BrandingTheme,
  Contact,
  PaymentTerm,
  PaymentTermType,
  TaxRate,
} from "xero-node";

import { xeroClient } from "../clients/xero-client.js";
import { getClientHeaders } from "./get-client-headers.js";

/**
 * Defaults applied when a contact is created (not on update, so existing
 * contacts are never overwritten implicitly).
 */
export const CONTACT_DEFAULTS = {
  taxMode: "EXCLUSIVE" as const,
  /** Looked up by name in the organisation's tax rates. */
  salesTaxType: "EC Sales",
  /** Net 30: 30 days after the invoice date. */
  salesPaymentTerms: { days: 30, type: "DAYSAFTERBILLDATE" as const },
};

const addressSchema = z.object({
  addressLine1: z.string(),
  addressLine2: z.string().optional(),
  addressLine3: z.string().optional(),
  addressLine4: z.string().optional(),
  city: z.string().optional(),
  region: z.string().optional(),
  postalCode: z.string().optional(),
  country: z.string().optional(),
  attentionTo: z.string().optional(),
});

const taxModeSchema = z.enum(["EXCLUSIVE", "INCLUSIVE", "NONE"]);

const paymentTermsSchema = z.object({
  days: z
    .number()
    .int()
    .min(0)
    .max(31)
    .describe("Number of days (or day of month, depending on type)"),
  type: z
    .enum([
      "DAYSAFTERBILLDATE",
      "DAYSAFTERBILLMONTH",
      "OFCURRENTMONTH",
      "OFFOLLOWINGMONTH",
    ])
    .describe(
      "DAYSAFTERBILLDATE = days after invoice date (e.g. Net 30), \
DAYSAFTERBILLMONTH = days after end of invoice month, \
OFCURRENTMONTH = day of the current month, \
OFFOLLOWINGMONTH = day of the following month",
    ),
});

export type AddressInput = z.infer<typeof addressSchema>;
export type PaymentTermsInput = z.infer<typeof paymentTermsSchema>;

export const contactFieldsShape = {
  deliveryAddress: addressSchema
    .optional()
    .describe("Delivery (street) address of the contact."),
  billingAddress: addressSchema
    .optional()
    .describe(
      "Billing (postal) address. If omitted and billingSameAsDelivery is true, \
the delivery address is used.",
    ),
  billingSameAsDelivery: z
    .boolean()
    .optional()
    .describe(
      "Copy the delivery address into the billing address when no billing \
address is given. Defaults to true.",
    ),
  businessRegistrationNumber: z
    .string()
    .max(50)
    .optional()
    .describe("Business/company registration number (Xero CompanyNumber)."),
  taxRegistrationNumber: z
    .string()
    .max(50)
    .optional()
    .describe("Tax/VAT registration number (Xero TaxNumber)."),
  salesTaxMode: taxModeSchema
    .optional()
    .describe(
      "Default amounts mode on sales: EXCLUSIVE (tax exclusive), INCLUSIVE \
(tax inclusive) or NONE (no tax). Defaults to EXCLUSIVE on create.",
    ),
  purchasesTaxMode: taxModeSchema
    .optional()
    .describe(
      "Default amounts mode on purchases. Defaults to EXCLUSIVE on create.",
    ),
  salesTaxType: z
    .string()
    .optional()
    .describe(
      "Default tax rate for sales, as a TaxType code or tax rate name (see \
list-tax-rates). Defaults to the 'EC Sales' tax rate on create.",
    ),
  purchasesTaxType: z
    .string()
    .optional()
    .describe(
      "Default tax rate for purchases, as a TaxType code or tax rate name.",
    ),
  brandingTheme: z
    .string()
    .optional()
    .describe(
      "Branding theme ID or name (see list-branding-themes).",
    ),
  salesPaymentTerms: paymentTermsSchema
    .optional()
    .describe(
      "Default payment terms on sales invoices. Defaults to Net 30 \
(30 DAYSAFTERBILLDATE) on create.",
    ),
  billsPaymentTerms: paymentTermsSchema
    .optional()
    .describe("Default payment terms on bills."),
};

export interface ContactFieldsInput {
  deliveryAddress?: AddressInput;
  billingAddress?: AddressInput;
  billingSameAsDelivery?: boolean;
  businessRegistrationNumber?: string;
  taxRegistrationNumber?: string;
  salesTaxMode?: z.infer<typeof taxModeSchema>;
  purchasesTaxMode?: z.infer<typeof taxModeSchema>;
  salesTaxType?: string;
  purchasesTaxType?: string;
  brandingTheme?: string;
  salesPaymentTerms?: PaymentTermsInput;
  billsPaymentTerms?: PaymentTermsInput;
}

export interface ContactFieldsResult {
  fields: Partial<Contact>;
  warnings: string[];
}

function toAddress(
  type: Address.AddressTypeEnum,
  address: AddressInput,
): Address {
  return { addressType: type, ...address };
}

function toBill(terms: PaymentTermsInput) {
  return {
    day: terms.days,
    type: PaymentTermType[terms.type],
  };
}

/**
 * Finds a single active tax rate by TaxType code, exact name or partial name
 * (case-insensitive). Throws when nothing or more than one rate matches.
 */
export function matchTaxRate(
  taxRates: TaxRate[],
  query: string,
  usage: "sales" | "purchases",
): TaxRate {
  const q = query.trim().toLowerCase();
  const active = taxRates.filter(
    (rate) =>
      String(rate.status ?? "ACTIVE") === "ACTIVE" &&
      (usage === "sales"
        ? rate.canApplyToRevenue !== false
        : rate.canApplyToExpenses !== false),
  );

  const byCode = active.filter((rate) => rate.taxType?.toLowerCase() === q);
  if (byCode.length === 1) return byCode[0];

  const byName = active.filter((rate) => rate.name?.toLowerCase() === q);
  if (byName.length === 1) return byName[0];

  const partial = active.filter((rate) => rate.name?.toLowerCase().includes(q));
  if (partial.length === 1) return partial[0];

  if (partial.length === 0) {
    throw new Error(
      `No active ${usage} tax rate matches '${query}'. Use list-tax-rates to see the available ones.`,
    );
  }
  throw new Error(
    `'${query}' matches several ${usage} tax rates: ${partial
      .map((rate) => `${rate.name} (${rate.taxType})`)
      .join(", ")}. Pass the TaxType code instead.`,
  );
}

/** Finds a branding theme by ID or name (case-insensitive). */
export function matchBrandingTheme(
  themes: BrandingTheme[],
  query: string,
): BrandingTheme {
  const q = query.trim().toLowerCase();
  const match =
    themes.find((theme) => theme.brandingThemeID?.toLowerCase() === q) ??
    themes.find((theme) => theme.name?.toLowerCase() === q);
  if (!match) {
    throw new Error(
      `Branding theme '${query}' not found. Available: ${
        themes.map((theme) => theme.name).join(", ") || "none"
      }.`,
    );
  }
  return match;
}

async function fetchTaxRates(): Promise<TaxRate[]> {
  const response = await xeroClient.accountingApi.getTaxRates(
    xeroClient.tenantId,
    undefined, // where
    undefined, // order
    getClientHeaders(),
  );
  return response.body.taxRates ?? [];
}

async function fetchBrandingThemes(): Promise<BrandingTheme[]> {
  const response = await xeroClient.accountingApi.getBrandingThemes(
    xeroClient.tenantId,
    getClientHeaders(),
  );
  return response.body.brandingThemes ?? [];
}

/**
 * Turns the extended contact inputs into Xero Contact fields. Tax rates and
 * branding themes are resolved against the organisation. With applyDefaults,
 * the CONTACT_DEFAULTS are used for anything not given; a default that cannot
 * be resolved produces a warning instead of failing the whole call.
 *
 * Must be called after xeroClient.authenticate().
 */
export async function buildContactFields(
  input: ContactFieldsInput,
  applyDefaults: boolean,
): Promise<ContactFieldsResult> {
  const fields: Partial<Contact> = {};
  const warnings: string[] = [];

  // Addresses: STREET = delivery, POBOX = billing/postal
  const billing =
    input.billingAddress ??
    (input.billingSameAsDelivery !== false ? input.deliveryAddress : undefined);
  const addresses: Address[] = [];
  if (input.deliveryAddress) {
    addresses.push(
      toAddress(Address.AddressTypeEnum.STREET, input.deliveryAddress),
    );
  }
  if (billing) {
    addresses.push(toAddress(Address.AddressTypeEnum.POBOX, billing));
  }
  if (addresses.length) fields.addresses = addresses;

  if (input.businessRegistrationNumber !== undefined) {
    fields.companyNumber = input.businessRegistrationNumber;
  }
  if (input.taxRegistrationNumber !== undefined) {
    fields.taxNumber = input.taxRegistrationNumber;
  }

  const salesTaxMode =
    input.salesTaxMode ?? (applyDefaults ? CONTACT_DEFAULTS.taxMode : undefined);
  if (salesTaxMode) {
    fields.salesDefaultLineAmountType =
      Contact.SalesDefaultLineAmountTypeEnum[salesTaxMode];
  }
  const purchasesTaxMode =
    input.purchasesTaxMode ??
    (applyDefaults ? CONTACT_DEFAULTS.taxMode : undefined);
  if (purchasesTaxMode) {
    fields.purchasesDefaultLineAmountType =
      Contact.PurchasesDefaultLineAmountTypeEnum[purchasesTaxMode];
  }

  const useDefaultSalesTax = !input.salesTaxType && applyDefaults;
  const salesTaxQuery = input.salesTaxType ?? (
    applyDefaults ? CONTACT_DEFAULTS.salesTaxType : undefined
  );
  if (salesTaxQuery || input.purchasesTaxType) {
    const taxRates = await fetchTaxRates();
    if (salesTaxQuery) {
      try {
        fields.accountsReceivableTaxType = matchTaxRate(
          taxRates,
          salesTaxQuery,
          "sales",
        ).taxType;
      } catch (error) {
        if (!useDefaultSalesTax) throw error;
        warnings.push(
          `Default sales tax rate not set: ${(error as Error).message}`,
        );
      }
    }
    if (input.purchasesTaxType) {
      fields.accountsPayableTaxType = matchTaxRate(
        taxRates,
        input.purchasesTaxType,
        "purchases",
      ).taxType;
    }
  }

  if (input.brandingTheme) {
    const theme = matchBrandingTheme(
      await fetchBrandingThemes(),
      input.brandingTheme,
    );
    fields.brandingTheme = { brandingThemeID: theme.brandingThemeID };
  }

  const salesTerms =
    input.salesPaymentTerms ??
    (applyDefaults ? CONTACT_DEFAULTS.salesPaymentTerms : undefined);
  if (salesTerms || input.billsPaymentTerms) {
    const paymentTerms: PaymentTerm = {};
    if (salesTerms) paymentTerms.sales = toBill(salesTerms);
    if (input.billsPaymentTerms) {
      paymentTerms.bills = toBill(input.billsPaymentTerms);
    }
    fields.paymentTerms = paymentTerms;
  }

  return { fields, warnings };
}

/** Human-readable summary of the extended fields of a saved contact. */
export function describeContactFields(contact: Contact): string[] {
  const street = contact.addresses?.find(
    (a) => a.addressType === Address.AddressTypeEnum.STREET,
  );
  const pobox = contact.addresses?.find(
    (a) => a.addressType === Address.AddressTypeEnum.POBOX,
  );
  const formatAddress = (a?: Address) =>
    a?.addressLine1
      ? [a.addressLine1, a.addressLine2, a.city, a.region, a.postalCode, a.country]
          .filter(Boolean)
          .join(", ")
      : null;
  const formatTerms = (b?: { day?: number; type?: PaymentTermType }) =>
    b?.type !== undefined ? `${b.day} ${b.type}` : null;

  return [
    formatAddress(street) ? `Delivery address: ${formatAddress(street)}` : null,
    formatAddress(pobox) ? `Billing address: ${formatAddress(pobox)}` : null,
    contact.companyNumber
      ? `Business registration: ${contact.companyNumber}`
      : null,
    contact.taxNumber ? `Tax registration: ${contact.taxNumber}` : null,
    contact.salesDefaultLineAmountType
      ? `Sales tax mode: ${contact.salesDefaultLineAmountType}`
      : null,
    contact.purchasesDefaultLineAmountType
      ? `Purchases tax mode: ${contact.purchasesDefaultLineAmountType}`
      : null,
    contact.accountsReceivableTaxType
      ? `Sales tax rate: ${contact.accountsReceivableTaxType}`
      : null,
    contact.accountsPayableTaxType
      ? `Purchases tax rate: ${contact.accountsPayableTaxType}`
      : null,
    contact.brandingTheme?.brandingThemeID
      ? `Branding theme: ${contact.brandingTheme.name ?? contact.brandingTheme.brandingThemeID}`
      : null,
    formatTerms(contact.paymentTerms?.sales)
      ? `Sales payment terms: ${formatTerms(contact.paymentTerms?.sales)}`
      : null,
    formatTerms(contact.paymentTerms?.bills)
      ? `Bills payment terms: ${formatTerms(contact.paymentTerms?.bills)}`
      : null,
  ].filter((line): line is string => line !== null);
}
