import { describe, expect, it, vi } from "vitest";
import { Contacts, ObjectSerializer } from "xero-node";

const updateContact = vi.fn();
const getContact = vi.fn();
const getBrandingThemes = vi.fn();
const getTaxRates = vi.fn();

vi.mock("../../clients/xero-client.js", () => ({
  xeroClient: {
    tenantId: "tenant",
    authenticate: vi.fn(),
    accountingApi: { updateContact, getContact, getBrandingThemes, getTaxRates },
  },
}));

const { updateXeroContact } = await import("../update-xero-contact.handler.js");

describe("updateXeroContact", () => {
  it("sends BrandingTheme and SalesDefaultLineAmountType and reads the contact back", async () => {
    getBrandingThemes.mockResolvedValue({
      body: {
        brandingThemes: [{ brandingThemeID: "theme-eu", name: "Std_EU-VAT" }],
      },
    });
    updateContact.mockResolvedValue({
      body: { contacts: [{ contactID: "c1", name: "Acme" }] },
    });
    const stored = {
      contactID: "c1",
      name: "Acme",
      salesDefaultLineAmountType: "EXCLUSIVE",
    };
    getContact.mockResolvedValue({ body: { contacts: [stored] } });

    const response = await updateXeroContact(
      "c1",
      "Acme",
      undefined,
      undefined,
      undefined,
      undefined,
      { brandingTheme: "Std_EU-VAT", salesTaxMode: "EXCLUSIVE" },
    );

    const payload = updateContact.mock.calls[0][2] as Contacts;
    expect(ObjectSerializer.serialize(payload, "Contacts")).toEqual({
      Contacts: [
        expect.objectContaining({
          Name: "Acme",
          SalesDefaultLineAmountType: "EXCLUSIVE",
          BrandingTheme: { BrandingThemeID: "theme-eu" },
        }),
      ],
    });
    expect(getContact).toHaveBeenCalledWith("tenant", "c1", expect.anything());
    expect(response.result).toEqual(stored);
  });
});
