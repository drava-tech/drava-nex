import { registerTemplate } from "./template-registry";
import { ConsolePanelsTemplate } from "./console-panels";

registerTemplate("console-panels", ConsolePanelsTemplate);

// To add a new project type:
// 1. Create templates/<your-type>/index.tsx implementing TemplateProps<YourConfig>
// 2. Import and registerTemplate("<your-type>", YourTemplate) here
// 3. Set "type": "<your-type>" on the vertical or project entry in projects-data.json
