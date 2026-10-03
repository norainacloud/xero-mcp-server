import { createXeroContact } from "../../handlers/create-xero-contact.handler.js";
import { z } from "zod";
import { DeepLinkType, getDeepLink } from "../../helpers/get-deeplink.js";
import { ensureError } from "../../helpers/ensure-error.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";
import {
  contactFieldsShape,
  describeContactFields,
} from "../../helpers/contact-fields.js";

const CreateContactTool = CreateXeroTool(
  "create-contact",
  "Create a contact in Xero.\
  Unless given otherwise, the contact is created with tax exclusive amounts, \
  the 'EC Sales' tax rate on sales and Net 30 sales payment terms \
  (30 days after invoice date). The billing address is copied from the \
  delivery address unless a different one is given. \
  When a contact is created, a deep link to the contact in Xero is returned. \
  This deep link can be used to view the contact in Xero directly. \
  This link should be displayed to the user.",
  {
    name: z.string(),
    email: z.string().email().optional(),
    phone: z.string().optional(),
    ...contactFieldsShape,
  },
  async ({ name, email, phone, ...extra }) => {
    try {
      const response = await createXeroContact(name, email, phone, extra);
      if (response.isError) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error creating contact: ${response.error}`,
            },
          ],
        };
      }

      const { contact, warnings } = response.result;

      const deepLink = contact.contactID
        ? await getDeepLink(DeepLinkType.CONTACT, contact.contactID)
        : null;

      return {
        content: [
          {
            type: "text" as const,
            text: [
              `Contact created: ${contact.name} (ID: ${contact.contactID})`,
              ...describeContactFields(contact),
              ...warnings.map((warning) => `Warning: ${warning}`),
              deepLink ? `Link to view: ${deepLink}` : null,
            ]
              .filter(Boolean)
              .join("\n"),
          },
        ],
      };
    } catch (error) {
      const err = ensureError(error);

      return {
        content: [
          {
            type: "text" as const,
            text: `Error creating contact: ${err.message}`,
          },
        ],
      };
    }
  },
);

export default CreateContactTool;
