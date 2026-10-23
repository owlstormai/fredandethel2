import { Spinner } from "@/components/ui/Spinner";

export default function Loading() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-24 text-muted">
      <Spinner className="text-[2rem] text-accent" label="Loading page" />
      <p className="text-[1.0625rem]">One moment…</p>
    </div>
  );
}
