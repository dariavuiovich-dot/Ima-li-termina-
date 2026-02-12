import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ima li terminaaa!?",
  description: "Search KCCG specialist availability and first free slot"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
