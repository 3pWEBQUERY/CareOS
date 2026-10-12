import { pharmacyOrders } from "@/lib/pharmacy";
import { withPortal } from "../portal-route";

export const runtime = "nodejs";

export const GET = () =>
  withPortal("Bestellungen konnten nicht geladen werden.", async (sql, actor) => ({
    orders: await pharmacyOrders(sql, actor),
  }));
