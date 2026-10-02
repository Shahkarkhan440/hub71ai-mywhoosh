export const NESQA_SESSION_KEY = "nesqa_session_id";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ??
  process.env.NEXT_PUBLIC_NESQA_API_URL?.replace(/\/$/, "") ??
  "http://127.0.0.1:8000";

export type NesqaStage =
  | "choose_mode"
  | "collect_items"
  | "clarify_product"
  | "offer_more"
  | "review_cart"
  | "confirm_address"
  | "new_address"
  | "confirm_instructions"
  | "new_instructions"
  | "confirm_phone"
  | "new_phone"
  | "confirm_delivery_time"
  | "confirm_payment"
  | "final_confirmation"
  | "completed"
  | "cancelled"
  | string;

export type NesqaCartItem = {
  product_id: string;
  name: string;
  size: string;
  quantity?: number;
  vendor_id: string;
  vendor_name: string;
  brand: string;
  unit_price: number;
  promotion?: string | null;
};

export type NesqaDeal = {
  product_id: string;
  name: string;
  size: string;
  vendor_name: string;
  price: number;
  promotion: string;
};

export type NesqaAddress = {
  id: string;
  label: string;
  address: string;
  delivery_instructions?: string;
};

export type NesqaPaymentMethod = {
  id?: string;
  label: string;
  type: string;
  last4: string;
};

export type NesqaOrder = {
  order_id?: string;
  status?: string;
  total?: number;
  currency?: string;
  delivery_address?: NesqaAddress & { delivery_instructions?: string };
  payment_method?: NesqaPaymentMethod;
  phone?: string;
  delivery_time?: NesqaDeliveryTime;
  created_at?: string;
  note?: string;
};

export type NesqaStoredOrder = {
  order_id: string;
  status: string;
  session_id: string;
  mode: string;
  items: NesqaCartItem[];
  subtotal: number;
  delivery_fee: number;
  total: number;
  currency: string;
  delivery_address: NesqaAddress & { delivery_instructions?: string };
  payment_method: NesqaPaymentMethod;
  phone: string;
  delivery_time: {
    delivery_at?: string;
    display_text: string;
    timezone: string;
  };
  created_at: string;
  note?: string;
};

export type NesqaOrdersResponse = {
  orders: NesqaStoredOrder[];
  count: number;
};

export type NesqaDeliveryTime = {
  delivery_at: string;
  display_text: string;
  timezone: string;
};

export type NesqaChatResponse = {
  session_id: string;
  mode?: string | null;
  stage: NesqaStage;
  reply: string;
  cart?: NesqaCartItem[];
  subtotal?: number;
  requires_confirmation?: boolean;
  match_source?: string | null;
  history_length?: number;
  available_deals?: NesqaDeal[];
  available_addresses?: NesqaAddress[];
  available_payment_methods?: NesqaPaymentMethod[];
  order?: NesqaOrder | null;
  delivery_time?: NesqaDeliveryTime | null;
};

export type NesqaHistoryMessage = {
  role: "user" | "assistant";
  content: string;
  created_at?: string;
};

export type NesqaHistoryResponse = {
  session_id: string;
  stage: NesqaStage;
  history: NesqaHistoryMessage[];
};

export type NesqaSessionResponse = {
  session_id: string;
  mode?: string | null;
  stage: NesqaStage;
  cart?: NesqaCartItem[];
  subtotal?: number;
  history_length?: number;
  delivery_time?: NesqaDeliveryTime | null;
};

export class NesqaApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "NesqaApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...init?.headers,
      },
    });
  } catch {
    throw new NesqaApiError(
      "NESQA could not reach the local agent. Make sure nesqa-agent is running on 127.0.0.1:8000.",
    );
  }

  if (!response.ok) {
    let detail = `NESQA request failed (${response.status}).`;
    try {
      const body = (await response.json()) as { detail?: string };
      if (body.detail) detail = body.detail;
    } catch {
      // Keep the safe fallback message when the response is not JSON.
    }
    throw new NesqaApiError(detail, response.status);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export function sendChatMessage(input: {
  message: string;
  sessionId?: string | null;
}): Promise<NesqaChatResponse> {
  const payload = input.sessionId
    ? { session_id: input.sessionId, message: input.message }
    : { mode: "express", message: input.message };

  return request<NesqaChatResponse>("/api/chat", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function getSessionHistory(sessionId: string): Promise<NesqaHistoryResponse> {
  return request<NesqaHistoryResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/history`);
}

export function getSession(sessionId: string): Promise<NesqaSessionResponse> {
  return request<NesqaSessionResponse>(`/api/sessions/${encodeURIComponent(sessionId)}`);
}

export function getOrders(): Promise<NesqaOrdersResponse> {
  return request<NesqaOrdersResponse>("/api/orders");
}

export function deleteSession(sessionId: string): Promise<void> {
  return request<void>(`/api/sessions/${encodeURIComponent(sessionId)}`, {
    method: "DELETE",
  });
}
