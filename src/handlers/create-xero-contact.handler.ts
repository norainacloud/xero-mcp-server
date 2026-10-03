import { xeroClient } from "../clients/xero-client.js";
import { XeroClientResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";
import { Contact, Phone } from "xero-node";
import { getClientHeaders } from "../helpers/get-client-headers.js";
import { fetchContact } from "./get-xero-contact.handler.js";
import {
  buildContactFields,
  ContactFieldsInput,
} from "../helpers/contact-fields.js";

interface CreatedContact {
  contact: Contact;
  warnings: string[];
}

async function createContact(
  name: string,
  email: string | undefined,
  phone: string | undefined,
  extra: ContactFieldsInput,
): Promise<CreatedContact | undefined> {
  await xeroClient.authenticate();

  const { fields, warnings } = await buildContactFields(extra, true);

  const contact: Contact = {
    ...fields,
    name,
    emailAddress: email,
    phones: phone
      ? [
          {
            phoneNumber: phone,
            phoneType: Phone.PhoneTypeEnum.MOBILE,
          },
        ]
      : undefined,
  };

  const response = await xeroClient.accountingApi.createContacts(
    xeroClient.tenantId,
    {
      contacts: [contact],
    }, //contacts
    true, //summarizeErrors
    undefined, //idempotencyKey
    getClientHeaders(), // options
  );

  const created = response.body.contacts?.[0];
  if (!created?.contactID) return undefined;

  // The create response omits fields such as SalesDefaultLineAmountType and
  // BrandingTheme, so read the contact back to report what Xero stored.
  return { contact: await fetchContact(created.contactID), warnings };
}

/**
 * Create a new contact in Xero
 */
export async function createXeroContact(
  name: string,
  email?: string,
  phone?: string,
  extra: ContactFieldsInput = {},
): Promise<XeroClientResponse<CreatedContact>> {
  try {
    const createdContact = await createContact(name, email, phone, extra);

    if (!createdContact) {
      throw new Error("Contact creation failed.");
    }

    return {
      result: createdContact,
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
