import { xeroClient } from "../clients/xero-client.js";
import { XeroClientResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";
import { Contact } from "xero-node";
import { getClientHeaders } from "../helpers/get-client-headers.js";

/**
 * Fetches the full contact by ID. Unlike the create/update responses and the
 * summaryOnly list, this includes SalesDefaultLineAmountType, BrandingTheme
 * and PaymentTerms as stored by Xero.
 */
export async function fetchContact(contactId: string): Promise<Contact> {
  await xeroClient.authenticate();

  const response = await xeroClient.accountingApi.getContact(
    xeroClient.tenantId,
    contactId,
    getClientHeaders(),
  );
  const contact = response.body.contacts?.[0];
  if (!contact) {
    throw new Error(`Contact ${contactId} not found.`);
  }
  return contact;
}

/**
 * Get a single contact from Xero
 */
export async function getXeroContact(
  contactId: string,
): Promise<XeroClientResponse<Contact>> {
  try {
    const contact = await fetchContact(contactId);

    return {
      result: contact,
      isError: false,
      error: null,
    };
  } catch (error) {
    return {
      result: null,
      isError: true,
      error: formatError(error),
    };
  }
}
