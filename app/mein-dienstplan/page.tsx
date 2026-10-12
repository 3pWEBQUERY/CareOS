import { Suspense } from "react";
import MySchedule from "./components/my-schedule";

export default function MySchedulePage() {
  return (
    <Suspense>
      <MySchedule />
    </Suspense>
  );
}
