"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  Check,
  CircleStop,
  LoaderCircle,
  MapPin,
  MessageCircle,
  Mic,
  PackageCheck,
  Percent,
  Phone,
  Plus,
  Send,
  ShoppingBag,
  Sparkles,
  Square,
  Tag,
  Volume2,
  WalletCards,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  NESQA_SESSION_KEY,
  NesqaApiError,
  type NesqaAddress,
  type NesqaCartItem,
  type NesqaChatResponse,
  type NesqaDeal,
  type NesqaHistoryMessage,
  type NesqaOrder,
  type NesqaPaymentMethod,
  type NesqaStage,
  deleteSession,
  getSession,
  getSessionHistory,
  sendChatMessage,
} from "@/lib/nesqa-api";
import { NesqaVoiceClient, type NesqaVoiceStatus } from "@/lib/nesqa-voice";

export type ExpressState = {
  cart: NesqaCartItem[];
  subtotal: number;
  stage: NesqaStage;
  loading: boolean;
  order: NesqaOrder | null;
};

type ExpressChatProps = {
  onStateChange: (state: ExpressState) => void;
};

const initialMessage = "Type your groceries, or tap the microphone once for a hands-free conversation.";

const confettiPieces = Array.from({ length: 42 }, (_, index) => ({
  id: index,
  left: (index * 37) % 100,
  delay: ((index * 13) % 47) / 100,
  duration: 2.3 + ((index * 17) % 12) / 10,
  width: 6 + (index % 4) * 2,
  height: 10 + (index % 3) * 4,
  color: ["#ffe557", "#28a77b", "#10253f", "#f19a4c", "#4a8dc4"][index % 5],
}));

function OrderConfetti() {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-[70] overflow-hidden">
      {confettiPieces.map((piece) => (
        <span
          key={piece.id}
          className="nesqa-confetti"
          style={{
            left: `${piece.left}%`,
            width: piece.width,
            height: piece.height,
            borderRadius: piece.id % 3 === 0 ? "999px" : "2px",
            backgroundColor: piece.color,
            animationDelay: `${piece.delay}s`,
            animationDuration: `${piece.duration}s`,
          }}
        />
      ))}
    </div>
  );
}

function stageProgress(stage: NesqaStage) {
  if (["completed", "cancelled"].includes(stage)) return 4;
  if (stage === "final_confirmation") return 3;
  if (["confirm_address", "new_address", "confirm_instructions", "new_instructions", "confirm_phone", "new_phone", "confirm_delivery_time", "confirm_payment"].includes(stage)) return 2;
  if (stage === "review_cart") return 1;
  return 0;
}

