import { Suspense } from "react";
import RoomLabels from "../../components/room-labels";

export default function RoomLabelsPage() {
  return (
    <Suspense>
      <RoomLabels />
    </Suspense>
  );
}
