export function ChatListSkeleton() {
  return (
    <div className="px-2 pt-2 space-y-1 animate-pulse">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-3 py-3 rounded-2xl">
          <div className="size-12 rounded-full bg-muted/70" />
          <div className="flex-1 space-y-2">
            <div className="h-3.5 w-2/5 rounded bg-muted/70" />
            <div className="h-3 w-3/4 rounded bg-muted/50" />
          </div>
        </div>
      ))}
    </div>
  );
}
