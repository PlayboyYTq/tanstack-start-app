import { MessageCircle } from "lucide-react";

export function AppLoader({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="min-h-screen grid place-items-center px-4">
      <div className="surface-glass w-full max-w-sm rounded-[2rem] p-8 text-center">
        <div className="mx-auto grid size-14 place-items-center rounded-3xl bg-primary/10 text-primary">
          <MessageCircle className="size-6 animate-pulse" />
        </div>
        <h1 className="mt-5 text-2xl font-semibold tracking-tight">{title}</h1>
        {detail ? <p className="mt-2 text-sm leading-6 text-muted-foreground">{detail}</p> : null}
      </div>
    </div>
  );
}