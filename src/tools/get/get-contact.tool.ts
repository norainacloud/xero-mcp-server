import { z } from "zod";
import { getXeroContact } from "../../handlers/get-xero-contact.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";
import { describeContactFields } from "../../helpers/contact-fields.js";
import { DeepLinkType, getDeepLink } from "../../helpers/get-deeplink.js";

const GetContactTool = CreateXeroTool(
  "get-contact",
  "Get a single contact from Xero by ID, with its full settings as stored by \
Xero: addresses, business and tax registration numbers, tax modes, default \
tax rates, branding theme and payment terms. Use it to verify a contact after \
creating or updating it.",
  {
    contactId: z.string(),
  },
  async ({ contactId }) => {
    const response = await getXeroContact(contactId);
    if (response.isError) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error getting contact: ${response.error}`,
          },
        ],
      };
    }

    const contact = response.result;
    const deepLink = contact.contactID
      ? await getDeepLink(DeepLinkType.CONTACT, contact.contactID)
      : null;

    return {
      content: [
        {
          type: "text" as const,
          text: [
            `Contact: ${contact.name}`,
            `ID: ${contact.contactID}`,
            contact.emailAddress ? `Email: ${contact.emailAddress}` : null,
            `Status: ${contact.contactStatus || "Unknown"}`,
            ...describeContactFields(contact),
            deepLink ? `Link to view: ${deepLink}` : null,
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
    };
  },
);

export default GetContactTool;
