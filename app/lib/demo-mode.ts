// Explicit build modes only: runtime secrets and URL parameters cannot enable samples.
export const publicDemoMode = import.meta.env?.MODE === "public-demo";
export const demoMode = publicDemoMode
  || (import.meta.env?.DEV === true && import.meta.env?.MODE === "demo");
