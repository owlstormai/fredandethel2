import Link from "next/link";
import { buttonClassName } from "@/components/ui/Button";
import { Wordmark } from "@/components/layout/Wordmark";

export default function NotFound() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
      <Wordmark className="mb-10" />
      <h1 className="text-[2rem] font-semibold leading-tight">We couldn&apos;t find that page.</h1>
      <p className="mt-3 max-w-md text-[1.125rem] text-muted">Nothing to worry about. Let&apos;s get you back somewhere familiar.</p>
      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
        <Link href="/talk" className={buttonClassName("primary", "xl")}>
          Go to Talk
        </Link>
        <Link href="/" className={buttonClassName("secondary", "xl")}>
          Home
        </Link>
      </div>
    </main>
  );
}
