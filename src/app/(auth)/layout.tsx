import Link from "next/link";
import { Wordmark } from "@/components/layout/Wordmark";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="mx-auto flex h-[4.5rem] w-full max-w-6xl items-center px-4 sm:px-6">
        <Link href="/" aria-label="Back to Companion home" className="rounded-full py-2">
          <Wordmark />
        </Link>
      </header>
      <main id="main" className="flex flex-1 flex-col items-center justify-center px-4 pb-16 pt-4 sm:px-6">
        {children}
      </main>
    </div>
  );
}
