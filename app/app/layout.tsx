import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Greenlit Playground",
  description: "Run a live Greenlit demo against the playground repo."
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
