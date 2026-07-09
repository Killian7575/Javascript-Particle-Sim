import { createRoot } from "react-dom/client";
import { AppController } from "../app/app.ts";
import { SettingsSidebar } from "./SettingsSidebar.tsx";

export function mountUI(controller: AppController) {
    const root = createRoot(document.getElementById("ui-root")!);
    root.render(<SettingsSidebar controller={controller} />);
}