function AgentActivity({ stage, loading, voiceStatus }: { stage: NesqaStage; loading: boolean; voiceStatus: NesqaVoiceStatus }) {
  const progress = stageProgress(stage);
  const steps = [
    { title: "Build your grocery list", detail: "Find products and update the live basket", icon: ShoppingBag },
    { title: "Review your cart", detail: "Confirm items before checkout", icon: Check },
    { title: "Confirm delivery details", detail: "Address, note, phone, and payment", icon: MapPin },
    { title: "Place your order", detail: "Requires your explicit final confirmation", icon: PackageCheck },
  ];

  return (
    <aside aria-label="Live agent activity" className="flex min-h-[520px] flex-col border-t border-[#e4e9ed] bg-[#f5f8fa] p-5 sm:p-6 lg:min-h-0 lg:border-l lg:border-t-0">
      <div className="flex items-start justify-between gap-3">
        <div><p className="text-xs font-bold uppercase tracking-[0.13em] text-[#8492a2]">Live activity</p><h3 className="font-display mt-1 text-xl font-extrabold leading-tight tracking-[-0.035em] text-[#10253f]">What NESQA is doing</h3></div>
        <span className="flex items-center gap-1.5 rounded-full border border-[#dbe5e1] bg-white px-2.5 py-1.5 text-[11px] font-bold text-[#28775f] shadow-sm"><span className="size-1.5 rounded-full bg-[#28a77b]" /> Live</span>
      </div>

      <div className="mt-4 rounded-2xl bg-[#10253f] p-3.5 text-white shadow-[0_12px_28px_rgba(16,37,63,.14)]">
        <div className="flex items-center gap-2 text-xs font-semibold text-white/60"><Sparkles className="size-3.5 text-[#ffe557]" /> Backend stage</div>
        <p className="mt-1.5 break-words text-[13px] font-semibold leading-5">{stage.replaceAll("_", " ")}</p>
      </div>

      <ol className="mt-3 flex-1">
        {steps.map((step, index) => {
          const done = progress > index || (progress === 4 && index === 3);
          const active = !done && progress === index;
          const Icon = step.icon;
          return (
            <li key={step.title} className="relative flex gap-2.5 pb-2 last:pb-0">
              {index < steps.length - 1 && <span className={`absolute left-[15px] top-8 h-[calc(100%-20px)] w-px ${done ? "bg-[#99cdbb]" : "bg-[#d8e0e6]"}`} />}
              <span className={`relative z-10 grid size-8 shrink-0 place-items-center rounded-[11px] border ${done ? "border-[#cce8de] bg-[#e9f7f2] text-[#16805f]" : active ? "border-[#f0dc64] bg-[#fff4a4] text-[#10253f]" : "border-[#dfe6eb] bg-white text-[#9aa6b2]"}`}>{active && loading ? <LoaderCircle className="size-4 animate-spin" /> : done ? <Check className="size-4" /> : <Icon className="size-4" />}</span>
              <div className={`min-w-0 flex-1 rounded-xl border px-3 py-2 ${active ? "border-[#eadc86] bg-white shadow-[0_8px_22px_rgba(16,37,63,.06)]" : "border-transparent"}`}>
                <div className="flex items-center justify-between gap-2"><p className={`text-[13px] font-bold ${!done && !active ? "text-[#7f8d9c]" : "text-[#20364d]"}`}>{step.title}</p>{done && <span className="text-[10px] font-bold uppercase tracking-wide text-[#268166]">Done</span>}{active && <span className="text-[10px] font-bold uppercase tracking-wide text-[#8a7600]">{loading ? "Working" : "Current"}</span>}</div>
                <p className="mt-0.5 text-[11px] leading-4 text-[#8290a0]">{step.detail}</p>
              </div>
            </li>
          );
        })}
      </ol>
      <div className="mt-3 flex items-center justify-between border-t border-[#dfe6eb] pt-3 text-[11px] text-[#7b8998]"><span>Session-backed checkout</span><span className="flex items-center gap-1.5 font-semibold capitalize text-[#40536a]">{voiceStatus === "speaking" && <Volume2 className="size-3.5" />}{voiceStatus === "idle" ? "Text + voice" : `Voice ${voiceStatus}`}</span></div>
    </aside>
  );
}

