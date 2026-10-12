"use client";

export type Product = {
  id: string;
  item_name: string;
  category: string;
  unit: string;
  description: string | null;
  default_target_quantity: number;
  current_stock_quantity: number;
  min_stock_quantity: number;
  status: "active" | "blocked" | "archived";
  created_at: string;
  updated_at: string;
};

export type Draft = {
  itemName: string;
  category: string;
  unit: string;
  description: string;
  defaultTargetQuantity: number;
  currentStockQuantity: number;
  minStockQuantity: number;
  status: Product["status"];
};

export const emptyDraft: Draft = {
  itemName: "",
  category: "Pflege & Hygiene",
  unit: "Stück",
  description: "",
  defaultTargetQuantity: 0,
  currentStockQuantity: 0,
  minStockQuantity: 0,
  status: "active",
};

export const categories = [
  "Pflege & Hygiene",
  "Inkontinenz",
  "Mobilität",
  "Ernährung",
  "Mundpflege",
  "Hilfsmittel",
  "Sonstiges",
];

export const units = ["Stück", "Packung", "Flasche", "Tube", "Paar", "Rolle", "ml", "g"];

// At or below the minimum stock an active product has to be reordered.
export const needsReorder = (product: Product) =>
  product.status === "active" &&
  product.min_stock_quantity > 0 &&
  product.current_stock_quantity <= product.min_stock_quantity;
