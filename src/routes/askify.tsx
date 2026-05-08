import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Send, Sparkles, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/askify")({
  component: AskifyPage,
});

type Msg = { role: "user" | "assistant"; content: string; id: string };

const SUGGESTIONS = [
  "Ask anything",
  "Help me write a message",
  "Explain a topic simply",
  "Give me an idea",
];

const STORAGE_KEY = "askify-history-v1";
const MIN_INTERVAL_MS = 1500;

function AskifyPage() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const lastSentRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setMessages(JSON.parse(raw));
    } catch {}
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-50)));
    } catch {}
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || loading) return;
    const now = Date.now();
    if (now - lastSentRef.current < MIN_INTERVAL_MS) {
      toast.error("Please slow down a moment.");
      return;
    }
    lastSentRef.current = now;

    const userMsg: Msg = { role: "user", content: trimmed, id: crypto.randomUUID() };
    const next = [...messages, userMsg];
    setMessages(next);
    setInput("");
    setLoading(true);

    try {
      const resp = await fetch("/api/askify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: next.map((m) => ({ role: m.role, content: m.content })),
        }),
      });
      const data = (await resp.json()) as { content?: string; error?: string };
      if (!resp.ok || !data.content) throw new Error(data.error || "Failed");
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: data.content!, id: crypto.randomUUID() },
      ]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Askify AI failed to respond");
    } finally {
      setLoading(false);
    }
  }

  function clearChat() {
    setMessages([]);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {}
  }

  return (
    <div className="flex h-dvh flex-col bg-background">
      <header className="flex items-center gap-3 border-b bg-card/80 px-4 py-3 backdrop-blur">
        <Link to="/chats">
          <Button variant="ghost" size="icon" aria-label="Back">
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </Link>
        <div className="relative">
          <Avatar className="h-10 w-10 ring-2 ring-primary/40">
            <AvatarFallback className="bg-gradient-to-br from-violet-500 to-blue-500 text-white">
              <Sparkles className="h-5 w-5" />
            </AvatarFallback>
          </Avatar>
          <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-online ring-2 ring-card" />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-base font-semibold leading-tight">Askify AI</h1>
          <p className="truncate text-xs text-muted-foreground">AI assistant • always online</p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={clearChat}
          aria-label="Clear chat"
          disabled={messages.length === 0}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-4 sm:px-6">
        {messages.length === 0 && (
          <div className="mx-auto flex max-w-md flex-col items-center gap-4 pt-8 text-center animate-fade-in">
            <div className="grid h-16 w-16 place-items-center rounded-full bg-gradient-to-br from-violet-500 to-blue-500 text-white shadow-lg shadow-violet-500/30">
              <Sparkles className="h-7 w-7" />
            </div>
            <div>
              <h2 className="text-xl font-bold">Hey, I'm Askify AI</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Ask me anything — ideas, explanations, writing help.
              </p>
            </div>
            <div className="grid w-full grid-cols-2 gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="rounded-xl border bg-card/60 px-3 py-3 text-left text-sm hover:bg-accent transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="mx-auto flex max-w-2xl flex-col gap-2">
          {messages.map((m) => (
            <div
              key={m.id}
              className={cn(
                "group flex animate-fade-in items-end gap-1.5",
                m.role === "user" ? "justify-end" : "justify-start",
              )}
            >
              {m.role === "user" && (
                <button
                  type="button"
                  onClick={() => setMessages((prev) => prev.filter((x) => x.id !== m.id))}
                  className="opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity p-1.5 rounded-full hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                  aria-label="Delete message"
                  title="Delete message"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
              <div
                className={cn(
                  "max-w-[80%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-sm shadow-sm",
                  m.role === "user"
                    ? "bg-bubble-out text-bubble-out-foreground rounded-br-md"
                    : "bg-bubble-in text-bubble-in-foreground rounded-bl-md",
                )}
              >
                {m.content}
              </div>
              {m.role === "assistant" && (
                <button
                  type="button"
                  onClick={() => setMessages((prev) => prev.filter((x) => x.id !== m.id))}
                  className="opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity p-1.5 rounded-full hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                  aria-label="Delete message"
                  title="Delete message"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ))}
          {loading && (
            <div className="flex justify-start animate-fade-in">
              <div className="rounded-2xl rounded-bl-md bg-bubble-in px-4 py-3 shadow-sm">
                <div className="flex gap-1">
                  <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:-0.3s]" />
                  <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:-0.15s]" />
                  <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/60" />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="border-t bg-card/80 px-3 py-3 backdrop-blur sm:px-6"
      >
        <div className="mx-auto flex max-w-2xl items-end gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Message Askify AI…"
            disabled={loading}
            className="rounded-full bg-background"
          />
          <Button
            type="submit"
            size="icon"
            disabled={loading || !input.trim()}
            className="rounded-full bg-gradient-to-br from-violet-500 to-blue-500 hover:opacity-90"
            aria-label="Send"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
        <p className="mx-auto mt-2 max-w-2xl text-center text-[10px] text-muted-foreground">
          Askify AI can make mistakes. Verify important info.
        </p>
      </form>
    </div>
  );
}