export function ExpressChat({ onStateChange }: ExpressChatProps) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<NesqaHistoryMessage[]>([]);
  const [stage, setStage] = useState<NesqaStage>("collect_items");
  const [cart, setCart] = useState<NesqaCartItem[]>([]);
  const [subtotal, setSubtotal] = useState(0);
  const [deals, setDeals] = useState<NesqaDeal[]>([]);
  const [addresses, setAddresses] = useState<NesqaAddress[]>([]);
  const [payments, setPayments] = useState<NesqaPaymentMethod[]>([]);
  const [order, setOrder] = useState<NesqaOrder | null>(null);
  const [completionReply, setCompletionReply] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [voiceStatus, setVoiceStatus] = useState<NesqaVoiceStatus>("idle");
  const [voiceTranscript, setVoiceTranscript] = useState("");
  const scrollerRef = useRef<HTMLDivElement>(null);
  const voiceClientRef = useRef<NesqaVoiceClient | null>(null);
  const completedVoiceSessionRef = useRef<string | null>(null);
  const completionResetTimerRef = useRef<number | null>(null);

  useEffect(() => {
    onStateChange({ cart, subtotal, stage, loading: loading || restoring || ["connecting", "processing"].includes(voiceStatus), order });
  }, [cart, loading, onStateChange, order, restoring, stage, subtotal, voiceStatus]);

  useEffect(() => {
    scrollerRef.current?.scrollTo({ top: scrollerRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading, deals, stage, voiceTranscript]);

  useEffect(() => {
    let cancelled = false;
    const restore = async () => {
      const savedSessionId = window.localStorage.getItem(NESQA_SESSION_KEY);
      if (!savedSessionId) {
        setRestoring(false);
        return;
      }
      try {
        const [history, session] = await Promise.all([
          getSessionHistory(savedSessionId),
          getSession(savedSessionId),
        ]);
        if (cancelled) return;
        setSessionId(savedSessionId);
        setMessages(history.history ?? []);
        setStage(session.stage);
        setCart(session.cart ?? []);
        setSubtotal(session.subtotal ?? 0);
      } catch (cause) {
        if (cancelled) return;
        if (cause instanceof NesqaApiError && cause.status === 404) {
          window.localStorage.removeItem(NESQA_SESSION_KEY);
          setError("Your previous NESQA session expired. Start a new order below.");
        } else {
          setError(cause instanceof Error ? cause.message : "Could not restore your NESQA session.");
        }
      } finally {
        if (!cancelled) setRestoring(false);
      }
    };
    void restore();
    return () => { cancelled = true; };
  }, []);

  const applyResponse = useCallback((response: NesqaChatResponse) => {
    setSessionId(response.session_id);
    window.localStorage.setItem(NESQA_SESSION_KEY, response.session_id);
    setStage(response.stage);
    setCart(response.cart ?? []);
    setSubtotal(response.subtotal ?? 0);
    setDeals(response.available_deals ?? []);
    setAddresses(response.available_addresses ?? []);
    setPayments(response.available_payment_methods ?? []);
    setOrder(response.order ?? null);
    if (response.stage === "completed") setCompletionReply(response.reply);
    setMessages((current) => [...current, { role: "assistant", content: response.reply }]);
  }, []);

  const resetShoppingUi = useCallback(() => {
    setSessionId(null);
    setMessages([]);
    setStage("collect_items");
    setCart([]);
    setSubtotal(0);
    setDeals([]);
    setAddresses([]);
    setPayments([]);
    setOrder(null);
    setCompletionReply(null);
    setInput("");
    setVoiceTranscript("");
    setError(null);
    completedVoiceSessionRef.current = null;
    completionResetTimerRef.current = null;
  }, []);

  const finishCompletedConversation = useCallback(async (completedSessionId: string) => {
    voiceClientRef.current?.disconnect(false);
    setVoiceTranscript("");
    window.localStorage.removeItem(NESQA_SESSION_KEY);
    setSessionId(null);
    if (completionResetTimerRef.current !== null) window.clearTimeout(completionResetTimerRef.current);
    completionResetTimerRef.current = window.setTimeout(resetShoppingUi, 3000);
    try {
      await deleteSession(completedSessionId);
    } catch (cause) {
      if (!(cause instanceof NesqaApiError && cause.status === 404)) {
        setError("Your order was placed, but NESQA could not clear the completed session automatically.");
      }
    }
  }, [resetShoppingUi]);

  useEffect(() => {
    const client = new NesqaVoiceClient({
      onStatus: setVoiceStatus,
      onSession: (voiceSessionId, voiceStage) => {
        setSessionId(voiceSessionId);
        setStage(voiceStage);
        window.localStorage.setItem(NESQA_SESSION_KEY, voiceSessionId);
      },
      onTranscript: (transcript) => setVoiceTranscript(transcript),
      onResponse: (response, transcript) => {
        if (transcript.trim()) {
          setMessages((current) => [...current, { role: "user", content: transcript.trim() }]);
        }
        setVoiceTranscript("");
        if (response.stage === "completed") completedVoiceSessionRef.current = response.session_id;
        applyResponse(response);
      },
      onPlaybackComplete: () => {
        const completedSessionId = completedVoiceSessionRef.current;
        if (!completedSessionId) return;
        completedVoiceSessionRef.current = null;
        void finishCompletedConversation(completedSessionId);
      },
      onError: (message, code) => {
        setError(message);
        if (code === "session_not_found") {
          window.localStorage.removeItem(NESQA_SESSION_KEY);
          setSessionId(null);
          setCart([]);
          setSubtotal(0);
          setStage("collect_items");
        }
      },
    });
    voiceClientRef.current = client;
    return () => {
      if (completionResetTimerRef.current !== null) window.clearTimeout(completionResetTimerRef.current);
      voiceClientRef.current = null;
      client.disconnect(false);
    };
  }, [applyResponse, finishCompletedConversation]);

  const toggleVoice = async () => {
    setError(null);
    if (["connecting", "recording", "processing", "speaking"].includes(voiceStatus)) {
      voiceClientRef.current?.stopConversation();
      setVoiceTranscript("");
      return;
    }
    try {
      await voiceClientRef.current?.startConversation(sessionId);
    } catch {
      // The voice client reports a user-facing error with the specific cause.
    }
  };

  const send = async (rawMessage: string) => {
    const message = rawMessage.trim();
    if (!message || loading || restoring) return;
    setError(null);
    setLoading(true);
    setMessages((current) => [...current, { role: "user", content: message }]);
    try {
      const response = await sendChatMessage({ message, sessionId });
      applyResponse(response);
      if (response.stage === "completed") await finishCompletedConversation(response.session_id);
    } catch (cause) {
      if (cause instanceof NesqaApiError && cause.status === 404) {
        window.localStorage.removeItem(NESQA_SESSION_KEY);
        setSessionId(null);
        setCart([]);
        setSubtotal(0);
        setStage("collect_items");
        setError("This session expired on the NESQA agent. Start a new order with your grocery list.");
      } else {
        setError(cause instanceof Error ? cause.message : "Something went wrong while talking to NESQA.");
      }
    } finally {
      setLoading(false);
    }
  };

  const submitInput = () => {
    const value = input.trim();
    if (!value) return;
    setInput("");
    if (stage === "new_address") void send(`Add address ${value}`);
    else void send(value);
  };

  const endConversation = async () => {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      voiceClientRef.current?.disconnect(false);
      if (sessionId) await deleteSession(sessionId);
      window.localStorage.removeItem(NESQA_SESSION_KEY);
      setSessionId(null);
      setMessages([]);
      setStage("collect_items");
      setCart([]);
      setSubtotal(0);
      setDeals([]);
      setAddresses([]);
      setPayments([]);
      setOrder(null);
      setCompletionReply(null);
      setInput("");
      setVoiceTranscript("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not end the conversation.");
    } finally {
      setLoading(false);
    }
  };

  const restoredOptionsUnavailable =
    (stage === "confirm_address" && addresses.length === 0) ||
    (stage === "confirm_payment" && payments.length === 0);
  const showInput = restoredOptionsUnavailable || !["confirm_address", "confirm_instructions", "confirm_phone", "confirm_payment", "final_confirmation", "completed", "cancelled", "review_cart"].includes(stage);
  const placeholder = stage === "new_address" ? "Apartment, building, area, Abu Dhabi" : stage === "new_instructions" ? "Add a delivery note…" : stage === "new_phone" ? "+971 5X XXX XXXX" : restoredOptionsUnavailable ? "Reply using the option shown in the conversation…" : "Type your groceries or reply to NESQA…";
  const voiceBusy = ["connecting", "processing", "speaking"].includes(voiceStatus);
  const voiceActive = ["connecting", "recording", "processing", "speaking"].includes(voiceStatus);
  const voiceDisabled = !voiceActive && (restoring || loading || ["completed", "cancelled"].includes(stage));
  const voiceLabel = voiceActive ? "End voice conversation" : "Start voice conversation";

  return (
    <section className="grid h-full min-h-[560px] overflow-hidden rounded-[26px] border border-[#dfe6eb] bg-white shadow-[0_18px_60px_rgba(16,37,63,.07)] lg:min-h-0 lg:grid-cols-[minmax(0,1fr)_39%]">
      {stage === "completed" && <OrderConfetti />}
      <div className="flex min-h-[560px] min-w-0 flex-col lg:min-h-0">
        <div className="flex items-center justify-between gap-3 border-b border-[#edf1f4] px-5 py-4 sm:px-6">
          <div><Badge className="rounded-full border-0 bg-[#fff7b8] px-3 py-1 text-[#655a00]"><MessageCircle className="size-3.5" /> NESQA shopping</Badge><p className="mt-1.5 text-xs text-[#8290a0]">{sessionId ? "Conversation in progress" : "New order"}</p></div>
          {sessionId && <Button onClick={() => void endConversation()} disabled={loading} variant="outline" size="sm" className="rounded-xl border-[#dfe6eb] text-[#526477]"><CircleStop className="size-4" /> End conversation</Button>}
        </div>

        <div ref={scrollerRef} className="scrollbar-thin min-h-0 flex-1 space-y-4 overflow-y-auto bg-[#fbfcfd] px-4 py-5 sm:px-6">
          {messages.length === 0 && !restoring && (
            <div className="mx-auto flex h-full max-w-md flex-col items-center justify-center py-10 text-center"><span className="grid size-14 place-items-center rounded-2xl bg-[#10253f] text-[#ffe557]"><Sparkles className="size-6" /></span><h1 className="font-display mt-4 text-2xl font-extrabold tracking-tight text-[#10253f]">Start your order</h1><p className="mt-2 text-sm leading-6 text-[#718093]">{initialMessage}</p><div className="mt-5 flex flex-wrap justify-center gap-2">{["I need eggs, milk and bread", "Add fruit and yogurt"].map((text) => <button key={text} onClick={() => void send(text)} className="rounded-full border border-[#dfe6eb] bg-white px-3.5 py-2 text-[13px] font-semibold text-[#40536a] shadow-sm hover:bg-[#f5f8fa]">{text}</button>)}</div></div>
          )}
          {messages.map((message, index) => (
            <div key={`${message.role}-${index}`} className={`flex animate-in fade-in slide-in-from-bottom-2 duration-300 ${message.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[86%] rounded-2xl px-4 py-3 text-sm leading-6 shadow-sm ${message.role === "user" ? "rounded-br-md bg-[#10253f] text-white" : "rounded-bl-md border border-[#e1e7eb] bg-white text-[#30465d]"}`}>{message.content}</div>
            </div>
          ))}
          {voiceTranscript && <div className="flex justify-end"><div className="max-w-[86%] rounded-2xl rounded-br-md border border-[#27445f] bg-[#183551] px-4 py-3 text-sm leading-6 text-white shadow-sm"><span className="mr-2 inline-flex items-center gap-0.5 align-middle" aria-hidden="true"><span className="h-2 w-0.5 animate-pulse rounded-full bg-[#ffe557]" /><span className="h-3 w-0.5 animate-pulse rounded-full bg-[#ffe557] [animation-delay:120ms]" /><span className="h-2 w-0.5 animate-pulse rounded-full bg-[#ffe557] [animation-delay:240ms]" /></span>{voiceTranscript}</div></div>}
          {loading && <div className="flex justify-start"><div className="flex items-center gap-2 rounded-2xl rounded-bl-md border border-[#e1e7eb] bg-white px-4 py-3 text-sm text-[#718093] shadow-sm"><LoaderCircle className="size-4 animate-spin text-[#10253f]" /> NESQA is thinking…</div></div>}
          {voiceStatus === "processing" && <div className="flex justify-start"><div className="flex items-center gap-2 rounded-2xl rounded-bl-md border border-[#e1e7eb] bg-white px-4 py-3 text-sm text-[#718093] shadow-sm"><LoaderCircle className="size-4 animate-spin text-[#10253f]" /> Understanding your request…</div></div>}
          {restoring && <div className="flex h-full items-center justify-center gap-2 text-sm font-semibold text-[#718093]"><LoaderCircle className="size-4 animate-spin" /> Restoring your conversation…</div>}

          {deals.length > 0 && (
            <div className="grid gap-2 sm:grid-cols-2">{deals.map((deal) => <article key={`${deal.product_id}-${deal.vendor_name}`} className="rounded-2xl border border-[#dfe6eb] bg-white p-3 shadow-sm"><div className="flex items-start justify-between gap-2"><span className="grid size-9 place-items-center rounded-xl bg-[#fff7b8] text-[#10253f]"><Percent className="size-4" /></span><span className="text-sm font-extrabold text-[#10253f]">AED {deal.price.toFixed(2)}</span></div><p className="mt-3 text-sm font-extrabold text-[#23384f]">{deal.name}</p><p className="mt-0.5 text-xs text-[#8290a0]">{deal.size} · {deal.vendor_name}</p><p className="mt-2 text-xs font-bold text-[#17785d]">{deal.promotion}</p><Button onClick={() => void send(`Add ${deal.name}`)} disabled={loading} size="sm" className="mt-3 w-full rounded-xl bg-[#10253f]"><Plus className="size-3.5" /> Add</Button></article>)}</div>
          )}
        </div>

        <div className="border-t border-[#e7ecef] bg-white p-4 sm:px-6">
          {error && <div role="alert" className="mb-3 flex items-start gap-2 rounded-xl border border-[#f0caca] bg-[#fff2f2] px-3 py-2.5 text-xs leading-5 text-[#a54040]"><AlertCircle className="mt-0.5 size-4 shrink-0" />{error}</div>}

          {stage === "offer_more" && <div className="mb-3 flex flex-wrap gap-2"><Button onClick={() => void send("What is on deal today?")} disabled={loading} variant="outline" size="sm" className="rounded-full"><Tag className="size-3.5" /> Show deals</Button><Button onClick={() => void send("That's all")} disabled={loading} size="sm" className="rounded-full bg-[#10253f]">Finish adding</Button></div>}
          {stage === "review_cart" && <div className="mb-3 rounded-2xl bg-[#f5f8fa] p-3"><div className="flex items-center justify-between"><span className="text-sm font-semibold text-[#526477]">Cart subtotal</span><span className="font-display text-lg font-extrabold text-[#10253f]">AED {subtotal.toFixed(2)}</span></div><div className="mt-3 grid grid-cols-2 gap-2"><Button onClick={() => void send("Yes")} disabled={loading} className="rounded-xl bg-[#10253f]">Confirm cart</Button><Button onClick={() => void send("Change cart")} disabled={loading} variant="outline" className="rounded-xl">Change cart</Button></div></div>}
          {stage === "confirm_address" && <div className="mb-3 space-y-2">{addresses.map((address) => <button key={address.id} onClick={() => void send(address.label)} disabled={loading} className="flex w-full items-start gap-3 rounded-2xl border border-[#dfe6eb] bg-white p-3 text-left hover:border-[#10253f]"><span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[#fff7b8]"><MapPin className="size-4" /></span><span><span className="block text-sm font-extrabold text-[#10253f]">Use {address.label}</span><span className="mt-0.5 block text-xs leading-5 text-[#718093]">{address.address}</span></span></button>)}<Button onClick={() => void send("new address")} disabled={loading} variant="outline" className="w-full rounded-xl"><Plus className="size-4" /> Add new address</Button></div>}
          {stage === "new_address" && <p className="mb-2 text-xs leading-5 text-[#718093]">Enter the complete address, including apartment or villa, building, area, and Abu Dhabi. Delivery is currently limited to Abu Dhabi.</p>}
          {stage === "confirm_instructions" && <div className="mb-3 grid gap-2 sm:grid-cols-3"><Button onClick={() => void send("Yes")} disabled={loading} className="rounded-xl bg-[#10253f]">Keep saved note</Button><Button onClick={() => void send("Update note")} disabled={loading} variant="outline" className="rounded-xl">Update note</Button><Button onClick={() => void send("None")} disabled={loading} variant="outline" className="rounded-xl">No instructions</Button></div>}
          {stage === "confirm_phone" && <div className="mb-3 grid grid-cols-2 gap-2"><Button onClick={() => void send("Yes")} disabled={loading} className="rounded-xl bg-[#10253f]">Keep phone</Button><Button onClick={() => void send("Update phone")} disabled={loading} variant="outline" className="rounded-xl"><Phone className="size-4" /> Update phone</Button></div>}
          {stage === "confirm_delivery_time" && <div className="mb-3 flex flex-wrap gap-2"><Button onClick={() => void send("Tonight")} disabled={loading} variant="outline" size="sm" className="rounded-full">Tonight</Button><Button onClick={() => void send("Tomorrow morning")} disabled={loading} variant="outline" size="sm" className="rounded-full">Tomorrow morning</Button><Button onClick={() => { setInput("Tomorrow at 6 PM"); }} disabled={loading} variant="outline" size="sm" className="rounded-full">Choose another time</Button></div>}
          {stage === "confirm_payment" && <div className="mb-3 space-y-2">{payments.map((payment) => <button key={payment.id ?? `${payment.type}-${payment.last4}`} onClick={() => void send(payment.label || payment.id || payment.type)} disabled={loading} className="flex w-full items-center gap-3 rounded-2xl border border-[#dfe6eb] bg-white p-3 text-left hover:border-[#10253f]"><span className="grid size-9 place-items-center rounded-xl bg-[#f1f5f7]"><WalletCards className="size-4" /></span><span className="flex-1"><span className="block text-sm font-extrabold text-[#10253f]">{payment.label}</span><span className="block text-xs text-[#718093]">{payment.type} ending {payment.last4}</span></span></button>)}</div>}
          {stage === "final_confirmation" && <div className="mb-3 rounded-2xl border-2 border-[#10253f] bg-[#f8fafb] p-4"><div className="flex justify-between text-sm"><span className="font-semibold text-[#526477]">{cart.length} basket items</span><span className="font-display font-extrabold text-[#10253f]">AED {subtotal.toFixed(2)} + fees</span></div><p className="mt-2 text-xs leading-5 text-[#718093]">Review NESQA’s message above. The order is placed only after explicit confirmation.</p><div className="mt-3 grid grid-cols-2 gap-2"><Button onClick={() => void send("Confirm order")} disabled={loading} className="rounded-xl bg-[#ffe557] font-extrabold text-[#10253f] hover:bg-[#ffdf2d]">Confirm order</Button><Button onClick={() => void send("Cancel")} disabled={loading} variant="outline" className="rounded-xl">Cancel</Button></div></div>}
          {stage === "completed" && <div className="mb-3 animate-in zoom-in-95 rounded-2xl border border-[#bfe5d7] bg-[#eaf8f3] p-4 duration-500"><div className="flex items-start gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white text-[#17785d] shadow-sm"><PackageCheck className="size-5" /></span><div><p className="font-display font-extrabold text-[#154c3d]">Order placed</p><p className="mt-1 text-xs font-semibold leading-5 text-[#4e776c]">{completionReply}</p><p className="mt-1 text-xs text-[#4e776c]">{order?.order_id ?? "Demo order"} · {order?.currency ?? "AED"} {(order?.total ?? subtotal).toFixed(2)}</p></div></div><p className="mt-3 text-xs font-semibold text-[#4e776c]">Starting a fresh order in a moment…</p></div>}
          {stage === "cancelled" && <div className="mb-3 rounded-2xl bg-[#f3f5f6] p-4 text-center"><p className="font-display font-extrabold text-[#30465d]">Order cancelled</p><p className="mt-1 text-xs text-[#718093]">No order was placed and no payment was charged.</p><Button onClick={() => void endConversation()} disabled={loading} variant="outline" className="mt-3 w-full rounded-xl">End conversation</Button></div>}

          <div className="flex items-end gap-2">
            {showInput && <div className="flex min-w-0 flex-1 items-center gap-2 rounded-2xl border border-[#d8e0e6] bg-[#f8fafb] p-2 pl-4 focus-within:border-[#9faebb] focus-within:ring-4 focus-within:ring-[#dfe8ee]/70"><Input type={stage === "new_phone" ? "tel" : "text"} value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => event.key === "Enter" && submitInput()} disabled={loading || restoring} className="h-10 border-0 bg-transparent p-0 text-[15px] shadow-none focus-visible:ring-0" placeholder={placeholder} aria-label="Message NESQA" /><Button onClick={submitInput} disabled={loading || restoring || !input.trim()} size="icon" className="size-10 shrink-0 rounded-xl bg-[#10253f]" aria-label="Send message"><Send className="size-4" /></Button></div>}
            <Button onClick={() => void toggleVoice()} disabled={voiceDisabled} size="icon" aria-label={voiceLabel} title={voiceLabel} className={`relative size-14 shrink-0 rounded-2xl shadow-[0_10px_24px_rgba(16,37,63,.18)] ${voiceActive ? "bg-[#e5484d] text-white hover:bg-[#cf3f44]" : "bg-[#10253f] text-white hover:bg-[#183551]"}`}>
              {voiceActive ? <><span className="absolute inset-0 animate-ping rounded-2xl bg-[#e5484d]/20" />{voiceStatus === "connecting" ? <LoaderCircle className="relative size-5 animate-spin" /> : <Square className="relative size-4 fill-current" />}</> : <Mic className="size-5" />}
            </Button>
          </div>
          <p className="mt-2 text-right text-[11px] font-semibold text-[#8290a0]" aria-live="polite">{voiceStatus === "connecting" ? "Starting your voice conversation…" : voiceStatus === "recording" ? "Listening — just speak naturally" : voiceStatus === "processing" ? "NESQA is thinking…" : voiceStatus === "speaking" ? "NESQA is replying — listening resumes automatically" : "Tap once to start a hands-free conversation"}</p>
        </div>
      </div>
      <AgentActivity stage={stage} loading={loading || restoring || voiceBusy} voiceStatus={voiceStatus} />
    </section>
  );
}
