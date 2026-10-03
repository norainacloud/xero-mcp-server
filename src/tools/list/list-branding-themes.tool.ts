import { listXeroBrandingThemes } from "../../handlers/list-xero-branding-themes.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const ListBrandingThemesTool = CreateXeroTool(
  "list-branding-themes",
  "Lists all branding themes in Xero. Use this tool to get the branding theme to assign to a contact.",
  {},
  async () => {
    const response = await listXeroBrandingThemes();
    if (response.isError) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error listing branding themes: ${response.error}`,
          },
        ],
      };
    }

    const brandingThemes = response.result;

    return {
      content: [
        {
          type: "text" as const,
          text: `Found ${brandingThemes.length} branding themes:`,
        },
        ...brandingThemes.map((theme) => ({
          type: "text" as const,
          text: [
            `Branding theme: ${theme.name}`,
            `ID: ${theme.brandingThemeID}`,
            theme.sortOrder === 0 ? "Default: Yes" : null,
          ]
            .filter(Boolean)
            .join("\n"),
        })),
      ],
    };
  },
);

export default ListBrandingThemesTool;
