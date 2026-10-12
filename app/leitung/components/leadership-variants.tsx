"use client";

import { Props } from "./leadership-variant-parts";
import { AdminVariant } from "./admin-variant";

export function LeadershipVariant(props: Props) {
  return <AdminVariant {...props} />;
}
