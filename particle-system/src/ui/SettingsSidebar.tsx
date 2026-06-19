import { useState } from "react";
import { AppController } from "../app/app.ts";
import { TunablesPanel } from "./components/panels/LiveParamsPanel.tsx";
import { StaticParamsPanel } from "./components/panels/StaticParamsPanel.tsx";

// Props: the "inputs" a component receives from whoever renders it.
// Think of it like a function signature.
interface Props {
  controller: AppController;
}

// A component is just a function that returns JSX.
// React calls this function whenever it needs to re-render.
export function SettingsSidebar({ controller }: Props) {

  // useState is how React tracks values that can change.
  // When `isOpen` changes, React re-runs this function and updates the DOM.
  // `setIsOpen` is the ONLY way to change it — never mutate directly.
  const [isOpen, setIsOpen] = useState(true);

  return (
    <div id="sidebar">

      {/* A button that toggles open/closed */}
      <button onClick={() => setIsOpen(!isOpen)}>
        {isOpen ? "Close" : "Settings"}
      </button>

      {/* Conditional rendering: only renders the panel div when isOpen is true */}
      <div id="sidebar-panel" style={{ display: isOpen ? "block" : "none" }}>
        <TunablesPanel controller={controller} />
        <StaticParamsPanel controller={controller} />
      </div>

    </div>
  );
}