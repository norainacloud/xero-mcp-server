import { xeroClient } from "../clients/xero-client.js";
import { XeroClientResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";
import { Contact, Phone, Contacts } from "xero-node";
import { getClientHeaders } from "../helpers/get-client-headers.js";
import { fetchContact } from "./get-xero-contact.handler.js";
import {
  buildContactFields,
  ContactFieldsInput,
} from "../helpers/contact-fields.js";

async function updateContact(
  name: string,
  firstName: string | undefined,
  lastName: string | undefined,
  email: string | undefined,
  phone: string | undefined,
  extra: ContactFieldsInput,
  contactId: string,
): Promise<Contact | undefined> {
  await xeroClient.authenticate();

  // No defaults on update: only the fields that were passed are changed.
  const { fields } = await buildContactFields(extra, false);

  const contact: Contact = {
    ...fields,
    name,
    firstName,
    lastName,
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

  const contacts: Contacts = {
    contacts: [contact],
  };

  const response = await xeroClient.accountingApi.updateContact(
    xeroClient.tenantId,
    contactId, // contactId
    contacts, // contacts
    undefined, // idempotencyKey
    getClientHeaders(),
  );

  const updatedContact = response.body.contacts?.[0];
  if (!updatedContact?.contactID) return undefined;

  // The update response omits fields such as SalesDefaultLineAmountType and
  // BrandingTheme, so read the contact back to report what Xero stored.
  return fetchContact(updatedContact.contactID);
}

/**
 * Update an existing contact in Xero
 */
export async function updateXeroContact(
  contactId: string,
  name: string,
  firstName?: string,
  lastName?: string,
  email?: string,
  phone?: string,
  extra: ContactFieldsInput = {},
): Promise<XeroClientResponse<Contact>> {
  try {
    const updatedContact = await updateContact(
      name,
      firstName,
      lastName,
      email,
      phone,
      extra,
      contactId,
    );

    if (!updatedContact) {
      throw new Error("Contact update failed.");
    }

    return {
      result: updatedContact,
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
