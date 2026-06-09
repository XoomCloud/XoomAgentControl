import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "XoomAgent Control Platform",
  description: "Multi-tenant operations layer for isolated AI agent tenants.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
