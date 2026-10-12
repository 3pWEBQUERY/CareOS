import { updateOrderByPharmacy } from "@/lib/pharmacy";
import { withPortal } from "../../portal-route";

export const runtime = "nodejs";

// Apotheke: Bestellung bestätigen, als geliefert melden oder ablehnen ({ status, note?, expectedOn? }).
export const PATCH = async (request: Request, { params }: { params: Promise<{ orderId: string }> }) => {
  const { orderId } = await params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  return withPortal("Die Bestellung konnte nicht aktualisiert werden.", async (sql, actor) =>
    updateOrderByPharmacy(sql, actor, orderId, body),
  );
};
