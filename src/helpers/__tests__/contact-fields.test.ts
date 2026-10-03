import { describe, expect, it, vi, beforeEach } from "vitest";
import { Address, BrandingTheme, ObjectSerializer, TaxRate } from "xero-node";

const getTaxRates = vi.fn();
const getBrandingThemes = vi.fn();

vi.mock("../../clients/xero-client.js", () => ({
  xeroClient: {
    tenantId: "tenant",
    accountingApi: { getTaxRates, getBrandingThemes },
  },
}));

const { buildContactFields, matchTaxRate, matchBrandingTheme } = await import(
  "../contact-fields.js"
);

const taxRates = [
  { name: "EC Sales", taxType: "TAX005", status: "ACTIVE", canApplyToRevenue: true },
  { name: "EC Sales Services", taxType: "TAX006", status: "ACTIVE", canApplyToRevenue: true },
  { name: "Standard 23%", taxType: "OUTPUT2", status: "ACTIVE", canApplyToRevenue: true, canApplyToExpenses: true },
  { name: "Old Rate", taxType: "TAX001", status: "DELETED", canApplyToRevenue: true },
] as unknown as TaxRate[];

const themes = [
  { brandingThemeID: "id-standard", name: "Standard", sortOrder: 0 },
  { brandingThemeID: "id-export", name: "Export", sortOrder: 1 },
] as BrandingTheme[];

const address = { addressLine1: "1 Main St", city: "Dublin", country: "Ireland" };

beforeEach(() => {
  vi.clearAllMocks();
  getTaxRates.mockResolvedValue({ body: { taxRates } });
  getBrandingThemes.mockResolvedValue({ body: { brandingThemes: themes } });
});

describe("matchTaxRate", () => {
  it("prefers an exact name over partial matches", () => {
    expect(matchTaxRate(taxRates, "ec sales", "sales").taxType).toBe("TAX005");
  });

  it("matches by TaxType code", () => {
    expect(matchTaxRate(taxRates, "OUTPUT2", "sales").name).toBe("Standard 23%");
  });

  it("ignores inactive rates", () => {
    expect(() => matchTaxRate(taxRates, "Old Rate", "sales")).toThrow(/No active/);
  });

  it("reports ambiguous partial matches", () => {
    expect(() => matchTaxRate(taxRates, "EC", "sales")).toThrow(/several/);
  });
});

describe("matchBrandingTheme", () => {
  it("matches by name or id", () => {
    expect(matchBrandingTheme(themes, "export").brandingThemeID).toBe("id-export");
    expect(matchBrandingTheme(themes, "id-standard").name).toBe("Standard");
  });

  it("throws when not found", () => {
    expect(() => matchBrandingTheme(themes, "nope")).toThrow(/not found/);
  });
});

describe("buildContactFields", () => {
  it("applies the create defaults", async () => {
    const { fields, warnings } = await buildContactFields({}, true);
    expect(warnings).toEqual([]);
    const json = ObjectSerializer.serialize(fields, "Contact");
    expect(json).toMatchObject({
      SalesDefaultLineAmountType: "EXCLUSIVE",
      PurchasesDefaultLineAmountType: "EXCLUSIVE",
      AccountsReceivableTaxType: "TAX005",
      PaymentTerms: { Sales: { Day: 30, Type: "DAYSAFTERBILLDATE" } },
    });
  });

  it("applies no defaults on update", async () => {
    const { fields } = await buildContactFields({}, false);
    expect(fields).toEqual({});
    expect(getTaxRates).not.toHaveBeenCalled();
  });

  it("copies the delivery address into billing", async () => {
    const { fields } = await buildContactFields({ deliveryAddress: address }, false);
    expect(fields.addresses).toEqual([
      { addressType: Address.AddressTypeEnum.STREET, ...address },
      { addressType: Address.AddressTypeEnum.POBOX, ...address },
    ]);
  });

  it("keeps billing separate when asked", async () => {
    const { fields } = await buildContactFields(
      { deliveryAddress: address, billingSameAsDelivery: false },
      false,
    );
    expect(fields.addresses).toHaveLength(1);
  });

  it("sets registrations, branding and explicit values", async () => {
    const { fields } = await buildContactFields(
      {
        businessRegistrationNumber: "123456",
        taxRegistrationNumber: "IE1234567T",
        salesTaxMode: "INCLUSIVE",
        salesTaxType: "Standard 23%",
        brandingTheme: "Export",
        salesPaymentTerms: { days: 15, type: "OFFOLLOWINGMONTH" },
      },
      true,
    );
    const json = ObjectSerializer.serialize(fields, "Contact");
    expect(json).toMatchObject({
      CompanyNumber: "123456",
      TaxNumber: "IE1234567T",
      SalesDefaultLineAmountType: "INCLUSIVE",
      AccountsReceivableTaxType: "OUTPUT2",
      BrandingTheme: { BrandingThemeID: "id-export" },
      PaymentTerms: { Sales: { Day: 15, Type: "OFFOLLOWINGMONTH" } },
    });
  });

  it("warns instead of failing when the default tax rate is missing", async () => {
    getTaxRates.mockResolvedValue({ body: { taxRates: [] } });
    const { fields, warnings } = await buildContactFields({}, true);
    expect(fields.accountsReceivableTaxType).toBeUndefined();
    expect(warnings[0]).toMatch(/Default sales tax rate not set/);
  });

  it("fails when an explicit tax rate is missing", async () => {
    await expect(
      buildContactFields({ salesTaxType: "Nope" }, false),
    ).rejects.toThrow(/No active/);
  });
});
