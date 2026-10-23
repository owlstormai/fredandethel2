import { LandingPage } from "@/components/landing/LandingPage";
import { voiceOptions } from "@/components/landing/voices";

export default function Home() {
  return <LandingPage voices={voiceOptions()} />;
}
