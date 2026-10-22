"use client";
import Link from "next/link";
import { useEffect } from "react";
import { Button, buttonClassName } from "@/components/ui/Button";
import { Wordmark } from "@/components/layout/Wordmark";

export default function ErrorPage({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    // Keep diagnostics in the console only; never show raw errors to users.
    console.error(error);
  }, [error]);

  const digest = error instanceof Error && "digest" in error ? String((error as { digest?: string }).digest ?? "") : "";

  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
      <Wordmark className="mb-10" />
      <h1 className="text-[2rem] font-semibold leading-tight">Something went wrong on our side.</h1>
      <p className="mt-3 max-w-md text-[1.125rem] text-muted">It isn&apos;t anything you did. You can try again, or head back to the start.</p>
      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
        <Button variant="primary" size="xl" onClick={() => retry()}>
          Try again
        </Button>
        <Link href="/" className={buttonClassName("secondary", "xl")}>
          Home
        </Link>
      </div>
      {digest ? <p className="mt-8 font-mono text-[0.85rem] text-subtle">Reference: {digest}</p> : null}
    </main>
  );
}
