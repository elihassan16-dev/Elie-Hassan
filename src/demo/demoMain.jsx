// Tutorial-recording entry point: the real ContractorPortal, mocked data/auth.
import React from "react";
import { createRoot } from "react-dom/client";
import { ContractorPortal } from "../contractors/ContractorPortal";

createRoot(document.getElementById("root")).render(<ContractorPortal />);
