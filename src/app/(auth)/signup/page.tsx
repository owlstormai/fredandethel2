import type { Metadata } from "next";
import { SignupForm } from "@/components/auth/SignupForm";
import { voiceOptions } from "@/components/landing/voices";

export const metadata: Metadata = { title: "Create account" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function SignupPage(props: { searchParams: SearchParams }) {
  const searchParams = await props.searchParams;
  const raw = Array.isArray(searchParams.voice) ? searchParams.voice[0] : searchParams.voice;
  const initialVoice = raw === "fred" || raw === "ethel" ? raw : undefined;
  return <SignupForm voices={voiceOptions()} initialVoice={initialVoice} />;
}
