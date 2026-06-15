import Link from "next/link";

export default function ForbiddenPage() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-4 text-center p-4">
      <h1 className="text-4xl font-bold">403</h1>
      <p className="text-muted-foreground text-lg">
        You don&apos;t have permission to access this page.
      </p>
      <Link
        href="/"
        className="text-sm underline underline-offset-4 text-muted-foreground hover:text-foreground"
      >
        Back to dashboard
      </Link>
    </div>
  );
}
