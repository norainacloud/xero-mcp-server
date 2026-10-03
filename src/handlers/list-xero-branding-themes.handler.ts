import { xeroClient } from "../clients/xero-client.js";
import { XeroClientResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";
import { BrandingTheme } from "xero-node";
import { getClientHeaders } from "../helpers/get-client-headers.js";

async function getBrandingThemes(): Promise<BrandingTheme[]> {
  await xeroClient.authenticate();

  const brandingThemes = await xeroClient.accountingApi.getBrandingThemes(
    xeroClient.tenantId,
    getClientHeaders(),
  );
  return brandingThemes.body.brandingThemes ?? [];
}

/**
 * List all branding themes from Xero
 */
export async function listXeroBrandingThemes(): Promise<
  XeroClientResponse<BrandingTheme[]>
> {
  try {
    const brandingThemes = await getBrandingThemes();

    return {
      result: brandingThemes,
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
