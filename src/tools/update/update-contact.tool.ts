import { updateXeroContact } from "../../handlers/update-xero-contact.handler.js";
import { z } from "zod";
import { DeepLinkType, getDeepLink } from "../../helpers/get-deeplink.js";
import { ensureError } from "../../helpers/ensure-error.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";
import {
  contactFieldsShape,
  describeContactFields,
} from "../../helpers/contact-fields.js";

const UpdateContactTool = CreateXeroTool(
  "update-contact",
  "Update a contact in Xero.\
 Only the fields that are passed are changed (no defaults are applied). \
 When a delivery address is passed without a billing address, the billing \
 address is set to the same value unless billingSameAsDelivery is false. \
 When a contact is updated, a deep link to the contact in Xero is returned. \
 This deep link can be used to view the contact in Xero directly. \
 This link should be displayed to the user.",
  {
    contactId: z.string(),
    name: z.string(),
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    email: z.string().email().optional(),
    phone: z.string().optional(),
    address: contactFieldsShape.deliveryAddress.describe(
      "Deprecated alias of deliveryAddress.",
    ),
    ...contactFieldsShape,
  },
  async ({
    contactId,
    name,
    firstName,
    lastName,
    email,
    phone,
    address,
    deliveryAddress,
    ...extra
  }) => {
    try {
      const response = await updateXeroContact(
        contactId,
        name,
        firstName,
        lastName,
        email,
        phone,
        { ...extra, deliveryAddress: deliveryAddress ?? address },
      );
      if (response.isError) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error updating contact: ${response.error}`,
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
              `Contact updated: ${contact.name} (ID: ${contact.contactID})`,
              ...describeContactFields(contact),
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
            text: `Error updating contact: ${err.message}`,
          },
        ],
      };
    }
  },
);

export default UpdateContactTool;
