import type { Metadata } from "next";
import { LoginForm } from "@/components/auth/LoginForm";

export const metadata: Metadata = { title: "Sign in" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Only same-origin, absolute-path redirects are honoured (never protocol-relative or external). */
function safeNext(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return undefined;
  return raw;
}

export default async function LoginPage(props: { searchParams: SearchParams }) {
  const params = await props.searchParams;
  return <LoginForm redirectTo={safeNext(params.next)} />;
}
