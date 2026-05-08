import { Link } from "@tanstack/react-router";
import { Sparkles } from "lucide-react";

export function AskifyFab() {
  return (
    <Link
      to="/askify"
      aria-label="Open Askify AI"
      className="group fixed bottom-6 right-6 z-40 grid h-14 w-14 place-items-center rounded-full bg-gradient-to-br from-violet-500 via-fuchsia-500 to-blue-500 text-white shadow-lg shadow-violet-500/40 transition-transform hover:scale-110 active:scale-95 animate-bounce-slow"
    >
      <span className="absolute inset-0 -z-10 animate-ping rounded-full bg-violet-500/40" />
      <span className="absolute inset-0 -z-10 rounded-full bg-gradient-to-br from-violet-500 to-blue-500 blur-2xl opacity-70 group-hover:opacity-100 transition-opacity" />
      <span className="absolute -inset-1 -z-10 rounded-full bg-gradient-to-br from-violet-500/50 via-fuchsia-500/50 to-blue-500/50 blur-md opacity-0 group-hover:opacity-100 transition-opacity" />
      <Sparkles className="h-6 w-6 drop-shadow group-hover:rotate-12 transition-transform" />
    </Link>
  );
}
