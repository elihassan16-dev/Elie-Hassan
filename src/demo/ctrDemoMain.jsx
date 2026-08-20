// Entry for the contractor-portal preview page (ctrdemo.html) — renders the
// REAL ContractorPortal against ctrMockData + a contractor-flavored auth stub.
import React from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/inter";
import "../index.css";
import { ContractorPortal } from "../contractors/ContractorPortal";
createRoot(document.getElementById("root")).render(<ContractorPortal />);
