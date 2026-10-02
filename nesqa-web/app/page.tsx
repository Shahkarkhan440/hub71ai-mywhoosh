"use client";

import { useEffect, useState } from "react";
import {
  LoaderCircle, MapPin, PackageCheck, ShoppingBag, Store, Tag, UserRound, WalletCards,
} from "lucide-react";

import { ExpressChat, type ExpressState } from "@/components/express-chat";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { getOrders, type NesqaCartItem, type NesqaOrder, type NesqaStage, type NesqaStoredOrder } from "@/lib/nesqa-api";

declare global {
  interface Document {
    modelContext?: { registerTool: (tool: Record<string, unknown>, options?: { signal?: AbortSignal }) => void | Promise<void> };
  }
}

function Logo() {
  return (
    <div className="flex items-center gap-2.5" aria-label="NESQA home">
      <span className="grid size-9 place-items-center rounded-[12px] bg-[#ffe557] text-[#10253f] shadow-[inset_0_-2px_0_rgba(16,37,63,.12)]"><ShoppingBag className="size-[19px]" strokeWidth={2.4} /></span>
      <span className="font-display hidden text-xl font-extrabold tracking-[-0.04em] text-[#10253f] sm:inline">nesqa</span>
    </div>
  );
}

function HeaderNavigation() {
  const [ordersOpen, setOrdersOpen] = useState(false);
  const [orders, setOrders] = useState<NesqaStoredOrder[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [ordersError, setOrdersError] = useState<string | null>(null);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);

  const loadOrders = async () => {
    setOrdersLoading(true);
    setOrdersError(null);
    try {
      const response = await getOrders();
      const nextOrders = response.orders ?? [];
      setOrders(nextOrders);
      setSelectedOrderId((current) =>
        current && nextOrders.some((order) => order.order_id === current)
          ? current
          : nextOrders[0]?.order_id ?? null,
      );
    } catch (cause) {
      setOrdersError(cause instanceof Error ? cause.message : "Could not load your NESQA orders.");
    } finally {
      setOrdersLoading(false);
    }
  };

  const handleOrdersOpenChange = (open: boolean) => {
    setOrdersOpen(open);
    if (open) void loadOrders();
  };

  const selectedOrder = orders.find((order) => order.order_id === selectedOrderId) ?? null;

  const formatOrderDate = (value: string) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat("en-AE", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: "Asia/Dubai",
    }).format(date);
  };

  const statusLabel = (status: string) => status.replaceAll("_", " ");

  return (
    <nav className="ml-auto flex h-full items-center gap-3 text-xs font-bold text-[#6f7d8d] sm:ml-8 sm:gap-7 sm:text-sm" aria-label="Main navigation">
      <a href="#shop" className="relative flex h-full items-center text-[#10253f] after:absolute after:inset-x-0 after:bottom-0 after:h-[3px] after:rounded-full after:bg-[#ffe557]">Shop</a>

      <Dialog open={ordersOpen} onOpenChange={handleOrdersOpenChange}>
        <DialogTrigger asChild><button className="whitespace-nowrap transition-colors hover:text-[#10253f]">My Order</button></DialogTrigger>
        <DialogContent className="max-h-[90vh] overflow-hidden rounded-[24px] border-[#dfe6eb] bg-[#f7f9fa] p-0 sm:max-w-[820px]">
          <DialogHeader className="border-b border-[#e3e8ec] bg-white px-6 py-5 pr-14">
            <DialogTitle className="font-display text-2xl font-extrabold tracking-tight text-[#10253f]">My orders</DialogTitle>
            <DialogDescription>{ordersLoading ? "Loading your NESQA orders…" : `${orders.length} ${orders.length === 1 ? "order" : "orders"} placed with NESQA.`}</DialogDescription>
          </DialogHeader>
          <div className="scrollbar-thin max-h-[calc(90vh-105px)] overflow-y-auto p-5 sm:p-6">
            {ordersLoading && <div className="flex min-h-64 items-center justify-center gap-2 text-sm font-semibold text-[#718093]"><LoaderCircle className="size-5 animate-spin text-[#10253f]" /> Loading orders…</div>}
            {!ordersLoading && ordersError && <div role="alert" className="flex min-h-64 flex-col items-center justify-center rounded-2xl border border-[#efcccc] bg-[#fff4f4] p-6 text-center"><p className="text-sm font-bold text-[#a54040]">Couldn’t load your orders</p><p className="mt-2 max-w-md text-xs leading-5 text-[#946060]">{ordersError}</p><Button onClick={() => void loadOrders()} variant="outline" size="sm" className="mt-4 rounded-xl border-[#e4bcbc] bg-white">Try again</Button></div>}
            {!ordersLoading && !ordersError && orders.length === 0 && <div className="flex min-h-64 flex-col items-center justify-center text-center"><span className="grid size-14 place-items-center rounded-2xl bg-white text-[#8a97a5] shadow-sm"><ShoppingBag className="size-6" /></span><p className="font-display mt-4 text-lg font-extrabold text-[#23384f]">No orders yet</p><p className="mt-2 max-w-sm text-sm leading-6 text-[#718093]">Your completed NESQA grocery orders will appear here.</p></div>}
            {!ordersLoading && !ordersError && orders.length > 0 && <div className="grid gap-4 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
              <div className="space-y-2">
                {orders.map((order) => {
                  const itemCount = order.items.reduce((count, item) => count + (item.quantity ?? 1), 0);
                  const vendors = [...new Set(order.items.map((item) => item.vendor_name))].join(", ");
                  const selected = order.order_id === selectedOrderId;
                  return (
                    <button key={order.order_id} type="button" onClick={() => setSelectedOrderId(order.order_id)} className={`w-full rounded-2xl border p-4 text-left transition ${selected ? "border-[#10253f] bg-white shadow-[0_10px_28px_rgba(16,37,63,.09)]" : "border-[#dfe6eb] bg-white/70 hover:border-[#bdcad3] hover:bg-white"}`}>
                      <div className="flex items-start gap-3"><span className={`grid size-10 shrink-0 place-items-center rounded-xl ${selected ? "bg-[#fff4a4] text-[#10253f]" : "bg-[#f1f5f7] text-[#526477]"}`}><PackageCheck className="size-5" /></span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center justify-between gap-2"><p className="truncate font-display text-sm font-extrabold text-[#10253f]">{order.order_id}</p><span className="rounded-full bg-[#e8f8f2] px-2 py-1 text-[9px] font-extrabold uppercase tracking-wide text-[#17785d]">{statusLabel(order.status)}</span></div><p className="mt-1 text-xs text-[#8290a0]">{formatOrderDate(order.created_at)}</p><div className="mt-3 flex items-end justify-between gap-3 border-t border-dashed border-[#dfe6eb] pt-3"><div className="min-w-0"><p className="truncate text-xs font-bold text-[#40536a]">{vendors || "Vendor unavailable"}</p><p className="mt-0.5 text-[11px] text-[#8a97a5]">{itemCount} {itemCount === 1 ? "item" : "items"}</p></div><p className="shrink-0 font-display text-base font-extrabold text-[#10253f]">{order.currency} {order.total.toFixed(2)}</p></div></div></div>
                    </button>
                  );
                })}
              </div>

              {selectedOrder && <article className="rounded-2xl border border-[#dfe6eb] bg-white p-5 shadow-[0_8px_24px_rgba(16,37,63,.05)]">
                <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-[0.12em] text-[#8492a2]">Order details</p><h3 className="font-display mt-1 text-lg font-extrabold text-[#10253f]">{selectedOrder.order_id}</h3></div><span className="rounded-full bg-[#e8f8f2] px-3 py-1.5 text-[10px] font-extrabold uppercase tracking-wide text-[#17785d]">{statusLabel(selectedOrder.status)}</span></div>
                <div className="mt-4 space-y-2 border-y border-dashed border-[#dfe6eb] py-4">{selectedOrder.items.map((item) => <div key={`${selectedOrder.order_id}-${item.product_id}`} className="flex items-center justify-between gap-3 text-sm"><div className="min-w-0"><p className="truncate font-bold text-[#30465d]">{item.quantity ?? 1}× {item.name}</p><p className="text-xs text-[#8290a0]">{item.size} · {item.vendor_name}</p></div><p className="shrink-0 font-bold text-[#10253f]">{selectedOrder.currency} {(item.unit_price * (item.quantity ?? 1)).toFixed(2)}</p></div>)}</div>
                <dl className="mt-4 space-y-2 text-sm"><div className="flex justify-between text-[#718093]"><dt>Subtotal</dt><dd>{selectedOrder.currency} {selectedOrder.subtotal.toFixed(2)}</dd></div><div className="flex justify-between text-[#718093]"><dt>Delivery</dt><dd>{selectedOrder.currency} {selectedOrder.delivery_fee.toFixed(2)}</dd></div><div className="flex justify-between border-t border-[#e7ecef] pt-3 font-extrabold text-[#10253f]"><dt>Total</dt><dd className="font-display text-lg">{selectedOrder.currency} {selectedOrder.total.toFixed(2)}</dd></div></dl>
                <div className="mt-4 space-y-3 rounded-2xl bg-[#f5f8fa] p-4 text-xs leading-5 text-[#526477]"><div className="flex gap-2"><MapPin className="mt-0.5 size-4 shrink-0 text-[#10253f]" /><div><p className="font-extrabold text-[#30465d]">{selectedOrder.delivery_address.label}</p><p>{selectedOrder.delivery_address.address}</p>{selectedOrder.delivery_address.delivery_instructions && <p className="mt-1 italic text-[#718093]">“{selectedOrder.delivery_address.delivery_instructions}”</p>}</div></div><div className="flex gap-2"><WalletCards className="mt-0.5 size-4 shrink-0 text-[#10253f]" /><p><span className="font-extrabold text-[#30465d]">{selectedOrder.payment_method.label}</span><br />{selectedOrder.payment_method.type} ending {selectedOrder.payment_method.last4}</p></div><div className="flex gap-2"><PackageCheck className="mt-0.5 size-4 shrink-0 text-[#10253f]" /><p><span className="font-extrabold text-[#30465d]">Delivery time</span><br />{selectedOrder.delivery_time.display_text}</p></div></div>
                {selectedOrder.note && <p className="mt-3 text-[11px] leading-5 text-[#8a97a5]">{selectedOrder.note}</p>}
              </article>}
            </div>}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog>
        <DialogTrigger asChild><button className="whitespace-nowrap transition-colors hover:text-[#10253f]">My Profile</button></DialogTrigger>
        <DialogContent className="max-h-[88vh] overflow-y-auto rounded-[24px] border-[#dfe6eb] bg-[#f7f9fa] p-0 sm:max-w-[680px]">
          <DialogHeader className="border-b border-[#e3e8ec] bg-white px-6 py-5 pr-14">
            <DialogTitle className="font-display text-2xl font-extrabold tracking-tight text-[#10253f]">My profile</DialogTitle>
            <DialogDescription>Your account, delivery addresses, and payment methods.</DialogDescription>
          </DialogHeader>
          <div className="space-y-5 p-5 sm:p-6">
            <section className="flex items-center gap-4 rounded-2xl bg-[#10253f] p-5 text-white">
              <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-[#ffe557] text-[#10253f]"><UserRound className="size-6" /></span>
              <div><h3 className="font-display text-xl font-extrabold">Shahkar Khan</h3><p className="mt-1 text-sm text-white/65">shahkar@example.com · +971 50 123 4567</p></div>
            </section>

            <section>
              <div className="mb-2 flex items-center justify-between"><h3 className="font-display font-extrabold text-[#10253f]">Saved addresses</h3><span className="text-xs font-bold text-[#718093]">2 saved</span></div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border-2 border-[#10253f] bg-white p-4"><div className="flex items-center justify-between"><span className="grid size-9 place-items-center rounded-xl bg-[#fff7b8] text-[#10253f]"><MapPin className="size-4" /></span><Badge className="border-0 bg-[#e8f8f2] text-[#17785d]">Default</Badge></div><p className="mt-3 font-extrabold text-[#10253f]">Home</p><p className="mt-1 text-sm leading-5 text-[#718093]">Al Reem Island<br />Abu Dhabi, UAE</p></div>
                <div className="rounded-2xl border border-[#dfe6eb] bg-white p-4"><span className="grid size-9 place-items-center rounded-xl bg-[#f1f5f7] text-[#526477]"><MapPin className="size-4" /></span><p className="mt-3 font-extrabold text-[#10253f]">Work</p><p className="mt-1 text-sm leading-5 text-[#718093]">Al Maryah Island<br />Abu Dhabi, UAE</p></div>
              </div>
            </section>

            <section>
              <div className="mb-2 flex items-center justify-between"><h3 className="font-display font-extrabold text-[#10253f]">Payment methods</h3><span className="text-xs font-bold text-[#718093]">2 saved</span></div>
              <div className="space-y-2">
                <div className="flex items-center gap-3 rounded-2xl border-2 border-[#10253f] bg-white p-4"><span className="grid size-10 place-items-center rounded-xl bg-[#10253f] text-white"><WalletCards className="size-5" /></span><div className="flex-1"><p className="font-extrabold text-[#10253f]">Apple Pay</p><p className="text-xs text-[#8290a0]">Default payment method</p></div><Badge className="border-0 bg-[#e8f8f2] text-[#17785d]">Default</Badge></div>
                <div className="flex items-center gap-3 rounded-2xl border border-[#dfe6eb] bg-white p-4"><span className="grid size-10 place-items-center rounded-xl bg-[#f1f5f7] text-[#526477]"><WalletCards className="size-5" /></span><div className="flex-1"><p className="font-extrabold text-[#10253f]">Visa ending 4242</p><p className="text-xs text-[#8290a0]">Expires 08/29</p></div></div>
              </div>
            </section>
          </div>
        </DialogContent>
      </Dialog>
    </nav>
  );
}

/* The original voice-only prototype is kept here temporarily for design reference.
function VoiceOrb({ listening, onClick }: { listening: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-label={listening ? "Stop listening" : "Start voice shopping"} className="group relative grid size-[106px] shrink-0 place-items-center rounded-full focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#ffe557]/70">
      <span className={`absolute inset-0 rounded-full bg-[#ffe557]/25 transition-transform duration-500 ${listening ? "animate-ping" : "group-hover:scale-110"}`} />
      <span className="absolute inset-[9px] rounded-full bg-[#ffe557]/45" />
      <span className="relative grid size-[70px] place-items-center rounded-full bg-[#10253f] text-white shadow-[0_16px_34px_rgba(16,37,63,.24)] transition-transform group-hover:scale-[1.04]">{listening ? <X className="size-6" /> : <Mic className="size-6" />}</span>
    </button>
  );
}

function CartPanel({ items, updateQty, onRemove }: { items: CartItem[]; updateQty: (id: number, delta: number) => void; onRemove: (id: number) => void }) {
  const subtotal = items.reduce((sum, item) => sum + item.price * item.qty, 0);
  const delivery = items.length ? 7 : 0;
  const total = subtotal + delivery;
  const vendorSelected = items.length >= initialItems.length;
  return (
    <aside className="flex min-h-0 flex-col overflow-hidden rounded-[26px] border border-[#dfe6eb] bg-white shadow-[0_18px_60px_rgba(16,37,63,.08)]">
      <div className="flex items-center justify-between border-b border-[#edf1f4] px-5 py-4">
        <div>
          <p className="font-display text-lg font-bold tracking-tight text-[#10253f]">Your basket</p>
          <div className="mt-1 flex items-center gap-1.5 text-[13px] text-[#708094]">
            <span>{items.reduce((sum, item) => sum + item.qty, 0)} items</span>
            <span>·</span>
            {vendorSelected ? (
              <span className="animate-in fade-in flex items-center gap-1.5 font-extrabold text-[#10253f] duration-500"><Store className="size-3.5" /> Carrefour <span className="rounded-full bg-[#e8f8f2] px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wide text-[#17785d]">Selected</span></span>
            ) : items.length > 0 ? (
              <span className="flex items-center gap-1.5 font-semibold text-[#718093]"><LoaderCircle className="size-3.5 animate-spin" /> Selecting vendor…</span>
            ) : (
              <span>Vendor not selected</span>
            )}
          </div>
        </div>
        <span className="grid size-9 place-items-center rounded-full bg-[#f3f6f8] text-[#10253f]"><ShoppingBag className="size-4" /></span>
      </div>
      <div className="scrollbar-thin flex-1 space-y-1 overflow-y-auto p-3">
        {items.length === 0 && (
          <div className="flex h-full min-h-[230px] flex-col items-center justify-center px-6 text-center">
            <span className="grid size-16 place-items-center rounded-2xl bg-[#f3f6f8] text-[#9aa6b2]"><ShoppingBag className="size-7" /></span>
            <p className="font-display mt-4 text-lg font-bold text-[#23384f]">Your basket is empty</p>
            <p className="mt-2 max-w-[230px] text-[13px] leading-5 text-[#8290a0]">Start speaking and watch NESQA add the best matches one by one.</p>
          </div>
        )}
        {items.map((item) => (
          <div key={item.id} className="group animate-in fade-in slide-in-from-right-5 flex items-center gap-3 rounded-2xl p-2.5 duration-500 transition-colors hover:bg-[#f8fafb]">
            <div className={`grid size-12 shrink-0 place-items-center rounded-[14px] text-2xl ${item.tone}`}>{item.emoji}</div>
            <div className="min-w-0 flex-1"><p className="truncate text-[14px] font-semibold text-[#1d3048]">{item.name}</p><p className="mt-0.5 text-xs text-[#8290a0]">{item.detail}</p><p className="mt-1.5 text-[13px] font-bold text-[#10253f]">AED {(item.price * item.qty).toFixed(2)}</p></div>
            <div className="flex flex-col items-center gap-1 rounded-full border border-[#e4e9ed] bg-white p-1 shadow-sm">
              <button onClick={() => updateQty(item.id, 1)} className="grid size-6 place-items-center rounded-full text-[#10253f] hover:bg-[#fff5a7]" aria-label={`Add one ${item.name}`}><Plus className="size-3.5" /></button>
              <span className="text-xs font-bold">{item.qty}</span>
              <button onClick={() => item.qty > 1 ? updateQty(item.id, -1) : onRemove(item.id)} className="grid size-6 place-items-center rounded-full text-[#7f8b99] hover:bg-[#f2f4f6]" aria-label={`Remove one ${item.name}`}>{item.qty > 1 ? <Minus className="size-3.5" /> : <Trash2 className="size-3.5" />}</button>
            </div>
          </div>
        ))}
      </div>
      <div className="border-t border-[#edf1f4] p-5">
        {items.length > 0 && <div className="animate-in fade-in mb-3 flex items-center justify-between rounded-xl bg-[#f6f9fb] px-3 py-2 text-[13px] duration-500"><span className="flex items-center gap-2 text-[#607083]"><Tag className="size-3.5" /> You saved</span><span className="font-bold text-[#158262]">AED 9.25</span></div>}
        <div className="space-y-2 text-[13px] text-[#68788a]"><div className="flex justify-between"><span>Subtotal</span><span>AED {subtotal.toFixed(2)}</span></div><div className="flex justify-between"><span>Delivery</span><span>{items.length ? `AED ${delivery.toFixed(2)}` : "—"}</span></div><div className="flex items-end justify-between border-t border-dashed border-[#dbe2e8] pt-3 text-[#10253f]"><span className="font-semibold">Total</span><span className="font-display text-xl font-extrabold">AED {total.toFixed(2)}</span></div></div>
        <Sheet>
          <SheetTrigger asChild><Button disabled={!vendorSelected} className="mt-4 h-12 w-full rounded-xl bg-[#10253f] text-[15px] font-bold text-white shadow-[0_10px_24px_rgba(16,37,63,.18)] hover:bg-[#183551] disabled:bg-[#d8e0e6] disabled:text-[#8a97a5] disabled:shadow-none">{vendorSelected ? "Review & checkout" : items.length ? "Selecting best vendor…" : "Basket is empty"}</Button></SheetTrigger>
          <SheetContent className="w-full border-l-0 bg-[#f7f9fa] sm:max-w-[460px]">
            <SheetHeader className="border-b border-[#e3e8ec] bg-white px-6 py-5"><SheetTitle className="font-display text-2xl font-bold text-[#10253f]">Ready to order</SheetTitle><SheetDescription>Review the details before NESQA places your order.</SheetDescription></SheetHeader>
            <div className="space-y-4 overflow-y-auto p-6">
              <div className="rounded-2xl bg-[#10253f] p-5 text-white"><p className="text-sm text-white/65">Delivery estimate</p><div className="mt-2 flex items-center gap-3"><Clock3 className="size-5 text-[#ffe557]" /><span className="font-display text-xl font-bold">25–35 minutes</span></div></div>
              <div className="rounded-2xl border border-[#e1e7eb] bg-white p-5"><div className="flex items-start gap-3"><MapPin className="mt-0.5 size-5 text-[#10253f]" /><div><p className="font-semibold text-[#10253f]">Home</p><p className="mt-1 text-sm leading-6 text-[#6d7b8c]">Dubai Marina · Apartment 1204</p></div></div></div>
              <div className="rounded-2xl border border-[#e1e7eb] bg-white p-5"><div className="flex items-start gap-3"><WalletCards className="mt-0.5 size-5 text-[#10253f]" /><div><p className="font-semibold text-[#10253f]">Apple Pay</p><p className="mt-1 text-sm text-[#6d7b8c]">Default payment method</p></div></div></div>
              <div className="rounded-2xl border border-[#e1e7eb] bg-white p-5"><div className="flex justify-between text-sm text-[#6d7b8c]"><span>{items.length} basket items</span><span>Carrefour</span></div><div className="mt-4 flex justify-between border-t border-dashed border-[#dbe2e8] pt-4"><span className="font-semibold text-[#10253f]">Order total</span><span className="font-display text-xl font-extrabold text-[#10253f]">AED {total.toFixed(2)}</span></div></div>
            </div>
            <SheetFooter className="border-t border-[#e3e8ec] bg-white p-6"><Button className="h-12 rounded-xl bg-[#ffe557] font-bold text-[#10253f] hover:bg-[#ffdf2d]"><PackageCheck className="size-5" /> Place order</Button><p className="text-center text-xs text-[#8290a0]">You’ll confirm payment securely before the order is sent.</p></SheetFooter>
          </SheetContent>
        </Sheet>
      </div>
    </aside>
  );
}

function AgentActions({ listening, cartCount }: { listening: boolean; cartCount: number }) {
  const actions: Array<{ title: string; detail: string; icon: typeof Mic; status: "done" | "active" | "queued" }> = listening
    ? [
        { title: "Understood your request", detail: "Milk, avocados, and sourdough", icon: Mic, status: cartCount >= 1 ? "done" : "active" },
        { title: "Searching nearby stores", detail: "Checking Carrefour, Spinneys, and Lulu", icon: Search, status: cartCount >= 2 ? "done" : cartCount === 1 ? "active" : "queued" },
        { title: "Comparing prices & offers", detail: "Checking totals, promos, and availability", icon: Tag, status: cartCount >= 3 ? "done" : cartCount === 2 ? "active" : "queued" },
        { title: "Updating your basket", detail: `${cartCount} of 3 items added`, icon: ShoppingBag, status: cartCount >= 3 ? "done" : cartCount > 0 ? "active" : "queued" },
      ]
    : cartCount >= 3 ? [
        { title: "Understood your request", detail: "Milk, avocados, and sourdough", icon: Check, status: "done" },
        { title: "Searched nearby stores", detail: "Carrefour, Spinneys, and Lulu checked", icon: Search, status: "done" },
        { title: "Compared prices & offers", detail: "Found AED 9.25 in available savings", icon: Tag, status: "done" },
        { title: "Updated your basket", detail: "3 items ready for your review", icon: ShoppingBag, status: "done" },
      ] : [
        { title: "Waiting for your request", detail: "Tap the microphone and tell me what you need", icon: Mic, status: "active" },
        { title: "Search nearby stores", detail: "I’ll check price and availability", icon: Search, status: "queued" },
        { title: "Compare prices & offers", detail: "I’ll find the strongest overall value", icon: Tag, status: "queued" },
        { title: "Update your basket", detail: "Products will appear one by one", icon: ShoppingBag, status: "queued" },
      ];

  return (
    <aside aria-label="Live agent activity" aria-live="polite" className="flex min-h-[520px] flex-col border-t border-[#e4e9ed] bg-[#f5f8fa] p-5 sm:p-6 lg:min-h-0 lg:border-l lg:border-t-0">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.13em] text-[#8492a2]">Live activity</p>
          <h3 className="font-display mt-1 text-xl font-extrabold leading-tight tracking-[-0.035em] text-[#10253f]">What NESQA is doing</h3>
        </div>
        <span className="flex items-center gap-1.5 rounded-full border border-[#dbe5e1] bg-white px-2.5 py-1.5 text-[11px] font-bold text-[#28775f] shadow-sm"><span className="size-1.5 rounded-full bg-[#28a77b]" /> Live</span>
      </div>

      <div className="mt-4 rounded-2xl bg-[#10253f] p-3.5 text-white shadow-[0_12px_28px_rgba(16,37,63,.14)]">
        <div className="flex items-center gap-2 text-xs font-semibold text-white/60"><Sparkles className="size-3.5 text-[#ffe557]" /> Current request</div>
        <p className="mt-1.5 text-[13px] font-semibold leading-5">{listening ? "“Milk, avocados, and sourdough — find the best value.”" : cartCount ? "“Find my everyday items and choose the best-value options.”" : "Waiting for your shopping request…"}</p>
      </div>

      <ol className="mt-3 flex-1">
        {actions.map((action, index) => {
          const Icon = action.icon;
          const isDone = action.status === "done";
          const isActive = action.status === "active";
          return (
            <li key={action.title} className="relative flex gap-2.5 pb-2 last:pb-0">
              {index < actions.length - 1 && <span className={`absolute left-[15px] top-8 h-[calc(100%-20px)] w-px ${isDone ? "bg-[#99cdbb]" : "bg-[#d8e0e6]"}`} />}
              <span className={`relative z-10 grid size-8 shrink-0 place-items-center rounded-[11px] border ${isDone ? "border-[#cce8de] bg-[#e9f7f2] text-[#16805f]" : isActive ? "border-[#f0dc64] bg-[#fff4a4] text-[#10253f] shadow-[0_5px_14px_rgba(224,195,38,.2)]" : "border-[#dfe6eb] bg-white text-[#9aa6b2]"}`}>
                {isActive ? <LoaderCircle className="size-4 animate-spin" /> : <Icon className="size-4" />}
              </span>
              <div className={`min-w-0 flex-1 rounded-xl border px-3 py-2 ${isActive ? "border-[#eadc86] bg-white shadow-[0_8px_22px_rgba(16,37,63,.06)]" : "border-transparent"}`}>
                <div className="flex items-center justify-between gap-2">
                  <p className={`text-[13px] font-bold ${action.status === "queued" ? "text-[#7f8d9c]" : "text-[#20364d]"}`}>{action.title}</p>
                  {isDone && <span className="text-[10px] font-bold uppercase tracking-wide text-[#268166]">Done</span>}
                  {isActive && <span className="text-[10px] font-bold uppercase tracking-wide text-[#8a7600]">Working</span>}
                </div>
                <p className="mt-0.5 text-[11px] leading-4 text-[#8290a0]">{action.detail}</p>
              </div>
            </li>
          );
        })}
      </ol>

      <div className="mt-3 flex items-center justify-between border-t border-[#dfe6eb] pt-3 text-[11px] text-[#7b8998]">
        <span>{listening ? `${cartCount} of 3 items added` : "Ready for a new request"}</span>
        <span className="font-semibold text-[#40536a]">{listening ? "Shopping now" : "Updated just now"}</span>
      </div>
    </aside>
  );
}

function ExpressMode({ listening, setListening, onSuggestion, cartCount }: { listening: boolean; setListening: (v: boolean) => void; onSuggestion: (value: string) => void; cartCount: number }) {
  const [message, setMessage] = useState("");
  const submit = () => { if (message.trim()) { onSuggestion(message.trim()); setMessage(""); } };
  return (
    <TabsContent value="express" className="mt-0 h-full">
      <section className="grid h-full min-h-[550px] overflow-hidden rounded-[26px] border border-[#dfe6eb] bg-white shadow-[0_18px_60px_rgba(16,37,63,.07)] lg:min-h-0 lg:grid-cols-[minmax(0,1fr)_39%]">
        <div className="flex min-h-[520px] flex-col p-5 sm:p-7 lg:min-h-0 lg:p-6">
          <div className="flex items-center justify-between"><Badge className="rounded-full border-0 bg-[#fff7b8] px-3 py-1 text-[#655a00]"><Zap className="size-3.5 fill-current" /> Express session</Badge><span className="flex items-center gap-2 text-xs font-medium text-[#6f7d8c]"><span className="size-2 rounded-full bg-[#28a77b]" /> Agent ready</span></div>
          <div className="mx-auto flex w-full max-w-[620px] flex-1 flex-col items-center justify-center py-4 text-center">
            <div className="relative mb-4"><VoiceOrb listening={listening} onClick={() => setListening(!listening)} /><div className="absolute -right-14 top-1/2 hidden h-px w-12 bg-gradient-to-r from-[#c8d2da] to-transparent sm:block" /><div className="absolute -left-14 top-1/2 hidden h-px w-12 bg-gradient-to-l from-[#c8d2da] to-transparent sm:block" /></div>
            <p className="mb-2 text-sm font-semibold text-[#718093]">{listening ? "I’m listening…" : "Tap to start speaking"}</p>
            <h1 className="font-display max-w-[540px] text-[clamp(2rem,4vw,2.6rem)] font-extrabold leading-[1.02] tracking-[-0.055em] text-[#10253f]">What are we shopping for today?</h1>
            <p className="mt-3 max-w-[480px] text-[15px] leading-6 text-[#718093]">Tell me what you need. I’ll find the items, compare options, and keep your basket updated as we talk.</p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">{suggestions.slice(0, 2).map((suggestion) => <button key={suggestion} onClick={() => onSuggestion(suggestion)} className="rounded-full border border-[#dfe6eb] bg-white px-3.5 py-2 text-[13px] font-medium text-[#40536a] shadow-sm transition hover:-translate-y-0.5 hover:border-[#cad5dd] hover:bg-[#f8fafb]">{suggestion}</button>)}</div>
          </div>
          <div className="mx-auto flex w-full max-w-[650px] items-center gap-2 rounded-2xl border border-[#d8e0e6] bg-[#f8fafb] p-2 pl-4 shadow-[0_8px_24px_rgba(16,37,63,.06)] focus-within:border-[#9faebb] focus-within:ring-4 focus-within:ring-[#dfe8ee]/70"><Input value={message} onChange={(e) => setMessage(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} className="h-10 border-0 bg-transparent p-0 text-[15px] shadow-none focus-visible:ring-0" placeholder="Type an item or ask NESQA…" aria-label="Message NESQA" /><Button onClick={submit} size="icon" className="size-10 rounded-xl bg-[#10253f] text-white hover:bg-[#183551]" aria-label="Send message"><Send className="size-4" /></Button></div>
          <p className="mt-3 text-center text-[11px] text-[#9aa5b1]">Voice connection will activate when the NESQA agent is connected.</p>
        </div>
        <AgentActions listening={listening} cartCount={cartCount} />
      </section>
    </TabsContent>
  );
}

*/

function productEmoji(name: string) {
  const value = name.toLowerCase();
  if (value.includes("egg")) return "🥚";
  if (value.includes("milk")) return "🥛";
  if (value.includes("bread") || value.includes("loaf")) return "🥖";
  if (value.includes("rice")) return "🍚";
  if (value.includes("banana")) return "🍌";
  if (value.includes("apple")) return "🍎";
  if (value.includes("chicken")) return "🍗";
  if (value.includes("water")) return "💧";
  if (value.includes("yogurt")) return "🥣";
  if (value.includes("tomato")) return "🍅";
  if (value.includes("onion")) return "🧅";
  if (value.includes("tea")) return "🫖";
  return "🛒";
}

function CartPanel({
  items,
  subtotal,
  stage,
  loading,
  order,
}: {
  items: NesqaCartItem[];
  subtotal: number;
  stage: NesqaStage;
  loading: boolean;
  order: NesqaOrder | null;
}) {
  const itemCount = items.reduce((sum, item) => sum + (item.quantity ?? 1), 0);
  const vendors = [...new Set(items.map((item) => item.vendor_name).filter(Boolean))];
  const stageLabel = stage.replaceAll("_", " ");

  return (
    <aside className="flex min-h-0 flex-col overflow-hidden rounded-[26px] border border-[#dfe6eb] bg-white shadow-[0_18px_60px_rgba(16,37,63,.08)]">
      <div className="flex items-center justify-between border-b border-[#edf1f4] px-5 py-4">
        <div>
          <p className="font-display text-lg font-bold tracking-tight text-[#10253f]">Your basket</p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[13px] text-[#708094]">
            <span>{itemCount} {itemCount === 1 ? "item" : "items"}</span>
            <span>·</span>
            {vendors.length > 0 ? (
              <span className="animate-in fade-in flex items-center gap-1.5 font-extrabold text-[#10253f] duration-500">
                <Store className="size-3.5" />
                {vendors.length === 1 ? vendors[0] : `${vendors.length} vendors`}
                <span className="rounded-full bg-[#e8f8f2] px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wide text-[#17785d]">Selected</span>
              </span>
            ) : loading ? (
              <span className="flex items-center gap-1.5 font-semibold text-[#718093]"><LoaderCircle className="size-3.5 animate-spin" /> Finding products…</span>
            ) : (
              <span>Vendor not selected</span>
            )}
          </div>
        </div>
        <span className="grid size-9 place-items-center rounded-full bg-[#f3f6f8] text-[#10253f]"><ShoppingBag className="size-4" /></span>
      </div>

      <div className="scrollbar-thin flex-1 space-y-1 overflow-y-auto p-3">
        {items.length === 0 ? (
          <div className="flex h-full min-h-[230px] flex-col items-center justify-center px-6 text-center">
            <span className="grid size-16 place-items-center rounded-2xl bg-[#f3f6f8] text-[#9aa6b2]"><ShoppingBag className="size-7" /></span>
            <p className="font-display mt-4 text-lg font-bold text-[#23384f]">Your basket is empty</p>
            <p className="mt-2 max-w-[230px] text-[13px] leading-5 text-[#8290a0]">Tell NESQA what you need. Products will appear here one by one as the agent finds them.</p>
          </div>
        ) : items.map((item, index) => {
          const quantity = item.quantity ?? 1;
          return (
            <div key={`${item.product_id}-${item.vendor_id}`} style={{ animationDelay: `${index * 80}ms` }} className="animate-in fade-in slide-in-from-right-5 flex items-center gap-3 rounded-2xl p-2.5 duration-500 transition-colors hover:bg-[#f8fafb]">
              <div className="grid size-12 shrink-0 place-items-center rounded-[14px] bg-[#f3f6f8] text-2xl">{productEmoji(item.name)}</div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-semibold text-[#1d3048]">{item.name}</p>
                <p className="mt-0.5 truncate text-xs text-[#8290a0]">{item.size}{item.brand ? ` · ${item.brand}` : ""}</p>
                <p className="mt-1 text-[11px] font-bold text-[#607083]">{item.vendor_name}</p>
                {item.promotion && <p className="mt-1 text-[11px] font-bold text-[#17785d]">{item.promotion}</p>}
              </div>
              <div className="text-right">
                <p className="text-[13px] font-extrabold text-[#10253f]">AED {(item.unit_price * quantity).toFixed(2)}</p>
                <p className="mt-1 text-[11px] font-semibold text-[#8290a0]">Qty {quantity}</p>
              </div>
            </div>
          );
        })}
      </div>

      <div className="border-t border-[#edf1f4] p-5">
        <div className="mb-3 flex items-center justify-between rounded-xl bg-[#f6f9fb] px-3 py-2 text-[12px]">
          <span className="flex items-center gap-2 capitalize text-[#607083]">{loading ? <LoaderCircle className="size-3.5 animate-spin" /> : <Tag className="size-3.5" />}{loading ? "Agent working" : stageLabel}</span>
          <span className="font-semibold text-[#40536a]">Live cart</span>
        </div>
        <div className="flex items-end justify-between border-t border-dashed border-[#dbe2e8] pt-3 text-[#10253f]">
          <span className="font-semibold">{order?.total != null ? "Order total" : "Subtotal"}</span>
          <span className="font-display text-xl font-extrabold">AED {(order?.total ?? subtotal).toFixed(2)}</span>
        </div>
        <p className="mt-3 text-center text-[11px] leading-4 text-[#8290a0]">Checkout choices and confirmations stay in the NESQA chat.</p>
      </div>
    </aside>
  );
}

export default function Home() {
  const [expressState, setExpressState] = useState<ExpressState>({
    cart: [],
    subtotal: 0,
    stage: "collect_items",
    loading: true,
    order: null,
  });
  useEffect(() => {
    const context = document.modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const register = async () => {
      await context.registerTool({ name: "read_basket_summary", title: "Read basket summary", description: "Return the visible basket item count and current subtotal.", inputSchema: { type: "object", properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true, untrustedContentHint: false }, execute() { return { itemCount: expressState.cart.reduce((sum, item) => sum + (item.quantity ?? 1), 0), subtotalAED: Number(expressState.subtotal.toFixed(2)), stage: expressState.stage }; } }, { signal: lifecycle.signal });
    };
    void register().catch(() => undefined);
    return () => lifecycle.abort();
  }, [expressState.cart, expressState.stage, expressState.subtotal]);

  return (
    <main className="min-h-screen bg-[#f3f7f9] text-[#10253f]">
      <header className="sticky top-0 z-40 border-b border-[#dce4e9] bg-white/90 backdrop-blur-xl"><div className="mx-auto flex h-[72px] max-w-[1560px] items-center gap-4 px-4 sm:gap-5 sm:px-6 lg:px-8"><Logo /><HeaderNavigation /></div></header>
      <div id="shop" className="mx-auto flex max-w-[1560px] flex-col px-4 py-5 sm:px-6 lg:h-[calc(100vh-72px)] lg:px-8 lg:py-6">
        <div className="mb-4">
          <div>
            <p className="text-[12px] font-extrabold uppercase tracking-[0.14em] text-[#7b8998]">Welcome to NESQA</p>
            <h2 className="font-display mt-1 text-[clamp(1.35rem,2.2vw,1.85rem)] font-extrabold tracking-[-0.035em] text-[#10253f]">Abu Dhabi’s AI grocery shopping agent.</h2>
            <p className="mt-1 text-[13px] font-medium text-[#718093]">Say what you need. NESQA finds the best value and builds your basket.</p>
          </div>
        </div>
        <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_340px] xl:grid-cols-[minmax(0,1fr)_370px]"><div className="min-h-0"><ExpressChat onStateChange={setExpressState} /></div><CartPanel items={expressState.cart} subtotal={expressState.subtotal} stage={expressState.stage} loading={expressState.loading} order={expressState.order} /></div>
      </div>
    </main>
  );
}
